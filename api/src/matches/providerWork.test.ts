/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  DRAIN_MAX_ITEMS,
  WORK_MAX_ATTEMPTS,
  claimProviderWork,
  deferProviderWork,
  deferralOf,
  drainProviderWork,
  enqueueProviderWork,
  WORK_BUSY_RETRY_MS,
  WORK_LEASE_MS,
  WORK_RETRY_DELAY_MS,
  type DrainOptions,
  type ProviderWorkItem,
  type WorkOutcome,
} from './providerWork'
import { CallBudgetExhaustedError } from './callBudget'
import { FootballDataQuotaError } from './footballDataQuota'
import { DrainBudget } from './drainBudget'

const handles: DatabaseSync[] = []

/** Dreno sem limite de saldo: estes testes olham a fila, não o orçamento de chamadas. */
function drain(db: D1Database, opts: Omit<DrainOptions, 'itemCost' | 'minItemCost'>) {
  return drainProviderWork(new DrainBudget(db, Infinity), {
    itemCost: () => 1,
    minItemCost: 1,
    ...opts,
  })
}

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.useRealTimers()
})

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  return { sqlite, db }
}

const item = (overrides: Partial<ProviderWorkItem> = {}): ProviderWorkItem => ({
  kind: 'result',
  competitionCode: 'BSA',
  season: '2026',
  round: '10',
  competitionId: 'c1',
  attempts: 0,
  leaseOwner: 'dono',
  ...overrides,
})

const newItem = (overrides: Partial<Parameters<typeof enqueueProviderWork>[1][number]> = {}) => ({
  kind: 'result' as const,
  competitionCode: 'BSA',
  season: '2026',
  round: '10',
  competitionId: 'c1',
  ...overrides,
})

function rows(sqlite: DatabaseSync) {
  return sqlite
    .prepare(
      `SELECT kind, competition_code, competition_id, season, round, priority, status, attempts,
              not_before, last_error FROM provider_work ORDER BY kind, competition_code, round`,
    )
    .all() as Record<string, string | number | null>[]
}

