/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flakyD1, isStateBatch } from '../testing/flakyD1'
import { createSqliteD1 } from '../testing/sqliteD1'
import { DrainBudget, type ItemBudget } from './drainBudget'
import {
  WORK_LEASE_MS,
  claimProviderWork,
  drainProviderWork,
  enqueueProviderWork,
  type DrainOptions,
  type ProviderWorkItem,
  type WorkOutcome,
} from './providerWork'

/**
 * O dreno quando o próprio D1 falha na gravação do estado do ciclo, e a ordem
 * em que os itens reclamados são admitidos no saldo (ADR-027, adendo
 * "subrequests do dreno").
 */

const NOW = Date.parse('2026-11-17T14:05:00Z')
const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.restoreAllMocks()
})

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  return { sqlite, db }
}

async function enqueue(db: D1Database, count: number, kind: ProviderWorkItem['kind'] = 'result') {
  await enqueueProviderWork(
    db,
    Array.from({ length: count }, (_, i) => ({
      kind,
      competitionCode: 'PPL',
      season: '2026',
      round: String(i + 1),
      competitionId: 'c1',
    })),
    NOW,
  )
}

const done = async (item: ProviderWorkItem): Promise<WorkOutcome> => ({ item, status: 'done' })

function drain(budget: DrainBudget, opts: Partial<DrainOptions> = {}) {
  return drainProviderWork(budget, {
    provider: 'football-data',
    now: NOW,
    runItem: done,
    itemCost: () => 1,
    minItemCost: 1,
    ...opts,
  })
}

function rows(sqlite: DatabaseSync) {
  return sqlite
    .prepare(
      `SELECT kind, round, status, attempts, lease_until, lease_owner FROM provider_work ORDER BY rowid`,
    )
    .all() as {
    kind: string
    round: string
    status: string
    attempts: number
    lease_until: number
    lease_owner: string | null
  }[]
}

const statuses = (sqlite: DatabaseSync) => rows(sqlite).map((row) => row.status)

describe('falha do D1 na gravação do estado do ciclo', () => {
  it('falha transitória só no batch: a nova tentativa grava o estado e nenhum item fica running', async () => {
    const { sqlite, db: raw } = setup()
    await enqueue(raw, 3)
    let failures = 1
    const db = flakyD1(raw, { failBatch: (sqls) => isStateBatch(sqls) && failures-- > 0 })
    const budget = new DrainBudget(db, 45)

    const run = await drain(budget)

    expect(run).toMatchObject({ claimed: 3, done: 3, released: 0 })
    expect(run.settleError).toBeUndefined()
    expect(statuses(sqlite)).toEqual(['done', 'done', 'done'])
    expect(rows(sqlite).every((row) => row.attempts === 0)).toBe(true)
    // Reclamar, o batch que falhou e a nova tentativa.
    expect(budget.used).toBe(3)
  })

  it('batch que falha sempre: a liberação mínima devolve os itens a pending, sem tentativa e sem lease', async () => {
    const { sqlite, db: raw } = setup()
    await enqueue(raw, 3)
    const db = flakyD1(raw, { failBatch: isStateBatch })
    const budget = new DrainBudget(db, 45)

    const run = await drain(budget)

    // O estado não foi gravado: o que o ciclo concluiu volta à fila e roda de novo (idempotente).
    expect(run).toMatchObject({ claimed: 3, done: 0, requeued: 0, failed: 0, released: 3 })
    expect(run.settleError).toMatch(/falha simulada do batch/)
    expect(rows(sqlite)).toEqual(
      [1, 2, 3].map((n) => ({
        kind: 'result',
        round: String(n),
        status: 'pending',
        attempts: 0,
        lease_until: 0,
        lease_owner: null,
      })),
    )
    // Reclamar, o batch, a nova tentativa e a liberação.
    expect(budget.used).toBe(4)
  })

  it('a recuperação cabe na reserva: mesmo com o item esgotando o saldo de trabalho, não passa do limite', async () => {
    const { sqlite, db: raw } = setup()
    await enqueue(raw, 1)
    const db = flakyD1(raw, { failBatch: isStateBatch })
    const budget = new DrainBudget(db, 10)

    const run = await drain(budget, {
      runItem: async (item, span: ItemBudget) => {
        // O saldo de trabalho acaba muito antes das 100 consultas.
        for (let i = 0; i < 100; i++) await span.db.prepare('SELECT 1').first()
        return { item, status: 'done' }
      },
    })

    expect(budget.used).toBeLessThanOrEqual(budget.limit)
    expect(run.released).toBe(1)
    expect(statuses(sqlite)).toEqual(['pending'])
    expect(rows(sqlite)[0].attempts).toBe(0)
  })

  it('D1 fora do ar de forma persistente: o erro sobe, os itens ficam running e o lease os recupera sem gastar tentativa', async () => {
    const { sqlite, db: raw } = setup()
    await enqueue(raw, 3)
    let down = false
    const db = flakyD1(raw, {
      failBatch: () => down,
      failStatement: () => down,
    })
    const budget = new DrainBudget(db, 45)

    await expect(
      drain(budget, {
        runItem: async (item) => {
          down = true
          return { item, status: 'done' }
        },
      }),
    ).rejects.toThrow(/falha simulada/)

    // Limite declarado da garantia: sem D1 não há como gravar nada.
    expect(statuses(sqlite)).toEqual(['running', 'running', 'running'])
    expect(rows(sqlite).every((row) => row.attempts === 0)).toBe(true)
    // Reclamar, o batch, a nova tentativa e a liberação: a recuperação é limitada.
    expect(budget.used).toBe(4)

    // O lease de 5 min vence e o dreno seguinte retoma os itens, sem tentativa gasta.
    down = false
    const later = new DrainBudget(raw, 45)
    const run = await drain(later, { now: NOW + WORK_LEASE_MS + 1 })

    expect(run).toMatchObject({ claimed: 3, done: 3 })
    expect(statuses(sqlite)).toEqual(['done', 'done', 'done'])
    expect(rows(sqlite).every((row) => row.attempts === 0)).toBe(true)
  })

  it('depois de uma falha de gravação o dreno não segue para outro ciclo', async () => {
    const { sqlite, db: raw } = setup()
    await enqueue(raw, 6)
    const db = flakyD1(raw, { failBatch: isStateBatch })
    const budget = new DrainBudget(db, 100)

    const run = await drain(budget, { maxItems: 3 })

    expect(run.claimed).toBe(3)
    expect(statuses(sqlite).filter((status) => status === 'pending')).toHaveLength(6)
  })
})

