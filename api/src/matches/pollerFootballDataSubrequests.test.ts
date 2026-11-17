/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POLLER_AND_DRAIN_CRON } from '../crons'
import worker from '../index'
import { D1_CALLS_PER_INVOCATION, limitD1Calls } from '../testing/d1CallLimit'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { clearFootballDataPause } from './footballDataQuota'
import { setFootballDataRateLimitForTests } from './providerBudget'
import { syncFixtures } from './sync'

/**
 * O poller com a football-data sob o limite de 50 subrequests por invocação do plano
 * Free (ADR-027, adendo do ticket 09). O `scheduled` real roda nos minutos 0 e 30
 * (poller), sobre o SQLite das migrations, com a limpeza de segurança do `scheduled`
 * (1 chamada) na mesma conta. O D1 recusa a chamada 51, e cada `fetch` conta na mesma
 * conta. A rodada que não cabe no saldo do tick vai para a fila durável, sem erro de
 * provedor e sem tentativa gasta, e o dreno e os ticks seguintes terminam com o
 * resultado e a pontuação de um tick sem limite.
 */

const MIN = 60_000
/** Os dois minutos do poller no trigger fundido. */
const POLLER_TICKS = [
  ['30', Date.UTC(2026, 10, 17, 14, 30, 0)],
  ['0', Date.UTC(2026, 10, 17, 15, 0, 0)],
] as const
/** A limpeza de registros expirados do `scheduled` é 1 chamada. */
const CLEANUP_CALLS = 1
/** O orçamento do poller (`POLLER_CALL_BUDGET`): o que sobra dos 50 menos a limpeza, o relatório e a folga. */
const POLLER_BUDGET = 45

/** Ticks seguintes do cron fundido, por 3 h: o dreno nos minutos 5, 10, 20, 25, 35, 40, 50 e 55 e o poller nos 0 e 30. */
function followingTicks(tick: number): number[] {
  const minutes = [0, 5, 10, 20, 25, 30, 35, 40, 50, 55]
  const start = Math.floor(tick / (60 * MIN)) * 60 * MIN
  return [0, 1, 2]
    .flatMap((hour) => minutes.map((minute) => start + hour * 60 * MIN + minute * MIN))
    .filter((at) => at > tick)
}

const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // A espera do 429 roda no relógio simulado, que avança junto com os timers.
  vi.useFakeTimers({
    now: POLLER_TICKS[0][1],
    toFake: ['Date', 'setTimeout', 'clearTimeout'],
  })
  clearFootballDataPause()
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  clearFootballDataPause()
  setFootballDataRateLimitForTests(1000)
})

/** Calendário da football-data: uma rodada de 10 jogos que começou na janela do tick. */
function fdCalendar(tick: number, matchday: number, status: 'TIMED' | 'FINISHED') {
  const team = (n: number) => ({
    id: matchday * 1000 + n,
    name: `Time ${matchday}-${n}`,
    shortName: `T${matchday}-${n}`,
    tla: 'TIM',
  })
  return {
    competition: { id: 2017, code: 'PPL', name: 'Primeira Liga' },
    matches: Array.from({ length: 10 }, (_, i) => ({
      id: 567_000 + matchday * 100 + i,
      utcDate: new Date(tick - 130 * MIN).toISOString().slice(0, 19) + 'Z',
      status,
      matchday,
      stage: 'REGULAR_SEASON',
      group: null,
      homeTeam: team(2 * i),
      awayTeam: team(2 * i + 1),
      score: {
        duration: 'REGULAR',
        fullTime: status === 'FINISHED' ? { home: i % 3, away: i % 2 } : { home: null, away: null },
      },
    })),
  }
}

/** 429 no formato da football-data: reset em segundos e a cota do minuto zerada. */
function quotaExhausted(resetSeconds: number) {
  return Response.json(
    {
      message: `You reached your request limit. Wait ${resetSeconds} seconds.`,
      errorCode: 429,
    },
    {
      status: 429,
      headers: {
        'X-RequestCounter-Reset': String(resetSeconds),
        'x-requests-available-minute': '0',
      },
    },
  )
}

type WorldOptions = {
  tick: number
  /** Rodadas da football-data com jogo na janela; cada uma é uma tarefa do poller. */
  rounds: number
  /** O provedor responde 429 com reset de 60 s durante o primeiro minuto do tick. */
  rateLimited?: boolean
  /** D1 que recusa a chamada 51 (padrão) ou só conta. */
  limit?: number | null
}

/**
 * Banco com as rodadas já gravadas (agendadas, como ficam depois da descoberta) e o
 * provedor simulado, que responde o resultado final. A ESPN, do fallback, não traz nada.
 */