describe('fila durável do provedor', () => {
  it('grava o item deduplicado; item pendente não duplica e concluído é reativado zerado', async () => {
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')

    await enqueueProviderWork(db, [newItem()], now)
    await enqueueProviderWork(db, [newItem({ competitionId: '' })], now)
    expect(rows(sqlite)).toHaveLength(1)
    expect(rows(sqlite)[0]).toMatchObject({ status: 'pending', attempts: 0, priority: 0 })

    sqlite.exec("UPDATE provider_work SET status = 'done', attempts = 3")
    // Replanejamento do produtor: novo ciclo, tentativas zeradas, erro limpo.
    await enqueueProviderWork(
      db,
      [newItem({ notBefore: 123 })],
      now + WORK_RETRY_DELAY_MS,
    )
    expect(rows(sqlite)[0]).toMatchObject({ status: 'pending', attempts: 0, not_before: 123 })
  })

  it('reclama por prioridade: resultado antes da descoberta, e a recusa não reclama item em execução', async () => {
    const { db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    await enqueueProviderWork(db, [
      newItem({ kind: 'discovery', competitionCode: 'WC', round: '', competitionId: 'c9' }),
      newItem({ competitionCode: 'BSA', round: '10', competitionId: 'c1' }),
    ], now)

    const claimed = await claimProviderWork(db, { provider: 'football-data', now })
    // O RETURNING não garante ordem; o limite do lote é que garante prioridade.
    expect(claimed.map((i) => i.competitionCode).sort()).toEqual(['BSA', 'WC'])

    // Tudo está em execução com lease fresco: nova reclamação não pega nada.
    const again = await claimProviderWork(db, { provider: 'football-data', now })
    expect(again).toEqual([])
  })

  it('retoma o item de um isolate que morreu: lease vencido volta a ser reclamado', async () => {
    const { db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    await enqueueProviderWork(db, [newItem()], now)
    await claimProviderWork(db, { provider: 'football-data', now })

    // Reinício: o lease venceu e o dreno seguinte reclama o mesmo item.
    const reclaimed = await claimProviderWork(db, { provider: 'football-data', now: now + 6 * 60_000 })
    expect(reclaimed).toEqual([item({ attempts: 0, leaseOwner: expect.any(String) })])
  })

  it('não reclama antes do prazo de retomada', async () => {
    const { db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    await enqueueProviderWork(db, [newItem({ notBefore: now + WORK_BUSY_RETRY_MS })], now)

    const early = await claimProviderWork(db, { provider: 'football-data', now })
    expect(early).toEqual([])
    const later = await claimProviderWork(db, {
      provider: 'football-data',
      now: now + WORK_BUSY_RETRY_MS,
    })
    expect(later).toHaveLength(1)
  })

  it('dreno executa, grava concluído e devolve os resultados; requeued não conta tentativa', async () => {
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    await enqueueProviderWork(db, [
      newItem({ competitionCode: 'BSA', round: '10' }),
      newItem({ competitionCode: 'BSA', round: '11' }),
    ], now)

    const runItem = vi.fn(async (work: ProviderWorkItem): Promise<WorkOutcome> =>
      work.round === '10'
        ? { item: work, status: 'done' }
        : {
            item: work,
            status: 'requeued',
            notBefore: now + WORK_BUSY_RETRY_MS,
            error: 'sem vaga',
          },
    )
    const run = await drain(db, { provider: 'football-data', now, runItem })

    expect(run).toMatchObject({ claimed: 2, done: 1, requeued: 1, failed: 0 })
    expect(runItem).toHaveBeenCalledTimes(2)
    const states = Object.fromEntries(
      rows(sqlite).map((row) => [row.round, row]),
    ) as Record<string, Record<string, unknown>>
    expect(states['10']).toMatchObject({ status: 'done' })
    // O 429/block não conta tentativa: o provedor não foi chamado.
    expect(states['11']).toMatchObject({ status: 'pending', attempts: 0, not_before: now + WORK_BUSY_RETRY_MS })
  })

  it('dreno marca falha no teto de tentativas e o produtor revives o item', async () => {
    const { sqlite, db } = setup()
    const start = Date.parse('2026-11-16T12:00:00Z')
    await enqueueProviderWork(db, [newItem()], start)

    const fail: (work: ProviderWorkItem) => Promise<WorkOutcome> = (work) =>
      Promise.resolve({ item: work, status: 'retry', error: 'football-data.org respondeu 503' })

    // O item sai da fila a cada dreno: cada retomada é um novo ciclo de execução.
    // O dreno usa o relógio corrente, adiantado entre os drenos.
    for (let i = 1; i <= WORK_MAX_ATTEMPTS; i++) {
      vi.useFakeTimers({ now: start + i * (WORK_RETRY_DELAY_MS + 1000), toFake: ['Date'] })
      await drain(db, { provider: 'football-data', runItem: fail, maxCycles: 1 })
    }
    expect(rows(sqlite)[0]).toMatchObject({
      status: 'failed',
      attempts: WORK_MAX_ATTEMPTS,
      last_error: 'football-data.org respondeu 503',
    })

    // O produtor revive: novo planejamento do mesmo trabalho.
    await enqueueProviderWork(db, [newItem()], start)
    expect(rows(sqlite)[0]).toMatchObject({ status: 'pending', attempts: 0 })
  })

  it('adiamento de um sync direto vira item pendente com o prazo da cota', async () => {
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    const retryAt = now + 120_000
    const quotaError = new FootballDataQuotaError(retryAt)

    await deferProviderWork(
      db,
      { kind: 'discovery', competitionCode: 'WC', season: '2026', round: '', competitionId: 'c9' },
      quotaError,
      now,
    )
    expect(rows(sqlite)[0]).toMatchObject({
      kind: 'discovery',
      status: 'pending',
      priority: 2,
      not_before: retryAt,
    })

    await deferProviderWork(
      db,
      { kind: 'result', competitionCode: 'BSA', season: '2026', round: '10', competitionId: 'c1' },
      new Error('qualquer outra falha'),
      now,
    )
    expect(rows(sqlite)[1]).toMatchObject({ status: 'pending', not_before: now + WORK_BUSY_RETRY_MS })
  })

  it('dreno reclama em lotes e continua enquanto houver itens no limite do lote', async () => {
    const { db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    const items = Array.from({ length: DRAIN_MAX_ITEMS + 3 }, (_, i) =>
      newItem({ competitionCode: `C${i}`, round: '1' }),
    )
    await enqueueProviderWork(db, items, now)

    const runItem = vi.fn(async (work: ProviderWorkItem): Promise<WorkOutcome> => ({
      item: work,
      status: 'done',
    }))
    const run = await drain(db, { provider: 'football-data', now, runItem })

    expect(run.claimed).toBe(DRAIN_MAX_ITEMS + 3)
    expect(run.done).toBe(DRAIN_MAX_ITEMS + 3)
    expect(runItem).toHaveBeenCalledTimes(DRAIN_MAX_ITEMS + 3)
  })

  it('falha do pós-sync não repete o sync: item concluído com o erro no resultado', async () => {
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    await enqueueProviderWork(db, [newItem()], now)

    const runItem = vi.fn(async (work: ProviderWorkItem): Promise<WorkOutcome> => ({
      item: work,
      status: 'done',
    }))
    const onSynced = vi.fn(async () => ({ error: 'Scoring Error' }))
    const run = await drain(db, { provider: 'football-data', now, runItem, onSynced })

    expect(run.done).toBe(1)
    expect(run.outcomes[0]).toMatchObject({ status: 'done', postError: 'Scoring Error' })
    expect(rows(sqlite)[0]).toMatchObject({ status: 'done' })
  })

  /** Promessa que o teste resolve de fora, para segurar um item em execução. */
  function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((done) => (resolve = done))
    return { promise, resolve }
  }

  it('fencing: o dreno cujo lease venceu não fecha nem devolve o item que outro reclamou', async () => {
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    await enqueueProviderWork(db, [newItem()], now)
    const lost = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gates = { a: deferred(), b: deferred() }
    const slowDrain = (who: 'a' | 'b', at: number, status: 'done' | 'retry') =>
      drain(db, {
        provider: 'football-data',
        now: at,
        maxCycles: 1,
        runItem: async (work) => {
          await gates[who].promise
          return status === 'done'
            ? { item: work, status }
            : { item: work, status, error: 'falha tardia' }
        },
      })

    // O dreno A reclama o item e demora; o lease vence e o dreno B reclama o mesmo item.
    const drainA = slowDrain('a', now, 'retry')
    await vi.waitFor(() => expect(rows(sqlite)[0]).toMatchObject({ status: 'running' }))
    const ownerOf = () => sqlite.prepare('SELECT lease_owner AS owner FROM provider_work').get()
    const ownerA = ownerOf()
    const drainB = slowDrain('b', now + WORK_LEASE_MS + 1000, 'done')
    await vi.waitFor(() => expect(ownerOf()).not.toEqual(ownerA))

    // O resultado atrasado de A (uma falha que devolveria o item à fila) não grava nada.
    gates.a.resolve()
    const runA = await drainA
    expect(runA).toMatchObject({
      claimed: 1,
      done: 0,
      failed: 0,
      requeued: 0,
      released: 0,
      leaseLost: 1,
    })
    expect(rows(sqlite)[0]).toMatchObject({ status: 'running', attempts: 0 })
    expect(lost).toHaveBeenCalledTimes(1)

    // O dono atual conclui normalmente.
    gates.b.resolve()
    expect(await drainB).toMatchObject({ claimed: 1, done: 1, leaseLost: 0 })
    expect(rows(sqlite)[0]).toMatchObject({ status: 'done' })
  })

  it('fencing no batch de estado: só o item que mudou de dono fica de fora, os outros gravam', async () => {
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    await enqueueProviderWork(
      db,
      [newItem({ round: '10' }), newItem({ round: '11' }), newItem({ round: '12' })],
      now,
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gate = deferred()
    const slow = drain(db, {
      provider: 'football-data',
      now,
      maxCycles: 1,
      runItem: async (work) => {
        await gate.promise
        return { item: work, status: 'done' }
      },
    })
    await vi.waitFor(() => expect(rows(sqlite).every((row) => row.status === 'running')).toBe(true))

    // Outro dreno reclama só a rodada 11 depois que o lease dela venceu.
    sqlite.exec(`UPDATE provider_work SET lease_until = 0 WHERE round = '11'`)
    const [stolen] = await claimProviderWork(db, {
      provider: 'football-data',
      now: now + 1000,
      limit: 1,
    })
    expect(stolen.round).toBe('11')

    gate.resolve()
    const run = await slow
    expect(run).toMatchObject({ claimed: 3, done: 2, leaseLost: 1 })
    const states = Object.fromEntries(rows(sqlite).map((row) => [row.round, row.status]))
    expect(states).toEqual({ '10': 'done', '11': 'running', '12': 'done' })
  })

  it('cada provedor tem a sua fila: a chave e a reclamação não se misturam', async () => {
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    await enqueueProviderWork(
      db,
      [
        newItem({ competitionCode: 'X', round: '20261014' }),
        { ...newItem({ competitionCode: 'X', round: '20261014' }), provider: 'espn' },
      ],
      now,
    )

    expect(sqlite.prepare('SELECT provider FROM provider_work ORDER BY provider').all()).toEqual([
      { provider: 'espn' },
      { provider: 'football-data' },
    ])
    const espn = await claimProviderWork(db, { provider: 'espn', now })
    expect(espn).toHaveLength(1)
    // A reclamação da ESPN não toca o item da football-data.
    expect(
      sqlite.prepare("SELECT status FROM provider_work WHERE provider = 'football-data'").get(),
    ).toEqual({ status: 'pending' })

    // Fechar o item da ESPN fecha só a linha dela.
    await drain(db, {
      provider: 'espn',
      now: now + WORK_LEASE_MS + 1000,
      runItem: async (work) => ({ item: work, status: 'done' }),
    })
    expect(
      sqlite.prepare('SELECT provider, status FROM provider_work ORDER BY provider').all(),
    ).toEqual([
      { provider: 'espn', status: 'done' },
      { provider: 'football-data', status: 'pending' },
    ])
  })

  it('adiamento por prazo do erro (bloqueio ou suspensão) e vários itens no mesmo lote', async () => {
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    const retryAt = now + 6 * 60 * 60_000
    const blocked = Object.assign(new Error('ESPN indisponível (suspended)'), { retryAt })

    await deferProviderWork(
      db,
      ['20261014', '20261015'].map((round) => ({
        ...newItem({ competitionCode: 'conmebol.sudamericana', round }),
        provider: 'espn',
      })),
      blocked,
      now,
    )

    expect(
      sqlite
        .prepare(
          `SELECT provider, round, status, not_before, last_error FROM provider_work ORDER BY round`,
        )
        .all(),
    ).toEqual(
      ['20261014', '20261015'].map((round) => ({
        provider: 'espn',
        round,
        status: 'pending',
        not_before: retryAt,
        last_error: 'ESPN indisponível (suspended)',
      })),
    )
  })

  it('o teto de itens em voo do provedor limita a execução simultânea do dreno', async () => {
    const { db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    await enqueueProviderWork(
      db,
      Array.from({ length: 6 }, (_, i) => ({ ...newItem({ round: String(i + 1) }), provider: 'espn' })),
      now,
    )
    let inFlight = 0
    let peak = 0
    await drain(db, {
      provider: 'espn',
      now,
      concurrency: 2,
      runItem: async (work) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        return { item: work, status: 'done' }
      },
    })
    expect(peak).toBe(2)
  })

  it('respectProviderAccess: provedor bloqueado ou suspenso não reclama nada e não escreve na fila', async () => {
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    await enqueueProviderWork(db, [{ ...newItem(), provider: 'espn' }], now)
    const claim = (at: number) =>
      claimProviderWork(db, { provider: 'espn', now: at, respectProviderAccess: true })

    // Bloqueado até depois de `now`: nada é reclamado.
    sqlite.exec(`UPDATE provider_rate_state SET blocked_until = ${now + 60_000} WHERE provider = 'espn'`)
    expect(await claim(now)).toEqual([])
    // Suspenso: nada, por mais tempo que passe.
    sqlite.exec(
      `UPDATE provider_rate_state SET blocked_until = 0, suspended_at = ${now} WHERE provider = 'espn'`,
    )
    expect(await claim(now + 48 * 3_600_000)).toEqual([])
    expect(rows(sqlite)[0]).toMatchObject({ status: 'pending', attempts: 0 })

    // O bloqueio vence e a suspensão é retomada: o item é reclamado.
    sqlite.exec(`UPDATE provider_rate_state SET suspended_at = NULL WHERE provider = 'espn'`)
    expect(await claim(now)).toHaveLength(1)
  })

  it('sem respectProviderAccess o estado de acesso não interfere na reclamação (football-data)', async () => {
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')
    await enqueueProviderWork(db, [newItem()], now)
    sqlite.exec(
      `UPDATE provider_rate_state SET blocked_until = ${now + 60_000} WHERE provider = 'football-data'`,
    )

    expect(await claimProviderWork(db, { provider: 'football-data', now })).toHaveLength(1)
  })

  it('falta de saldo da invocação adia o item para já, sem tentativa, e as demais falhas seguem o prazo do erro', async () => {
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')

    expect(deferralOf(new CallBudgetExhaustedError(), now)).toEqual({
      notBefore: now,
      lastError: 'saldo de chamadas da invocação esgotado; o item volta no próximo dreno',
    })
    expect(deferralOf(Object.assign(new Error('bloqueada'), { retryAt: now + 5 }), now)).toEqual({
      notBefore: now + 5,
      lastError: 'bloqueada',
    })
    expect(deferralOf('falha solta', now)).toEqual({
      notBefore: now + WORK_BUSY_RETRY_MS,
      lastError: 'falha solta',
    })

    await deferProviderWork(db, newItem(), new CallBudgetExhaustedError(), now)
    expect(rows(sqlite)[0]).toMatchObject({ status: 'pending', attempts: 0, not_before: now })
  })
})
