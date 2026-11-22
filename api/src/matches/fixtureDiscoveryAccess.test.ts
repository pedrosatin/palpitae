/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_DISCOVERY_CRON } from '../crons'
import worker from '../index'
import template from '../providers/__fixtures__/espn-conmebol-sudamericana-scoreboard.json'
import {
  resetEspnClientForTests,
  setEspnMinIntervalForTests,
  type EspnScoreboardEvent,
} from '../providers/espn'
import { D1_CALLS_PER_INVOCATION, limitD1Calls } from '../testing/d1CallLimit'
import { flakyD1 } from '../testing/flakyD1'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { readProviderState, resumeProviderAccess } from './providerBudget'
import { syncEspnFixtures } from './espnSync'
import { clearFootballDataPause } from './footballDataQuota'
import { espnDate } from './matchPollingWindow'
import { syncFixtures } from './sync'

/**
 * A descoberta diária (`15 6 * * *`) e o controle de acesso da ESPN (ADR-027, adendo
 * do ticket 03). Cada tentativa reserva vaga, faz o request e registra a resposta
 * no D1, inclusive em caso de sucesso, ao custo de 3 chamadas. A descoberta lê o
 * estado de acesso antes e pula a ESPN suspensa ou bloqueada. O teste usa o
 * `scheduled` real sobre o SQLite das migrations.
 */

const DAY = 24 * 60 * 60_000
const MIN = 60_000
const DISCOVERY_AT = Date.UTC(2026, 10, 17, 6, 15, 0)
const TODAY = Date.UTC(2026, 10, 17)
const ESPN_SLUGS = ['conmebol.libertadores', 'conmebol.sudamericana'] as const

const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers({ now: DISCOVERY_AT, toFake: ['Date'] })
  resetEspnClientForTests()
  setEspnMinIntervalForTests(0)
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  clearFootballDataPause()
  resetEspnClientForTests()
})

type EspnGame = { key: string; dayOffset: number }

const SEEDED: EspnGame = { key: 'semente', dayOffset: 1 }
const NEW_GAMES: EspnGame[] = [
  { key: 'novo-1', dayOffset: 2 },
  { key: 'novo-2', dayOffset: 5 },
]

function espnEvent(slug: string, game: EspnGame): EspnScoreboardEvent {
  const ev = structuredClone(template.events[0]) as EspnScoreboardEvent
  ev.id = `ev-${slug}-${game.key}`
  ev.date = new Date(TODAY + game.dayOffset * DAY + 20 * 3_600_000).toISOString().slice(0, 16) + 'Z'
  ev.season = { year: 2026, slug: 'semifinals' }
  ev.competitions![0].status = {
    type: { state: 'pre', name: 'STATUS_SCHEDULED', completed: false },
  }
  const [home, away] = ev.competitions![0].competitors!
  for (const [side, tag] of [
    [home, 'm'],
    [away, 'v'],
  ] as const) {
    const id = `${slug}-${game.key}-${tag}`
    side.id = id
    side.team = { ...side.team, id, displayName: `Time ${id}`, abbreviation: tag.toUpperCase() }
    side.score = undefined
    side.winner = undefined
  }
  return ev
}

function fdCalendar(discovering: boolean) {
  const team = (n: number) => ({
    id: 2000 + n,
    name: `Time PPL-${n}`,
    shortName: `P${n}`,
    tla: 'TIM',
  })
  const game = (n: number, dayOffset: number) => ({
    id: 2017000 + n,
    utcDate: new Date(TODAY + dayOffset * DAY + 20 * 3_600_000).toISOString().slice(0, 19) + 'Z',
    status: 'TIMED',
    matchday: n,
    stage: 'REGULAR_SEASON',
    group: null,
    homeTeam: team(2 * n),
    awayTeam: team(2 * n + 1),
    score: { duration: 'REGULAR', fullTime: { home: null, away: null } },
  })
  return {
    competition: { id: 2017, code: 'PPL', name: 'Primeira Liga' },
    matches: [game(1, 1), ...(discovering ? [game(2, 3)] : [])],
  }
}

type WorldOptions = {
  espn: number
  fd?: boolean
  wrap?: (db: D1Database) => D1Database
}

type Behavior = { espn: null | ((slug: string, date: string) => Response | null) }

