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
 * resultado, os pontos dos palpites e o ranking que a semente define.
 */

const MIN = 60_000
const POLLER_TICKS = [
  ['30', Date.UTC(2026, 10, 17, 14, 30, 0)],
  ['0', Date.UTC(2026, 10, 17, 15, 0, 0)],
] as const
const CLEANUP_CALLS = 1
const POLLER_BUDGET = 45

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

const COMPETITIONS = [
  ['2017', 'PPL'],
  ['2021', 'PL'],
  ['2016', 'ELC'],
  ['2014', 'PD'],
  ['2019', 'SA'],
  ['2002', 'BL1'],
  ['2015', 'FL1'],
  ['2003', 'DED'],
  ['2013', 'BSA'],
  ['2001', 'CL'],
  ['2000', 'WC'],
] as const

const GAMES = 10

function fdCalendar(tick: number, comp: number, matchday: number, status: 'TIMED' | 'FINISHED') {
  const [id, code] = COMPETITIONS[comp]
  const team = (n: number) => ({
    id: comp * 100_000 + matchday * 1000 + n,
    name: `Time ${code} ${matchday}-${n}`,
    shortName: `T${matchday}-${n}`,
    tla: 'TIM',
  })
  return {
    competition: { id: Number(id), code, name: code },
    matches: Array.from({ length: GAMES }, (_, i) => ({
      id: matchId(comp, matchday, i),
      utcDate: new Date(tick - 130 * MIN).toISOString().slice(0, 19) + 'Z',
      status,
      matchday,
      stage: 'REGULAR_SEASON',
      group: null,
      homeTeam: team(2 * i),
      awayTeam: team(2 * i + 1),
      score: {
        duration: 'REGULAR',
        fullTime: status === 'FINISHED' ? finalScore(i) : { home: null, away: null },
      },
    })),
  }
}

const matchId = (comp: number, matchday: number, i: number) =>
  567_000 + comp * 10_000 + matchday * 100 + i

const finalScore = (i: number) => ({ home: i % 3, away: i % 2 })

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
  rounds: number
  competitions?: number
  rateLimited?: boolean
  initial429?: number
  limit?: number | null
}

const EXACT_USER = 'user-exato'
const DRAW_USER = 'user-empate'

const DRAW_POINTS = [1, 3, 0, 0, 0, 0, 1, 3, 0, 0]

