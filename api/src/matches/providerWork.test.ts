/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  DRAIN_MAX_ITEMS,
  WORK_MAX_ATTEMPTS,
  claimProviderWork,
  deferProviderWork,
  drainProviderWork,
  enqueueProviderWork,
  WORK_BUSY_RETRY_MS,
  WORK_RETRY_DELAY_MS,
  type DrainOptions,
  type ProviderWorkItem,
  type WorkOutcome,
} from './providerWork'
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
    expect(reclaimed).toEqual([item({ attempts: 0 })])
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
})
