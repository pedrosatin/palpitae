/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { CallBudgetExhaustedError } from './callBudget'
import { DrainBudget, type ItemBudget } from './drainBudget'
import {
  WORK_RETRY_DELAY_MS,
  drainProviderWork,
  enqueueProviderWork,
  type DrainOptions,
  type ProviderWorkItem,
  type WorkOutcome,
} from './providerWork'

/**
 * Dreno da fila dentro de uma fatia de subrequests (ADR-027, adendo
 * "subrequests do dreno"): reclama o que o saldo comporta, admite cada item pela
 * estimativa, grava o estado num único batch e devolve à fila, sem tentativa
 * nova, o que não coube.
 */

const NOW = Date.parse('2026-11-17T14:05:00Z')
const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  return { sqlite, db }
}

type Kind = ProviderWorkItem['kind']

async function enqueue(db: D1Database, count: number, kind: Kind = 'result') {
  await enqueueProviderWork(
    db,
    Array.from({ length: count }, (_, i) => ({
      kind,
      competitionCode: 'PPL',
      season: '2026',
      round: kind === 'result' ? String(i + 1) : `${kind}-${i + 1}`,
      competitionId: 'c1',
    })),
    NOW,
  )
}

/** Gasta `calls` consultas do saldo do item e conclui. */
function spending(calls: number | ((item: ProviderWorkItem) => number)) {
  return async (item: ProviderWorkItem, span: ItemBudget): Promise<WorkOutcome> => {
    const total = typeof calls === 'number' ? calls : calls(item)
    for (let i = 0; i < total; i++) await span.db.prepare('SELECT 1').first()
    return { item, status: 'done' }
  }
}

const constantCost = (cost: number) => ({ itemCost: () => cost, minItemCost: cost })

function drain(budget: DrainBudget, opts: Partial<DrainOptions> & Pick<DrainOptions, 'runItem'>) {
  return drainProviderWork(budget, {
    provider: 'football-data',
    now: NOW,
    ...constantCost(1),
    ...opts,
  })
}

function statuses(sqlite: DatabaseSync): Record<string, number> {
  const found = sqlite
    .prepare(`SELECT status, COUNT(*) AS n FROM provider_work GROUP BY status`)
    .all() as { status: string; n: number }[]
  return Object.fromEntries(found.map((row) => [row.status, row.n]))
}

function attempts(sqlite: DatabaseSync): number[] {
  const found = sqlite.prepare(`SELECT attempts FROM provider_work ORDER BY rowid`).all() as {
    attempts: number
  }[]
  return found.map((row) => row.attempts)
}