async function setupWorld(options: WorldOptions) {
  const { tick, rounds, rateLimited = false, limit = D1_CALLS_PER_INVOCATION } = options
  vi.setSystemTime(tick)
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec('DELETE FROM competitions')
  const fetches = { fd: 0, espn: 0, limited: 0 }
  let chargeFetch: () => void = () => {}
  let live = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      chargeFetch()
      const url = new URL(String(input))
      if (url.hostname !== 'api.football-data.org') {
        fetches.espn += 1
        return Response.json({ events: [] })
      }
      fetches.fd += 1
      if (live && rateLimited && Date.now() < tick + MIN) {
        fetches.limited += 1
        return quotaExhausted(60)
      }
      const matchday = Number(url.searchParams.get('matchday') ?? '1')
      return Response.json(fdCalendar(tick, matchday, live ? 'FINISHED' : 'TIMED'))
    }),
  )
  for (let round = 1; round <= rounds; round++) {
    await syncFixtures({
      competitionCode: 'PPL',
      season: 2026,
      matchday: round,
      db,
      apiKey: 'test',
    })
  }
  live = true
  fetches.fd = 0
  fetches.espn = 0

  const limited = limitD1Calls(db, limit)
  chargeFetch = limited.chargeFetch
  const writeDataPoint = vi.fn()
  const env = {
    DB: limited.db,
    AE: { writeDataPoint },
    FOOTBALL_API_KEY: 'test',
    FRONTEND_URL: 'http://localhost:5173',
    JWT_SECRET: 'jwt-secret',
    BASE_URL: 'https://api.example.test',
  } as unknown as Env
  const events = (type: string) =>
    writeDataPoint.mock.calls
      .map(([point]) => point as { blobs: string[]; doubles: number[] })
      .filter((point) => point.blobs[0] === type)
  return { sqlite, fetches, limited, env, events }
}

type World = Awaited<ReturnType<typeof setupWorld>>

/** Um tick do cron fundido, no instante dado, com o relógio correndo pela espera do 429. Devolve as falhas. */
async function runTick(h: Pick<World, 'limited' | 'env'>, at: number): Promise<string[]> {
  vi.setSystemTime(at)
  h.limited.startInvocation()
  const pending: Promise<unknown>[] = []
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
  } as ExecutionContext
  const controller = {
    cron: POLLER_AND_DRAIN_CRON,
    scheduledTime: at,
  } as ScheduledController
  const run = (async () => {
    await worker.scheduled!(controller, h.env, ctx)
    return Promise.allSettled(pending)
  })()
  await vi.advanceTimersByTimeAsync(2 * MIN)
  const settled = await run
  return settled.flatMap((r) =>
    r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : [],
  )
}

/** Estado final dos jogos, por id no provedor: o que um tick sem limite deixa. */
function snapshot(sqlite: DatabaseSync) {
  return sqlite
    .prepare(
      `SELECT m.external_id AS external_id, m.status AS status, m.home_score AS home,
              m.away_score AS away, m.scored_at IS NOT NULL AS scored
         FROM matches m ORDER BY m.external_id`,
    )
    .all()
}

const workCount = (sqlite: DatabaseSync, where: string): number =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM provider_work WHERE ${where}`).get() as { n: number })
    .n

const finishedMatches = (sqlite: DatabaseSync): number =>
  (
    sqlite.prepare(`SELECT COUNT(*) AS n FROM matches WHERE status = 'finished'`).get() as {
      n: number
    }
  ).n

/** Tudo terminou: jogos encerrados e pontuados, fila vazia de pendências. */
function settled(sqlite: DatabaseSync): boolean {
  const open = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM matches WHERE status != 'finished' OR scored_at IS NULL`)
    .get() as { n: number }
  return open.n === 0 && workCount(sqlite, `status IN ('pending', 'running')`) === 0
}

/** Roda os ticks seguintes até tudo terminar, conferindo o limite em cada um. */
async function drainUntilSettled(h: World, tick: number) {
  for (const at of followingTicks(tick)) {
    if (settled(h.sqlite)) return
    expect(await runTick(h, at)).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    expect(workCount(h.sqlite, `status = 'running'`)).toBe(0)
    expect(workCount(h.sqlite, `attempts > 0`)).toBe(0)
  }
}

/** Um tick sem limite de chamadas, na mesma semente: o resultado que a fila deve reproduzir. */
async function controlSnapshot(options: WorldOptions) {
  // A pausa por cota da football-data é do isolate: o mundo de controle começa sem ela.
  clearFootballDataPause()
  const control = await setupWorld({ ...options, limit: null })
  expect(await runTick(control, options.tick)).toEqual([])
  for (const at of followingTicks(options.tick)) {
    if (settled(control.sqlite)) break
    clearFootballDataPause()
    await runTick(control, at)
  }
  expect(settled(control.sqlite)).toBe(true)
  return snapshot(control.sqlite)
}