describe('ordem de admissão dos itens reclamados', () => {
  it('o claim devolve os itens por prioridade, e não na ordem em que entraram na fila', async () => {
    const { db } = setup()
    // A descoberta entrou na fila antes do resultado.
    await enqueueProviderWork(
      db,
      [
        { kind: 'discovery', competitionCode: 'WC', season: '2026', round: '' },
        { kind: 'result', competitionCode: 'PPL', season: '2026', round: '1' },
        { kind: 'manual', competitionCode: 'PD', season: '2026', round: '' },
      ],
      NOW,
    )

    const claimed = await claimProviderWork(db, { provider: 'football-data', now: NOW })

    expect(claimed.map((item) => item.kind)).toEqual(['result', 'manual', 'discovery'])
  })

  it('o claim desempata pelo instante em que o trabalho entrou e depois pela ordem de inserção', async () => {
    const { db } = setup()
    await enqueueProviderWork(
      db,
      [{ kind: 'result', competitionCode: 'B', season: '2026', round: '1' }],
      NOW + 10,
    )
    await enqueueProviderWork(
      db,
      [{ kind: 'result', competitionCode: 'A', season: '2026', round: '1' }],
      NOW,
    )
    await enqueueProviderWork(
      db,
      [
        { kind: 'result', competitionCode: 'C', season: '2026', round: '1' },
        { kind: 'result', competitionCode: 'D', season: '2026', round: '1' },
      ],
      NOW,
    )

    const claimed = await claimProviderWork(db, { provider: 'football-data', now: NOW + 10 })

    expect(claimed.map((item) => item.competitionCode)).toEqual(['A', 'C', 'D', 'B'])
  })

  it('com a descoberta inserida antes do resultado, o resultado é admitido primeiro no saldo', async () => {
    const { sqlite, db } = setup()
    await enqueueProviderWork(
      db,
      [
        { kind: 'discovery', competitionCode: 'WC', season: '2026', round: '' },
        { kind: 'result', competitionCode: 'PPL', season: '2026', round: '1' },
      ],
      NOW,
    )
    // Fatia de 23: cabe a descoberta (17) ou o resultado (8), não os dois.
    const budget = new DrainBudget(db, 23)
    const cost = (item: ProviderWorkItem) => (item.kind === 'discovery' ? 17 : 8)

    const run = await drain(budget, {
      itemCost: cost,
      minItemCost: 8,
      runItem: async (item, span) => {
        for (let i = 0; i < cost(item); i++) await span.db.prepare('SELECT 1').first()
        return { item, status: 'done' }
      },
    })

    expect(run).toMatchObject({ claimed: 2, done: 1, released: 1, stoppedBy: 'budget' })
    expect(
      sqlite.prepare(`SELECT kind, status, attempts FROM provider_work ORDER BY kind`).all(),
    ).toEqual([
      { kind: 'discovery', status: 'pending', attempts: 0 },
      { kind: 'result', status: 'done', attempts: 0 },
    ])
  })
})

describe('estimativa de custo ajustada pelo custo real', () => {
  /** Estimativas com que o dreno abriu cada item, na ordem. */
  function estimates(budget: DrainBudget): number[] {
    const seen: number[] = []
    const open = budget.open.bind(budget)
    vi.spyOn(budget, 'open').mockImplementation((estimate: number) => {
      seen.push(estimate)
      return open(estimate)
    })
    return seen
  }

  it('custo real menor que a estimativa não a baixa: a estática é o piso', async () => {
    const { db } = setup()
    await enqueue(db, 8)
    const budget = new DrainBudget(db, 200)
    const seen = estimates(budget)

    await drain(budget, {
      itemCost: () => 10,
      minItemCost: 3,
      maxItems: 8,
      runItem: async (item, span) => {
        for (let i = 0; i < 3; i++) await span.db.prepare('SELECT 1').first()
        return { item, status: 'done' }
      },
    })

    // Os 8 itens custaram 3 cada, e nenhum foi admitido com menos que a estimativa de 10.
    expect(seen.length).toBeGreaterThanOrEqual(8)
    expect(Math.min(...seen)).toBe(10)
  })

  it('custo real maior que a estimativa sobe a estimativa dos itens seguintes', async () => {
    const { db } = setup()
    await enqueue(db, 8)
    const budget = new DrainBudget(db, 200)
    const seen = estimates(budget)

    await drain(budget, {
      itemCost: () => 2,
      minItemCost: 2,
      maxItems: 8,
      runItem: async (item, span) => {
        for (let i = 0; i < 6; i++) await span.db.prepare('SELECT 1').first()
        return { item, status: 'done' }
      },
    })

    // Os primeiros itens entram pela estática (2); depois do primeiro concluído, pelo custo real (6).
    expect(seen[0]).toBe(2)
    expect(seen.at(-1)).toBe(6)
    expect(seen.every((estimate) => estimate >= 2)).toBe(true)
  })
})