describe('dreno da fila dentro do saldo de subrequests', () => {
  it('reclama só o que a fatia comporta e deixa o resto pendente, sem tentativa gasta', async () => {
    const { sqlite, db } = setup()
    await enqueue(db, 16)
    const budget = new DrainBudget(db, 20)

    const run = await drain(budget, { runItem: spending(4), ...constantCost(4) })

    // 20 − 2 (reclamar e gravar o estado) = 18 chamadas de trabalho: 4 itens de 4.
    expect(run).toMatchObject({ claimed: 4, done: 4, released: 0, stoppedBy: 'budget' })
    expect(statuses(sqlite)).toEqual({ done: 4, pending: 12 })
    expect(attempts(sqlite).every((n) => n === 0)).toBe(true)
    expect(budget.used).toBe(1 + 16 + 1)
    expect(budget.used).toBeLessThanOrEqual(budget.limit)
  })

  it('grava o estado de todos os itens do ciclo num único batch', async () => {
    const { sqlite, db } = setup()
    await enqueue(db, 6)
    const budget = new DrainBudget(db, 100)

    const run = await drain(budget, { runItem: spending(0) })

    expect(run.done).toBe(6)
    expect(statuses(sqlite)).toEqual({ done: 6 })
    // 1 claim + 1 batch com as 6 conclusões; antes eram 1 + 6 + 1 (claim vazio).
    expect(budget.used).toBe(2)
  })

  it('não reclama de novo quando a reclamação veio incompleta, mesmo com item devolvido', async () => {
    const { sqlite, db } = setup()
    await enqueue(db, 3)
    const budget = new DrainBudget(db, 100)

    const run = await drain(budget, {
      runItem: async (item) => ({
        item,
        status: 'requeued',
        notBefore: NOW + 60_000,
        error: 'sem vaga',
      }),
    })

    expect(run).toMatchObject({ claimed: 3, requeued: 3 })
    expect(statuses(sqlite)).toEqual({ pending: 3 })
    expect(budget.used).toBe(2)
  })

  it('segue para o ciclo seguinte quando a reclamação veio cheia e ainda há saldo', async () => {
    const { sqlite, db } = setup()
    await enqueue(db, 7)
    const budget = new DrainBudget(db, 100)

    const run = await drain(budget, { runItem: spending(0), maxItems: 3 })

    expect(run).toMatchObject({ claimed: 7, done: 7 })
    expect(statuses(sqlite)).toEqual({ done: 7 })
    // 3 ciclos (3 + 3 + 1), cada um com a reclamação e a gravação do estado.
    expect(budget.used).toBe(6)
  })

  it('o item que o saldo não cobre volta à fila sem começar, sem tentativa e sem lease', async () => {
    const { sqlite, db } = setup()
    await enqueue(db, 3, 'result')
    await enqueue(db, 3, 'discovery')
    const budget = new DrainBudget(db, 14)

    const run = await drain(budget, {
      // Resultado custa 2 e descoberta 10, e cada um gasta o que estimou.
      runItem: spending((item) => (item.kind === 'discovery' ? 10 : 0)),
      itemCost: (item) => (item.kind === 'discovery' ? 10 : 2),
      minItemCost: 2,
    })

    // Os 3 resultados e a primeira descoberta cabem. As outras duas voltam intactas.
    expect(run).toMatchObject({ claimed: 6, done: 4, released: 2, stoppedBy: 'budget' })
    expect(statuses(sqlite)).toEqual({ done: 4, pending: 2 })
    expect(
      sqlite
        .prepare(
          `SELECT kind, attempts, lease_until, lease_owner, not_before FROM provider_work WHERE status = 'pending'`,
        )
        .all(),
    ).toEqual([
      { kind: 'discovery', attempts: 0, lease_until: 0, lease_owner: null, not_before: 0 },
      { kind: 'discovery', attempts: 0, lease_until: 0, lease_owner: null, not_before: 0 },
    ])
    expect(budget.used).toBeLessThanOrEqual(budget.limit)
  })

  it('o custo real do primeiro item da classe substitui a estimativa nos seguintes', async () => {
    const { sqlite, db } = setup()
    await enqueue(db, 8)
    // Estimativa de 10 por item, custo real de 3, saldo de 24. Pela estimativa só
    // coube 5 itens, e 2 voltariam; pela contagem real, cabem todos os 7 reclamados.
    const budget = new DrainBudget(db, 24)

    const run = await drain(budget, {
      runItem: spending(3),
      itemCost: () => 10,
      minItemCost: 3,
      maxItems: 8,
    })

    expect(run).toMatchObject({ claimed: 7, done: 7, released: 0 })
    expect(statuses(sqlite)).toEqual({ done: 7, pending: 1 })
    expect(budget.used).toBe(1 + 7 * 3 + 1)
  })

  it('estimativa abaixo do custo real: o que passa do saldo volta sem tentativa e nada fica running', async () => {
    const { sqlite, db } = setup()
    await enqueue(db, 8)
    // Estimativa de 4 e custo real de 6, com saldo de 30: cabem 4 itens de 6, e o quinto
    // é cortado pelo saldo no meio do trabalho.
    const budget = new DrainBudget(db, 30)

    const run = await drain(budget, {
      runItem: spending(6),
      itemCost: () => 4,
      minItemCost: 4,
      maxItems: 8,
    })

    expect(run.done).toBeGreaterThanOrEqual(4)
    expect(run.done + run.released).toBe(run.claimed)
    expect(run.stoppedBy).toBe('budget')
    expect(budget.used).toBeLessThanOrEqual(budget.limit)
    expect(statuses(sqlite).running).toBeUndefined()
    expect(attempts(sqlite).every((n) => n === 0)).toBe(true)
  })

  it('pós-sync sem saldo devolve o item para retomar, sem tentativa nova', async () => {
    const { sqlite, db } = setup()
    await enqueue(db, 1)
    sqlite.exec(`UPDATE provider_work SET attempts = 2`)
    const budget = new DrainBudget(db, 45)

    const run = await drain(budget, {
      runItem: spending(0),
      onSynced: async () => ({ incomplete: true }),
    })

    expect(run).toMatchObject({ done: 0, requeued: 1, stoppedBy: 'budget' })
    expect(
      sqlite.prepare(`SELECT status, attempts, not_before, lease_until FROM provider_work`).get(),
    ).toEqual({ status: 'pending', attempts: 2, not_before: NOW, lease_until: 0 })
  })

  it('pós-sync que lança saldo esgotado também devolve o item sem tentativa', async () => {
    const { sqlite, db } = setup()
    await enqueue(db, 1)
    const budget = new DrainBudget(db, 45)

    const run = await drain(budget, {
      runItem: spending(0),
      onSynced: async () => {
        throw new CallBudgetExhaustedError()
      },
    })

    expect(run.requeued).toBe(1)
    expect(statuses(sqlite)).toEqual({ pending: 1 })
    expect(attempts(sqlite)).toEqual([0])
  })

  it('item que lança saldo esgotado é devolvido sem tentativa; erro inesperado conta tentativa', async () => {
    const { sqlite, db } = setup()
    await enqueue(db, 2)
    const budget = new DrainBudget(db, 45)
    let started = 0

    const run = await drain(budget, {
      runItem: async () => {
        started += 1
        if (started === 1) throw new CallBudgetExhaustedError()
        throw new Error('falha de rede')
      },
    })

    expect(run).toMatchObject({ released: 1, done: 0 })
    const rows = sqlite
      .prepare(
        `SELECT attempts, status, not_before, last_error FROM provider_work ORDER BY attempts`,
      )
      .all()
    expect(rows).toEqual([
      { attempts: 0, status: 'pending', not_before: 0, last_error: null },
      {
        attempts: 1,
        status: 'pending',
        not_before: NOW + WORK_RETRY_DELAY_MS,
        last_error: 'falha de rede',
      },
    ])
  })

  it('provedor sem vaga encerra o dreno sem tentar os itens seguintes', async () => {
    const { sqlite, db } = setup()
    await enqueue(db, 8)
    const budget = new DrainBudget(db, 45)
    let started = 0

    const run = await drain(budget, {
      runItem: async (item) => {
        started += 1
        return started === 1
          ? {
              item,
              status: 'requeued',
              notBefore: NOW + 60_000,
              error: 'sem vaga',
              providerBlocked: true,
            }
          : { item, status: 'done' }
      },
    })

    // Os 4 primeiros já estavam em voo; os outros 4 não gastam nem a reserva recusada.
    expect(run).toMatchObject({
      claimed: 8,
      requeued: 1,
      done: 3,
      released: 4,
      stoppedBy: 'provider',
    })
    expect(started).toBe(4)
    expect(statuses(sqlite)).toEqual({ done: 3, pending: 5 })
    expect(budget.used).toBe(2)
  })

  it('o item nunca gasta a chamada reservada para gravar o estado: nada fica running', async () => {
    const { sqlite, db } = setup()
    await enqueue(db, 1)
    const budget = new DrainBudget(db, 6)

    const run = await drain(budget, { runItem: spending(10) })

    // 6 − 1 (reclamar) − 1 (estado) = 4 consultas do item; a quinta é recusada sem chamar.
    expect(run).toMatchObject({ released: 1, done: 0 })
    expect(budget.used).toBe(6)
    expect(statuses(sqlite)).toEqual({ pending: 1 })
    expect(attempts(sqlite)).toEqual([0])
  })

  it('saldo que não cobre nem a reclamação e um item encerra sem chamar o D1', async () => {
    const { sqlite, db } = setup()
    await enqueue(db, 3)
    const budget = new DrainBudget(db, 5)

    const run = await drain(budget, { runItem: spending(0), ...constantCost(4) })

    expect(run).toMatchObject({ claimed: 0, stoppedBy: 'budget' })
    expect(budget.used).toBe(0)
    expect(statuses(sqlite)).toEqual({ pending: 3 })
  })

  it('grava o estado das linhas do provedor do dreno, não só da football-data', async () => {
    const { sqlite, db } = setup()
    sqlite.exec(
      `INSERT INTO provider_work (provider, kind, competition_code, season, round, priority, status, not_before, created_at, updated_at)
       VALUES ('espn', 'result', 'bra.1', '2026', '', 0, 'pending', 0, 1, 1),
              ('football-data', 'result', 'PPL', '2026', '1', 0, 'pending', 0, 1, 1)`,
    )
    const budget = new DrainBudget(db, 45)

    const run = await drain(budget, { provider: 'espn', runItem: spending(0) })

    expect(run.done).toBe(1)
    expect(
      sqlite.prepare(`SELECT provider, status FROM provider_work ORDER BY provider`).all(),
    ).toEqual([
      { provider: 'espn', status: 'done' },
      { provider: 'football-data', status: 'pending' },
    ])
  })
})