describe.each(POLLER_TICKS)(
  'poller da football-data no limite de 50 subrequests, minuto %s',
  (_minute, tick) => {
    it('6 rodadas com 429 de reset 60 s e 8 requests por minuto: o tick fica abaixo de 50, não rejeita e o que não coube vai para a fila', async () => {
      setFootballDataRateLimitForTests(8)
      const options = { tick, rounds: 6, rateLimited: true }
      const h = await setupWorld(options)

      const failures = await runTick(h, tick)

      // Antes: 52 chamadas tentadas, 9 fetches e o tick rejeitado com D1_ERROR.
      expect(failures).toEqual([])
      expect(h.limited.calls()).toBeLessThan(D1_CALLS_PER_INVOCATION)
      expect(h.limited.calls() - CLEANUP_CALLS).toBeLessThanOrEqual(POLLER_BUDGET)
      expect(h.events('football_api_error')).toEqual([])
      expect(h.events('poller_run').map((e) => e.blobs[1])).toEqual(['ok'])
      // 4 rodadas cabem no saldo (38 chamadas, 8 cada) e as 2 outras ficam na fila sem request. As 4
      // admitidas levam o 429 e repetem depois do reset: 8 fetches, nenhum além do saldo planejado.
      expect(h.fetches.fd).toBe(8)
      expect(h.fetches.limited).toBe(4)
      // 46 com a limpeza. Cada 429 gasta 3 chamadas a mais (o bloqueio, a nova vaga e o novo
      // `fetch`), fora da estimativa e dentro do saldo das sincronizações: 3 rodadas gravam, e a
      // 4ª, sem saldo para a gravação depois do retry, volta à fila como as 2 que não couberam.
      expect(h.limited.calls()).toBe(46)
      const pending = workCount(h.sqlite, `provider = 'football-data' AND status = 'pending'`)
      expect(pending).toBe(3)
      expect(finishedMatches(h.sqlite)).toBe(30)
      expect(workCount(h.sqlite, `attempts > 0 OR status IN ('failed', 'running')`)).toBe(0)
      // Sem erro de provedor falso: o adiamento por saldo vale já para o próximo dreno.
      expect(
        workCount(h.sqlite, `last_error LIKE '%saldo%' AND not_before <= ${tick + 2 * MIN}`),
      ).toBe(pending)

      // O dreno e os ticks seguintes terminam, com o resultado e a pontuação de um tick sem limite.
      await drainUntilSettled(h, tick)
      expect(settled(h.sqlite)).toBe(true)
      expect(snapshot(h.sqlite)).toEqual(await controlSnapshot(options))
    })

    it('6 rodadas com respostas normais: 4 cabem, 2 vão para a fila e o dreno as conclui', async () => {
      const options = { tick, rounds: 6 }
      const h = await setupWorld(options)

      expect(await runTick(h, tick)).toEqual([])

      expect(h.limited.calls() - CLEANUP_CALLS).toBeLessThanOrEqual(POLLER_BUDGET)
      expect(h.events('football_api_error')).toEqual([])
      expect(h.fetches.fd).toBe(4)
      expect(finishedMatches(h.sqlite)).toBe(40)
      expect(
        workCount(h.sqlite, `provider = 'football-data' AND status = 'pending' AND attempts = 0`),
      ).toBe(2)
      // Antes: 47 com a limpeza, as 6 rodadas no tick e nenhum saldo para um 429.
      expect(h.limited.calls()).toBe(45)

      await drainUntilSettled(h, tick)
      expect(settled(h.sqlite)).toBe(true)
      expect(snapshot(h.sqlite)).toEqual(await controlSnapshot(options))
    })
  },
)

describe('poller da football-data: o caso comum não muda', () => {
  it.each([
    [1, 15],
    [2, 22],
  ])(
    '%i rodada(s): tudo sincronizado e pontuado no tick, nada adiado, %i chamadas com a limpeza',
    async (rounds, calls) => {
      const tick = POLLER_TICKS[0][1]
      const h = await setupWorld({ tick, rounds })

      expect(await runTick(h, tick)).toEqual([])

      // O mesmo número de chamadas de antes da admissão por custo.
      expect(h.limited.calls()).toBe(calls)
      expect(h.fetches.fd).toBe(rounds)
      expect(workCount(h.sqlite, `1 = 1`)).toBe(0)
      expect(settled(h.sqlite)).toBe(true)
      expect(h.events('football_api_error')).toEqual([])
      expect(h.events('poller_run').map((e) => e.blobs[1])).toEqual(['ok'])
    },
  )

  it('2 rodadas com 429 e retry no tick: o retry cabe no saldo e as duas terminam no próprio tick', async () => {
    const tick = POLLER_TICKS[0][1]
    const h = await setupWorld({ tick, rounds: 2, rateLimited: true })

    expect(await runTick(h, tick)).toEqual([])

    // As mesmas 28 chamadas de antes: as 2 rodadas e os 2 retries, sem nada adiado.
    expect(h.limited.calls()).toBe(28)
    expect(h.fetches.fd).toBe(4)
    expect(workCount(h.sqlite, `1 = 1`)).toBe(0)
    expect(settled(h.sqlite)).toBe(true)
    expect(h.events('football_api_error')).toEqual([])
  })
})
