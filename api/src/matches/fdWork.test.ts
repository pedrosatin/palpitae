/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { CallBudgetExhaustedError } from './callBudget'
import { CLAIM_CALLS, DrainBudget, SETTLE_CALLS } from './drainBudget'
import {
  advanceCompetitionStatus,
  footballDataMinItemCalls,
  footballDataDrain,
  footballDataItemCost,
  footballDataSyncCost,
  footballDataSyncedHandler,
  runFootballDataWorkItem,
} from './fdWork'
import {
  clearFootballDataPause,
  FootballDataQuotaError,
  noteFootballDataResponse,
} from './footballDataQuota'
import { setFootballDataRateLimitForTests } from './providerBudget'
import { enqueueProviderWork, type ProviderWorkItem } from './providerWork'
import { syncFixtures } from './sync'

/**
 * Item da football-data no saldo de subrequests (ADR-027, adendo): a estimativa
 * de custo por classe de item contra o custo medido do sync real sobre o SQLite
 * das migrations, e o que o executor e o pós-sync fazem quando o saldo acaba.
 */

const NOW = Date.parse('2026-11-17T14:05:00Z')
const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  clearFootballDataPause()
  setFootballDataRateLimitForTests(1000)
})

/** Calendário da football-data: `count` jogos entre `teams` times, todos no mesmo status. */
function calendar(count: number, status: string, teams = 20) {
  const team = (n: number) => ({
    id: 1000 + (n % teams),
    name: `Time ${n % teams}`,
    shortName: `T${n % teams}`,
    tla: 'TIM',
  })
  return {
    competition: { id: 2017, code: 'PPL', name: 'Primeira Liga' },
    matches: Array.from({ length: count }, (_, i) => ({
      id: 567_000 + i,
      utcDate: '2026-11-08T15:30:00Z',
      status,
      matchday: (i % 34) + 1,
      stage: 'REGULAR_SEASON',
      group: null,
      homeTeam: team(2 * i),
      awayTeam: team(2 * i + 1 + (i % (teams - 1))),
      score: {
        duration: 'REGULAR',
        fullTime: status === 'FINISHED' ? { home: 1, away: 0 } : { home: null, away: null },
      },
    })),
  }
}

async function setup(payload: { matches: number; status: string }) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const body = calendar(payload.matches, payload.status)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(body)),
  )
  await syncFixtures({ competitionCode: 'PPL', season: 2026, db, apiKey: 'test' })
  const { id } = sqlite.prepare(`SELECT id FROM competitions WHERE external_id = '2017'`).get() as {
    id: string
  }
  return { sqlite, db, competitionId: id }
}

const item = (overrides: Partial<ProviderWorkItem> = {}): ProviderWorkItem => ({
  kind: 'result',
  competitionCode: 'PPL',
  season: '2026',
  round: '10',
  competitionId: '',
  attempts: 0,
  leaseOwner: 'dono',
  ...overrides,
})

/** Chamadas que o dreno gastou num único item, sem a reclamação e a gravação do estado. */
async function measuredCost(
  db: D1Database,
  sqlite: DatabaseSync,
  competitionId: string,
  work: ProviderWorkItem,
): Promise<number> {
  await enqueueProviderWork(db, [{ ...work, competitionId }], NOW)
  const budget = new DrainBudget(db, Infinity)
  const run = await footballDataDrain({ apiKey: 'test', now: NOW }).run(budget)
  expect(run).toMatchObject({ claimed: 1, done: 1 })
  expect(sqlite.prepare(`SELECT status FROM provider_work`).get()).toEqual({ status: 'done' })
  return budget.used - CLAIM_CALLS - SETTLE_CALLS
}