async function setupWorld({ espn, fd = false, wrap = (raw) => raw }: WorldOptions) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec('DELETE FROM competitions')
  const behavior: Behavior = { espn: null }
  const fetches = { espn: 0, fd: 0 }
  const requested: string[] = []
  let chargeFetch: () => void = () => {}
  let discovering = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      chargeFetch()
      const url = new URL(String(input))
      if (url.hostname === 'api.football-data.org') {
        fetches.fd += 1
        return Response.json(fdCalendar(discovering))
      }
      fetches.espn += 1
      const slug = url.pathname.split('/').at(-2) ?? ''
      const date = url.searchParams.get('dates') ?? ''
      requested.push(`${slug}:${date}`)
      const custom = behavior.espn?.(slug, date)
      if (custom) return custom
      const games = date === 'seed' ? [SEEDED] : discovering ? [SEEDED, ...NEW_GAMES] : [SEEDED]
      const events = games
        .filter(
          (game) =>
            date === 'seed' || espnDate(TODAY + game.dayOffset * DAY + 20 * 3_600_000) === date,
        )
        .map((game) => espnEvent(slug, game))
      return Response.json({ events })
    }),
  )
  for (const slug of ESPN_SLUGS.slice(0, espn)) {
    await syncEspnFixtures({ db, competitionCode: slug, season: 2026, dates: ['seed'] })
  }
  if (fd)
    await syncFixtures({ competitionCode: 'PPL', season: 2026, matchday: 1, db, apiKey: 'test' })
  discovering = true
  fetches.espn = 0
  fetches.fd = 0
  requested.length = 0

  const limited = limitD1Calls(wrap(db), D1_CALLS_PER_INVOCATION)
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
  return { sqlite, db, behavior, fetches, requested, limited, env, events }
}

type World = Awaited<ReturnType<typeof setupWorld>>

async function runDiscovery(
  h: Pick<World, 'limited' | 'env'>,
  at = DISCOVERY_AT,
): Promise<string[]> {
  vi.setSystemTime(at)
  h.limited.startInvocation()
  const pending: Promise<unknown>[] = []
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as ExecutionContext
  await worker.scheduled!(
    { cron: FIXTURE_DISCOVERY_CRON, scheduledTime: at } as ScheduledController,
    h.env,
    ctx,
  )
  const settled = await Promise.allSettled(pending)
  return settled.flatMap((r) =>
    r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : [],
  )
}

const matchCount = (sqlite: DatabaseSync): number =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM matches`).get() as { n: number }).n

const queueCount = (sqlite: DatabaseSync): number =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM provider_work`).get() as { n: number }).n

const suspend = (sqlite: DatabaseSync, reason = 'http_401') =>
  sqlite.exec(
    `UPDATE provider_rate_state SET suspended_at = ${DISCOVERY_AT - DAY}, suspended_reason = '${reason}' WHERE provider = 'espn'`,
  )

describe('descoberta com a ESPN suspensa ou bloqueada', () => {
  it('suspensa: nenhum fetch à ESPN, a descoberta conclui sem erro e sem fila, e a football-data segue', async () => {
    const h = await setupWorld({ espn: 2, fd: true })
    suspend(h.sqlite)
    const before = matchCount(h.sqlite)

    const failures = await runDiscovery(h)

    expect(failures).toEqual([])
    expect(h.fetches.espn).toBe(0)
    expect(h.fetches.fd).toBe(1)
    expect(matchCount(h.sqlite)).toBe(before + 1)
    expect(h.events('football_api_error')).toEqual([])
    expect(h.events('fixture_discovery_run')[0].blobs[1]).toBe('ok')
    expect(queueCount(h.sqlite)).toBe(0)
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
  })

  it('bloqueada (403 ou 429 vigente): nenhum fetch à ESPN e nenhum erro', async () => {
    const h = await setupWorld({ espn: 1 })
    h.sqlite.exec(
      `UPDATE provider_rate_state SET blocked_until = ${DISCOVERY_AT + 5 * MIN}, forbidden_streak = 1 WHERE provider = 'espn'`,
    )

    expect(await runDiscovery(h)).toEqual([])

    expect(h.fetches.espn).toBe(0)
    expect(h.events('football_api_error')).toEqual([])
    expect(queueCount(h.sqlite)).toBe(0)
  })

  it('o bloqueio vencido não pula: a descoberta chama a ESPN e grava os jogos novos', async () => {
    const h = await setupWorld({ espn: 1 })
    h.sqlite.exec(
      `UPDATE provider_rate_state SET blocked_until = ${DISCOVERY_AT - MIN} WHERE provider = 'espn'`,
    )
    const before = matchCount(h.sqlite)

    expect(await runDiscovery(h)).toEqual([])

    expect(h.fetches.espn).toBe(9)
    expect(matchCount(h.sqlite)).toBe(before + NEW_GAMES.length)
  })

  it('retomada pelo operador: a descoberta seguinte volta a chamar a ESPN', async () => {
    const h = await setupWorld({ espn: 1 })
    suspend(h.sqlite)
    await runDiscovery(h)
    expect(h.fetches.espn).toBe(0)

    await resumeProviderAccess(h.db, 'espn', DISCOVERY_AT + MIN)
    expect(await runDiscovery(h, DISCOVERY_AT + 2 * MIN)).toEqual([])

    expect(h.fetches.espn).toBe(9)
  })
})