function seedPredictions(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
      ('${EXACT_USER}', 'exato@example.test', 'google', 'g-exato', 'Exato'),
      ('${DRAW_USER}', 'empate@example.test', 'google', 'g-empate', 'Empate');
    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code, payment_status)
      SELECT 'grupo-' || external_id, 'Grupo ' || external_id, id, '${EXACT_USER}',
             'convite-' || external_id, 'paid'
        FROM competitions;
    INSERT INTO group_members (id, group_id, user_id, role)
      SELECT g.id || '-' || u.id, g.id, u.id, CASE u.id WHEN '${EXACT_USER}' THEN 'owner' ELSE 'member' END
        FROM groups g CROSS JOIN users u;
  `)
  const predict = sqlite.prepare(
    `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score)
     SELECT ? || '-' || m.id, ?, g.id, m.id, ?, ?
       FROM matches m JOIN groups g ON g.competition_id = m.competition_id
      WHERE m.external_id = ?`,
  )
  const ids = sqlite.prepare(`SELECT external_id FROM matches`).all() as { external_id: string }[]
  for (const { external_id } of ids) {
    const { home, away } = finalScore(Number(external_id) % 100)
    predict.run(EXACT_USER, EXACT_USER, home, away, external_id)
    predict.run(DRAW_USER, DRAW_USER, 1, 1, external_id)
  }
}

async function setupWorld(options: WorldOptions) {
  const {
    tick,
    rounds,
    competitions = 1,
    rateLimited = false,
    initial429 = 0,
    limit = D1_CALLS_PER_INVOCATION,
  } = options
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
      if (live && fetches.fd <= initial429) {
        fetches.limited += 1
        return quotaExhausted(1)
      }
      if (live && rateLimited && Date.now() < tick + MIN) {
        fetches.limited += 1
        return quotaExhausted(60)
      }
      const code = url.pathname.split('/').at(-2)
      const comp = COMPETITIONS.findIndex(([id]) => id === code)
      const matchday = Number(url.searchParams.get('matchday') ?? '1')
      return Response.json(fdCalendar(tick, comp, matchday, live ? 'FINISHED' : 'TIMED'))
    }),
  )
  for (const [id] of COMPETITIONS.slice(0, competitions)) {
    for (let round = 1; round <= rounds; round++) {
      await syncFixtures({ competitionCode: id, season: 2026, matchday: round, db, apiKey: 'test' })
    }
  }
  seedPredictions(sqlite)
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
  return { sqlite, fetches, limited, env, events, writeDataPoint, options }
}

type World = Awaited<ReturnType<typeof setupWorld>>

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

function expectNoD1Error(h: World) {
  const logged = [console.error, console.warn, console.info].flatMap((fn) =>
    vi.mocked(fn).mock.calls.map((args) => args.map(String).join(' ')),
  )
  expect(logged.filter((line) => line.includes('D1_ERROR'))).toEqual([])
  const points = h.writeDataPoint.mock.calls.map(([point]) => JSON.stringify(point))
  expect(points.filter((point) => point.includes('D1_ERROR'))).toEqual([])
}

function snapshot(sqlite: DatabaseSync) {
  return {
    matches: sqlite
      .prepare(
        `SELECT external_id, status, home_score AS home, away_score AS away,
                scored_at IS NOT NULL AS scored
           FROM matches ORDER BY external_id`,
      )
      .all(),
    predictions: sqlite
      .prepare(
        `SELECT m.external_id AS external_id, p.user_id AS user_id, p.points_awarded AS points
           FROM predictions p JOIN matches m ON m.id = p.match_id
          ORDER BY m.external_id, p.user_id`,
      )
      .all(),
    ranking: sqlite
      .prepare(
        `SELECT group_id, user_id, total_points, exact_hits
           FROM leaderboard ORDER BY group_id, user_id`,
      )
      .all(),
  }
}

function expectedSnapshot({ rounds, competitions = 1 }: WorldOptions) {
  const comps = COMPETITIONS.slice(0, competitions).map(([id], comp) => ({ id, comp }))
  const games = comps.flatMap(({ comp }) =>
    Array.from({ length: rounds }, (_, r) =>
      Array.from({ length: GAMES }, (_, i) => ({ id: String(matchId(comp, r + 1, i)), i })),
    ).flat(),
  )
  const byId = <T extends { external_id: string }>(rows: T[]) =>
    rows.sort((a, b) => a.external_id.localeCompare(b.external_id))
  const drawRound = DRAW_POINTS.reduce((sum, points) => sum + points, 0)
  return {
    matches: byId(
      games.map(({ id, i }) => ({
        external_id: id,
        status: 'finished',
        ...finalScore(i),
        scored: 1,
      })),
    ),
    predictions: byId(
      games.flatMap(({ id, i }) => [
        { external_id: id, user_id: DRAW_USER, points: DRAW_POINTS[i] },
        { external_id: id, user_id: EXACT_USER, points: 3 },
      ]),
    ),
    ranking: comps
      .map(({ id }) => `grupo-${id}`)
      .sort()
      .flatMap((group_id) => [
        {
          group_id,
          user_id: DRAW_USER,
          total_points: drawRound * rounds,
          exact_hits: DRAW_POINTS.filter((points) => points === 3).length * rounds,
        },
        {
          group_id,
          user_id: EXACT_USER,
          total_points: 3 * GAMES * rounds,
          exact_hits: GAMES * rounds,
        },
      ]),
  }
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

function settled(sqlite: DatabaseSync): boolean {
  const open = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM matches WHERE status != 'finished' OR scored_at IS NULL`)
    .get() as { n: number }
  return open.n === 0 && workCount(sqlite, `status IN ('pending', 'running')`) === 0
}