describe('custo de um item da football-data', () => {
  it('rodada de resultado: sync mais a pontuação, 10 chamadas medidas, dentro da estimativa de 12', async () => {
    const { db, sqlite, competitionId } = await setup({ matches: 10, status: 'FINISHED' })

    const cost = await measuredCost(db, sqlite, competitionId, item())

    // 7 do sync (reserva de vaga, fetch, competição, times em batch e ids, jogos em trocas e
    // batch) + 3 da pontuação de liga (planejar sem confrontos e gravar uma vez).
    expect(cost).toBe(10)
    expect(cost).toBeLessThanOrEqual(footballDataItemCost(item()))
    expect(footballDataItemCost(item())).toBe(footballDataMinItemCalls())
    expect(footballDataMinItemCalls()).toBe(12)
    // O poller admite a rodada só pelo sync: a pontuação do tick tem reserva própria.
    expect(footballDataSyncCost(item())).toBe(8)
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM matches WHERE scored_at IS NULL`).get(),
    ).toEqual({ n: 0 })
  })

  it('calendário da temporada (mata-mata) já pontuado: 380 jogos em 4 batches, dentro da estimativa de 15', async () => {
    const { db, sqlite, competitionId } = await setup({ matches: 380, status: 'FINISHED' })
    sqlite.exec(`UPDATE matches SET scored_at = '2026-11-08T18:00:00Z'`)
    const work = item({ round: 'LAST_16' })

    const cost = await measuredCost(db, sqlite, competitionId, work)

    // 10 do sync e 1 da pontuação, que não acha jogo a pontuar.
    expect(cost).toBe(11)
    expect(cost).toBeLessThanOrEqual(footballDataItemCost(work))
    expect(footballDataItemCost(work)).toBe(15)
    expect(footballDataSyncCost(work)).toBe(11)
  })

  it('sync manual com jogos a pontuar: sync mais a pontuação, dentro da estimativa de 12', async () => {
    const { db, sqlite, competitionId } = await setup({ matches: 10, status: 'FINISHED' })
    const work = item({ kind: 'manual' })

    const cost = await measuredCost(db, sqlite, competitionId, work)

    // 7 do sync + 3 da pontuação de liga (planejar sem confrontos e gravar uma vez);
    // a de mata-mata gasta 4, o mínimo que `scoreUnprocessedMatches` exige.
    expect(cost).toBe(10)
    expect(cost).toBeLessThanOrEqual(footballDataItemCost(work))
    expect(footballDataItemCost(work)).toBe(12)
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM matches WHERE scored_at IS NULL`).get(),
    ).toEqual({ n: 0 })
  })

  it('descoberta da temporada inteira: dentro da estimativa de 17', async () => {
    const { db, sqlite, competitionId } = await setup({ matches: 380, status: 'TIMED' })
    const work = item({ kind: 'discovery', round: '' })

    const cost = await measuredCost(db, sqlite, competitionId, work)

    // 2 da requisição, 9 da gravação (com a conferência de jogos ausentes e sem a
    // reabertura de ida, que a liga não faz), 1 de pontuação sem jogo a pontuar e 1
    // do avanço do status.
    expect(cost).toBe(13)
    expect(cost).toBeLessThanOrEqual(footballDataItemCost(work))
    expect(footballDataItemCost(work)).toBe(17)
  })
})