describe('descoberta alimenta o controle de acesso com as respostas de erro', () => {
  it('um 403 bloqueia o provedor (15 min), alerta e para os requests seguintes da mesma invocação', async () => {
    const h = await setupWorld({ espn: 2 })
    h.behavior.espn = () => new Response('{"message":"proibido"}', { status: 403 })

    expect(await runDiscovery(h)).toEqual([])

    expect(h.fetches.espn).toBe(1)
    expect(await readProviderState(h.db, 'espn')).toMatchObject({
      forbiddenStreak: 1,
      blockedUntil: DISCOVERY_AT + 15 * MIN,
    })
    expect(h.events('provider_access_blocked')).toHaveLength(1)
    expect(h.events('football_api_error')).toEqual([])
    expect(queueCount(h.sqlite)).toBe(18)

    expect(await runDiscovery(h, DISCOVERY_AT + 5 * MIN)).toEqual([])
    expect(h.fetches.espn).toBe(1)
  })

  it.each([
    [401, {}, 'http_401'],
    [451, {}, 'http_451'],
  ])('um %i suspende a coleta (%s) para todas as execuções', async (status, headers, reason) => {
    const h = await setupWorld({ espn: 1 })
    h.behavior.espn = () => new Response('{}', { status, headers })

    expect(await runDiscovery(h)).toEqual([])

    expect(h.fetches.espn).toBe(1)
    expect(await readProviderState(h.db, 'espn')).toMatchObject({ suspendedReason: reason })
  })

  it('um 429 com Retry-After de 2 h bloqueia pelo prazo inteiro', async () => {
    const h = await setupWorld({ espn: 1 })
    h.behavior.espn = () => new Response('{}', { status: 429, headers: { 'Retry-After': '7200' } })

    expect(await runDiscovery(h)).toEqual([])

    expect(h.fetches.espn).toBe(1)
    expect(await readProviderState(h.db, 'espn')).toMatchObject({
      blockedUntil: DISCOVERY_AT + 120 * MIN,
      forbiddenStreak: 0,
    })
  })

  it('cada sucesso reserva a vaga e registra a resposta no estado de acesso', async () => {
    const sqls: string[] = []
    const h = await setupWorld({
      espn: 1,
      wrap: (db) =>
        flakyD1(db, {
          failStatement: (sql) => {
            sqls.push(sql)
            return false
          },
        }),
    })

    expect(await runDiscovery(h)).toEqual([])

    const access = sqls.filter((sql) => sql.includes('provider_rate_state'))
    expect(access).toHaveLength(19)
    expect(access[0]).toMatch(/^\s*SELECT/)
  })

  it('o erro de 5xx não vira bloqueio: segue o caminho de falha da descoberta, como antes', async () => {
    const h = await setupWorld({ espn: 1 })
    h.behavior.espn = () => new Response('{}', { status: 503 })

    expect(await runDiscovery(h)).toEqual([])

    expect(await readProviderState(h.db, 'espn')).toMatchObject({
      forbiddenStreak: 0,
      blockedUntil: 0,
      suspendedAt: null,
    })
    expect(h.events('football_api_error').length).toBeGreaterThan(0)
    expect(h.events('fixture_discovery_run')[0].blobs[1]).toBe('error')
  })
})

describe('descoberta com a ESPN liberada: o caso comum', () => {
  it('1 competição: o mesmo resultado com as reservas e o registro das respostas', async () => {
    const h = await setupWorld({ espn: 1 })
    const before = matchCount(h.sqlite)

    expect(await runDiscovery(h)).toEqual([])

    expect(h.fetches.espn).toBe(9)
    expect(matchCount(h.sqlite)).toBe(before + NEW_GAMES.length)
    expect(queueCount(h.sqlite)).toBe(0)
    expect(h.events('football_api_error')).toEqual([])
    // Às 19 chamadas anteriores somam-se 18 da reserva e do registro das nove respostas
    // e 1 da leitura do estado de acesso, totalizando 38.
    expect(h.limited.calls()).toBe(MAIN_CALLS_ONE_COMPETITION + 19)
  })
})

const MAIN_CALLS_ONE_COMPETITION = 19