async function drainUntilExpected(h: World, tick: number) {
  for (const at of followingTicks(tick)) {
    if (settled(h.sqlite)) break
    expect(await runTick(h, at)).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    expect(workCount(h.sqlite, `status = 'running'`)).toBe(0)
    expect(workCount(h.sqlite, `attempts > 0`)).toBe(0)
  }
  expect(settled(h.sqlite)).toBe(true)
  expect(snapshot(h.sqlite)).toEqual(expectedSnapshot(h.options))
}

describe('poller da football-data: o estado esperado da semente', () => {
  it('um tick sem limite de chamadas, com 2 rodadas, chega ao estado esperado', async () => {
    const tick = POLLER_TICKS[0][1]
    const h = await setupWorld({ tick, rounds: 2, limit: null })

    expect(await runTick(h, tick)).toEqual([])

    // O controle não depende da fila: o próprio tick deixa os pontos e o ranking esperados.
    expect(workCount(h.sqlite, `1 = 1`)).toBe(0)
    expect(snapshot(h.sqlite)).toEqual(expectedSnapshot(h.options))
  })
})

describe.each(POLLER_TICKS)(
  'poller da football-data no limite de 50 subrequests, minuto %s',
  (_minute, tick) => {
    it('6 rodadas com 429 de reset 60 s e 8 requests por minuto: o tick fica abaixo de 50, não rejeita e o que não coube vai para a fila', async () => {
      setFootballDataRateLimitForTests(8)
      const h = await setupWorld({ tick, rounds: 6, rateLimited: true })

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
      // 45 com a limpeza. Cada 429 gasta 3 chamadas a mais (o bloqueio, a nova vaga e o novo
      // `fetch`), fora da estimativa e dentro do saldo das sincronizações: 3 rodadas gravam, e a
      // 4ª, sem saldo para a gravação depois do retry, volta à fila como as 2 que não couberam. O
      // fallback da ESPN não cabe no que sobra (o custo completo de uma competição é 11) e nem
      // consulta o D1.
      expect(h.limited.calls()).toBe(45)
      expect(h.fetches.espn).toBe(0)
      const pending = workCount(h.sqlite, `provider = 'football-data' AND status = 'pending'`)
      expect(pending).toBe(3)
      expect(finishedMatches(h.sqlite)).toBe(30)
      expect(workCount(h.sqlite, `attempts > 0 OR status IN ('failed', 'running')`)).toBe(0)
      // Sem erro de provedor falso: o adiamento por saldo vale já para o próximo dreno.
      expect(
        workCount(h.sqlite, `last_error LIKE '%saldo%' AND not_before <= ${tick + 2 * MIN}`),
      ).toBe(pending)

      // O dreno e os ticks seguintes terminam com os pontos e o ranking esperados.
      await drainUntilExpected(h, tick)
    })

    it('com respostas normais, sincroniza 4 rodadas e enfileira 2 para o dreno', async () => {
      const h = await setupWorld({ tick, rounds: 6 })

      expect(await runTick(h, tick)).toEqual([])

      expect(h.limited.calls() - CLEANUP_CALLS).toBeLessThanOrEqual(POLLER_BUDGET)
      expect(h.events('football_api_error')).toEqual([])
      expect(h.fetches.fd).toBe(4)
      expect(finishedMatches(h.sqlite)).toBe(40)
      expect(
        workCount(h.sqlite, `provider = 'football-data' AND status = 'pending' AND attempts = 0`),
      ).toBe(2)
      // Antes: 47 com a limpeza, as 6 rodadas no tick e nenhum saldo para um 429. Com as 4
      // rodadas (7 chamadas cada) e o enfileiramento das outras 2, sobram 10 chamadas além da
      // reserva da pontuação, menos que as 11 de uma competição no fallback da ESPN: ele espera o
      // próximo tick sem consultar o D1, e o tick fica em 38.
      expect(h.limited.calls()).toBe(38)
      expect(h.fetches.espn).toBe(0)

      await drainUntilExpected(h, tick)
    })

    it('11 competições com uma rodada cada e 4 respostas 429 de reset 1 s: o fallback da ESPN também fica no saldo e a chamada 51 nunca sai', async () => {
      const h = await setupWorld({ tick, rounds: 1, competitions: 11, initial429: 4 })

      const failures = await runTick(h, tick)

      // Antes: o fallback consultava o D1 de cada competição sem saldo, 51 chamadas tentadas e a 51
      // recusada com D1_ERROR, engolido no relatório final.
      expect(failures).toEqual([])
      expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
      expect(h.limited.calls() - CLEANUP_CALLS).toBeLessThanOrEqual(POLLER_BUDGET)
      expectNoD1Error(h)
      expect(h.events('football_api_error')).toEqual([])
      expect(h.events('poller_run').map((e) => e.blobs[1])).toEqual(['ok'])
      // As 4 primeiras rodadas levam o 429 e repetem depois do reset (8 fetches); 3 sincronizam e 8
      // vão para a fila. O fallback, sem as 11 chamadas de uma competição livres, não consulta nada.
      // O tick gasta 46 chamadas: as 45 do orçamento do poller e a limpeza do `scheduled`.
      expect(h.fetches.fd).toBe(8)
      expect(h.fetches.limited).toBe(4)
      expect(h.fetches.espn).toBe(0)
      expect(h.limited.calls()).toBe(46)
      expect(workCount(h.sqlite, `provider = 'football-data' AND status = 'pending'`)).toBe(8)
      expect(workCount(h.sqlite, `attempts > 0 OR status IN ('failed', 'running')`)).toBe(0)

      await drainUntilExpected(h, tick)
      expectNoD1Error(h)
    })
  },
)