describe('executor do item sem saldo', () => {
  it('não reserva vaga nem chama o provedor quando o saldo não cobre a reserva e o fetch', async () => {
    const { db, sqlite } = await setup({ matches: 10, status: 'FINISHED' })
    const fetchCalls = vi.mocked(fetch).mock.calls.length
    const windowBefore = sqlite.prepare(`SELECT window_calls FROM provider_rate_state`).get()
    // Fatia de 4: 3 ficam reservadas para o estado, sobra 1.
    const span = new DrainBudget(db, 4).open(0)!

    await expect(runFootballDataWorkItem({ apiKey: 'test' })(item(), span)).rejects.toBeInstanceOf(
      CallBudgetExhaustedError,
    )

    expect(vi.mocked(fetch).mock.calls).toHaveLength(fetchCalls)
    expect(sqlite.prepare(`SELECT window_calls FROM provider_rate_state`).get()).toEqual(
      windowBefore,
    )
    expect(span.used()).toBe(0)
  })

  it('sem vaga no orçamento do provedor, o item volta e o dreno inteiro encerra', async () => {
    const { db, sqlite } = await setup({ matches: 10, status: 'FINISHED' })
    setFootballDataRateLimitForTests(1)
    sqlite.exec(
      `UPDATE provider_rate_state SET window_started_at = ${Math.floor(NOW / 60_000)}, window_calls = 1`,
    )
    const span = new DrainBudget(db, 45).open(8)!

    const outcome = await runFootballDataWorkItem({ apiKey: 'test', now: NOW })(item(), span)

    expect(outcome).toMatchObject({ status: 'requeued', providerBlocked: true })
    // A reserva recusada é a única chamada: nenhum fetch saiu.
    expect(span.used()).toBe(1)
  })

  it('pausa de cota do provedor também encerra o dreno inteiro', async () => {
    const { db } = await setup({ matches: 10, status: 'FINISHED' })
    noteFootballDataResponse(429, { remaining: 0, resetSeconds: 3600 }, NOW)
    const span = new DrainBudget(db, 45).open(8)!

    const outcome = await runFootballDataWorkItem({ apiKey: 'test', now: NOW })(item(), span)

    expect(outcome).toMatchObject({ status: 'requeued', providerBlocked: true })
    expect(outcome.status === 'requeued' && outcome.error).toBe(
      new FootballDataQuotaError(NOW + 3_600_000).message,
    )
  })

  it('falha de rede conta tentativa e não encerra o dreno', async () => {
    const { db } = await setup({ matches: 10, status: 'FINISHED' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('erro', { status: 503 })),
    )
    const span = new DrainBudget(db, 45).open(8)!

    const outcome = await runFootballDataWorkItem({ apiKey: 'test', now: NOW })(item(), span)

    expect(outcome).toMatchObject({ status: 'retry' })
    expect(outcome).not.toHaveProperty('providerBlocked')
  })
})

describe('pós-sync sem saldo', () => {
  it('a pontuação que não cabe no saldo devolve o item para retomar', async () => {
    const { db, sqlite, competitionId } = await setup({ matches: 10, status: 'FINISHED' })
    const handler = footballDataSyncedHandler({ now: NOW })
    const manual = item({ kind: 'manual', competitionId })

    // Fatia de 6: 3 do estado e 3 de trabalho, abaixo das 4 que planejar e gravar exigem.
    const tight = new DrainBudget(db, 6).open(0)!
    expect(await handler(manual, undefined, tight)).toEqual({ incomplete: true })
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM matches WHERE scored_at IS NULL`).get(),
    ).toEqual({ n: 10 })

    // Com saldo, pontua e termina.
    const wide = new DrainBudget(db, 45).open(0)!
    expect(await handler(manual, undefined, wide)).toBeUndefined()
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM matches WHERE scored_at IS NULL`).get(),
    ).toEqual({ n: 0 })
  })

  it('na descoberta, guarda 1 chamada para o avanço do status', async () => {
    const { db, sqlite, competitionId } = await setup({ matches: 10, status: 'FINISHED' })
    const handler = footballDataSyncedHandler({ now: NOW })
    const discovery = item({ kind: 'discovery', round: '', competitionId })

    // Fatia de 7: 3 do estado e 4 de trabalho; a descoberta reserva 1, sobram 3 para pontuar.
    const tight = new DrainBudget(db, 7).open(0)!
    expect(await handler(discovery, undefined, tight)).toEqual({ incomplete: true })
    expect(tight.used()).toBe(0)

    // Fatia de 8: 5 de trabalho, 4 para pontuar (a liga gasta 3) e 1 para o avanço do status.
    const fit = new DrainBudget(db, 8).open(0)!
    expect(await handler(discovery, undefined, fit)).toBeUndefined()
    expect(fit.used()).toBe(4)
    // Todos os jogos (08/11) passaram da confirmação de 7 dias: o status avançou.
    expect(
      sqlite.prepare(`SELECT status FROM competitions WHERE id = ?`).get(competitionId),
    ).toEqual({ status: 'finished' })
  })

  it('resultado e varredura pontuam no pós-sync, sem avançar o status da competição', async () => {
    const { db, sqlite, competitionId } = await setup({ matches: 10, status: 'FINISHED' })
    const handler = footballDataSyncedHandler({ now: NOW })
    const span = new DrainBudget(db, 45).open(0)!

    expect(await handler(item({ kind: 'result', competitionId }), undefined, span)).toBeUndefined()
    // A liga pontua com 3 chamadas: planejar sem confrontos e gravar uma vez.
    expect(span.used()).toBe(3)
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM matches WHERE scored_at IS NULL`).get(),
    ).toEqual({ n: 0 })
    // A varredura repete sem nada a pontuar: só o planejamento, e o `scored_at` não volta.
    expect(await handler(item({ kind: 'late', competitionId }), undefined, span)).toBeUndefined()
    expect(span.used()).toBe(4)
    expect(
      sqlite.prepare(`SELECT status FROM competitions WHERE id = ?`).get(competitionId),
    ).not.toEqual({ status: 'finished' })
  })

  it('a pontuação do resultado que não cabe no saldo devolve o item para retomar', async () => {
    const { db, sqlite, competitionId } = await setup({ matches: 10, status: 'FINISHED' })
    const handler = footballDataSyncedHandler({ now: NOW })

    // Fatia de 6: 3 do estado e 3 de trabalho, abaixo das 4 que planejar e gravar exigem.
    const tight = new DrainBudget(db, 6).open(0)!
    expect(await handler(item({ competitionId }), undefined, tight)).toEqual({ incomplete: true })
    expect(tight.used()).toBe(0)
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM matches WHERE scored_at IS NULL`).get(),
    ).toEqual({ n: 10 })
  })

  it('descoberta sem saldo de trabalho para avançar o status relança o erro de orçamento, em vez de engolir', async () => {
    const { db } = await setup({ matches: 10, status: 'FINISHED' })
    const handler = footballDataSyncedHandler({ now: NOW })
    // Sem competição, a pontuação é pulada e a primeira chamada é a do avanço do status.
    const discovery = item({ kind: 'discovery', round: '', competitionId: '' })
    const noWork = new DrainBudget(db, 1).open(0)!

    await expect(handler(discovery, undefined, noWork)).rejects.toBeInstanceOf(
      CallBudgetExhaustedError,
    )
    expect(noWork.used()).toBe(0)
  })
})