describe('poller da football-data: as rodadas adiadas pontuam no dreno', () => {
  it('6 rodadas no minuto 0: o dreno do minuto 5 grava o placar, os pontos e o ranking das 2 adiadas, sem esperar o poller do minuto 30', async () => {
    const tick = POLLER_TICKS[1][1]
    const h = await setupWorld({ tick, rounds: 6 })

    expect(await runTick(h, tick)).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    // O poller sincroniza e pontua 4 rodadas; as 2 que não couberam esperam o dreno, sem placar.
    expect(finishedMatches(h.sqlite)).toBe(40)
    expect(workCount(h.sqlite, `status = 'pending' AND attempts = 0`)).toBe(2)

    // Só o dreno do minuto 5, nenhum poller depois do tick.
    const drain = tick + 5 * MIN
    expect(new Date(drain).getUTCMinutes()).toBe(5)
    expect(await runTick(h, drain)).toEqual([])

    // A chamada 51, que o D1 recusaria, nunca sai.
    expect(h.limited.calls()).toBeLessThan(D1_CALLS_PER_INVOCATION)
    expectNoD1Error(h)
    expect(h.events('football_api_error')).toEqual([])
    expect(workCount(h.sqlite, `status != 'done' OR attempts > 0`)).toBe(0)
    // Placar, `scored_at`, pontos dos palpites e ranking das 6 rodadas, como a semente define.
    expect(snapshot(h.sqlite)).toEqual(expectedSnapshot(h.options))
    // O dreno gasta 24: a limpeza, a sondagem do coordenador, reclamar, as 2 rodadas (7 do sync e
    // 3 da pontuação cada) e o estado.
    expect(h.limited.calls()).toBe(24)
    expect(h.fetches.fd).toBe(6)
  })
})

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
      expect(snapshot(h.sqlite)).toEqual(expectedSnapshot(h.options))
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
    expect(snapshot(h.sqlite)).toEqual(expectedSnapshot(h.options))
    expect(h.events('football_api_error')).toEqual([])
  })
})