describe('advanceCompetitionStatus', () => {
  const failing = (error: Error) =>
    ({
      prepare: () => ({ bind: () => ({ first: () => Promise.reject(error) }) }),
    }) as unknown as D1Database

  it('devolve false e registra a falha quando o D1 erra, como antes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      advanceCompetitionStatus(failing(new Error('D1 fora do ar')), undefined, 'c1', NOW, 0),
    ).resolves.toBe(false)
    expect(consoleError).toHaveBeenCalled()
  })

  it('relança o erro de orçamento, que devolve o item sem tentativa', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      advanceCompetitionStatus(failing(new CallBudgetExhaustedError()), undefined, 'c1', NOW, 0),
    ).rejects.toBeInstanceOf(CallBudgetExhaustedError)
    expect(consoleError).not.toHaveBeenCalled()
  })

  describe('item de competição da ESPN na fila da football-data (o item de retomada da descoberta)', () => {
    const espnItem = () => item({ competitionCode: 'conmebol.sudamericana', round: '' })

    it('a data que a ESPN não entregou não conclui o item: ele conta tentativa, como o fetch que lança', async () => {
      const { db } = await setup({ matches: 10, status: 'FINISHED' })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('erro', { status: 503 })),
      )
      const span = new DrainBudget(db, 45).open(12)!

      const outcome = await runFootballDataWorkItem({ apiKey: 'test', now: NOW })(espnItem(), span)

      expect(outcome).toMatchObject({ status: 'retry' })
    })

    it('com o acesso da ESPN pausado o item volta no prazo do bloqueio, sem tentativa e sem encerrar o dreno', async () => {
      const { db, sqlite } = await setup({ matches: 10, status: 'FINISHED' })
      sqlite.exec(
        `UPDATE provider_rate_state SET blocked_until = ${NOW + 15 * 60_000} WHERE provider = 'espn'`,
      )
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const span = new DrainBudget(db, 45).open(12)!

      const outcome = await runFootballDataWorkItem({ apiKey: 'test', now: NOW })(espnItem(), span)

      expect(outcome).toMatchObject({ status: 'requeued', notBefore: NOW + 15 * 60_000 })
      expect(outcome).not.toHaveProperty('providerBlocked')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
