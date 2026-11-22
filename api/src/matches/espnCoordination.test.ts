/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import template from '../providers/__fixtures__/espn-conmebol-sudamericana-scoreboard.json'
import type { EspnScoreboardEvent } from '../providers/espn'
import { resetEspnClientForTests, setEspnMinIntervalForTests } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import { DrainBudget } from './drainBudget'
import { espnDrain } from './espnWork'
import { scoreWindowFromEspn } from './espnFallback'
import { syncEspnFixtures } from './espnSync'
import { discoverFixtures } from './fixtureDiscovery'
import { pollActiveMatches } from './poller'
import {
  readProviderState,
  resumeProviderAccess,
  setProviderRateLimitForTests,
} from './providerBudget'
import { WORK_MAX_ATTEMPTS, claimProviderWork } from './providerWork'

/**
 * Ponta a ponta da coordenação da ESPN (ADR-027, adendo do ticket 03): poller,
 * descoberta, fallback e dreno reais sobre o SQLite das migrations, com a ESPN
 * simulada. Cobre execuções concorrentes, bloqueio prolongado (403 espaçado até
 * a suspensão e a retomada pelo operador), 429, falha parcial, timeout, resposta
 * incompleta e a regra de que ausência de eventos não confirma resultado.
 */

const MIN = 60_000
const KICKOFF = '2026-10-14T22:00:00Z'
const POLL_AT = Date.parse(KICKOFF) + 130 * MIN
const MATCH_DATE = '20261014'

const handles: DatabaseSync[] = []

beforeEach(() => {
  resetEspnClientForTests()
  setEspnMinIntervalForTests(0)
})

afterEach(() => {
  handles.splice(0).forEach((sqlite) => sqlite.close())
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetEspnClientForTests()
  setProviderRateLimitForTests('espn', 1000)
})

function event(id: string, date: string, finished: boolean): EspnScoreboardEvent {
  const ev = structuredClone(template.events[0]) as EspnScoreboardEvent
  ev.id = id
  ev.date = date
  ev.season = { year: 2026, slug: 'semifinals' }
  ev.competitions![0].status = {
    type: {
      state: finished ? 'post' : 'pre',
      name: finished ? 'STATUS_FINAL' : 'STATUS_SCHEDULED',
      completed: finished,
    },
  }
  for (const c of ev.competitions![0].competitors!) c.score = finished ? '1' : undefined
  return ev
}

type Behavior = (date: string) => Response | Promise<Response>

function createProvider() {
  const calls: { date: string; at: number }[] = []
  const provider = {
    calls,
    behavior: ((date) => scoreboard(date, false)) as Behavior,
    datesCalled: () => calls.map((call) => call.date),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const date = new URL(String(input)).searchParams.get('dates') ?? ''
      calls.push({ date, at: Date.now() })
      return provider.behavior(date)
    }),
  )
  return provider
}

function scoreboard(date: string, finished: boolean): Response {
  const events = date === MATCH_DATE ? [event('espn-1', KICKOFF, finished)] : []
  return Response.json({ events })
}

const status = (code: number, headers: HeadersInit = {}) =>
  new Response('{"message":"erro simulado"}', { status: code, headers })

function fakeAe() {
  const writeDataPoint = vi.fn()
  const points = () =>
    writeDataPoint.mock.calls.map(([point]) => point as { blobs: string[]; doubles: number[] })
  return {
    ae: { writeDataPoint } as unknown as AnalyticsEngineDataset,
    byType: (type: string) => points().filter((point) => point.blobs[0] === type),
  }
}

async function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec('DELETE FROM competitions')
  const provider = createProvider()
  provider.behavior = (date) => (date === 'seed' ? seedBoard() : scoreboard(date, false))
  await syncEspnFixtures({
    db,
    competitionCode: 'conmebol.sudamericana',
    season: 2026,
    dates: ['seed'],
  })
  provider.calls.length = 0
  provider.behavior = (date) => scoreboard(date, false)
  const { ae, byType } = fakeAe()
  const at = (ms: number) => vi.useFakeTimers({ now: ms, toFake: ['Date'] })
  return {
    sqlite,
    db,
    provider,
    ae,
    byType,
    at,
    poll: async (ms: number) => {
      at(ms)
      await pollActiveMatches(db, '', ae, ms)
    },
    drain: async (ms: number) => {
      at(ms)
      // Sem limite de saldo: este teste olha a coordenação, não o orçamento de subrequests.
      await espnDrain({ ae, now: ms }).run(new DrainBudget(db, Infinity))
    },
  }
}

function seedBoard(): Response {
  return Response.json({ events: [event('espn-1', KICKOFF, false)] })
}

function workRows(sqlite: DatabaseSync) {
  return sqlite
    .prepare(
      `SELECT kind, round, status, attempts, not_before, last_error
         FROM provider_work WHERE provider = 'espn' ORDER BY kind, round`,
    )
    .all() as Record<string, string | number | null>[]
}

function matchRows(sqlite: DatabaseSync) {
  return sqlite
    .prepare(
      `SELECT id, external_id, status, home_score, away_score, locked_at IS NOT NULL AS locked,
              scored_at IS NOT NULL AS scored FROM matches ORDER BY external_id`,
    )
    .all()
}

describe('coordenação das chamadas da ESPN: execuções concorrentes', () => {
  it('duas execuções dividem o orçamento do minuto; o resto fica pendente e o dreno retoma', async () => {
    setProviderRateLimitForTests('espn', 2)
    const { sqlite, provider, poll, drain, at } = await setup()

    at(POLL_AT)
    await Promise.all([poll(POLL_AT), poll(POLL_AT)])

    expect(provider.calls).toHaveLength(2)
    const pending = workRows(sqlite)
    expect(pending.length).toBeGreaterThan(0)
    expect(pending.every((row) => row.status === 'pending' && row.attempts === 0)).toBe(true)
    expect(pending.every((row) => String(row.last_error).includes('window_full'))).toBe(true)

    await drain(POLL_AT + 61_000)

    expect(workRows(sqlite).every((row) => row.status === 'done')).toBe(true)
    // Cada execução planeja as mesmas datas, mas só o orçamento autoriza request: as duas
    // execuções somam no máximo 2, e o dreno só busca o que ficou pendente.
    expect(provider.calls.length).toBe(2 + pending.length)
  })

  it('dois drenos simultâneos nunca executam o mesmo item', async () => {
    const { sqlite, provider, poll, drain } = await setup()
    provider.behavior = () => status(500)
    await poll(POLL_AT)
    const queuedBefore = workRows(sqlite).length
    expect(queuedBefore).toBeGreaterThan(0)
    provider.calls.length = 0
    provider.behavior = (date) => scoreboard(date, false)

    const at = POLL_AT + 5 * MIN
    await Promise.all([drain(at), drain(at)])

    const queried = provider.datesCalled()
    expect(new Set(queried).size).toBe(queried.length)
    expect(workRows(sqlite).every((row) => row.status === 'done')).toBe(true)
  })
})

describe('coordenação das chamadas da ESPN: bloqueio prolongado e recuperação', () => {
  it('403 espaça 15 min, 1 h e 6 h, suspende no quarto e só o operador retoma', async () => {
    const { db, sqlite, provider, poll, drain, byType } = await setup()
    provider.behavior = () => status(403)
    const initial = matchRows(sqlite)

    await poll(POLL_AT)
    expect(provider.calls).toHaveLength(1)
    expect(workRows(sqlite).length).toBeGreaterThan(0)
    await poll(POLL_AT + 5 * MIN)
    await drain(POLL_AT + 10 * MIN)
    expect(provider.calls).toHaveLength(1)

    await poll(POLL_AT + 16 * MIN)
    expect(provider.calls).toHaveLength(2)
    await poll(POLL_AT + 60 * MIN)
    await drain(POLL_AT + 70 * MIN)
    expect(provider.calls).toHaveLength(2)

    await poll(POLL_AT + 80 * MIN)
    expect(provider.calls).toHaveLength(3)
    await poll(POLL_AT + 5 * 60 * MIN)
    expect(provider.calls).toHaveLength(3)

    await poll(POLL_AT + 80 * MIN + 6 * 60 * MIN + MIN)
    expect(provider.calls).toHaveLength(4)
    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: 4,
      suspendedReason: 'http_403',
    })
    for (const hours of [8, 10, 12, 14]) {
      await poll(POLL_AT + hours * 60 * MIN + 80 * MIN)
      await drain(POLL_AT + hours * 60 * MIN + 85 * MIN)
    }
    expect(provider.calls).toHaveLength(4)

    expect(byType('provider_access_blocked').map((point) => point.blobs[3])).toEqual([
      'backoff',
      'backoff',
      'backoff',
      'suspended',
    ])
    expect(
      byType('provider_work_run').some(
        (point) => point.blobs.slice(1, 3).join() === 'suspended,espn',
      ),
    ).toBe(true)
    expect(matchRows(sqlite)).toEqual(initial)
    expect(workRows(sqlite).every((row) => row.status === 'pending' && row.attempts === 0)).toBe(
      true,
    )

    const resumeAt = POLL_AT + 15 * 60 * MIN
    provider.behavior = (date) => scoreboard(date, true)
    await resumeProviderAccess(db, 'espn', resumeAt)
    await drain(resumeAt + MIN)

    expect(workRows(sqlite).every((row) => row.status === 'done')).toBe(true)
    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: 0,
      suspendedAt: null,
    })
    expect(matchRows(sqlite)).toEqual([
      expect.objectContaining({ external_id: 'espn-1', status: 'finished', home_score: 1 }),
    ])
    await poll(resumeAt + 5 * MIN)
    expect(matchRows(sqlite)).toEqual([expect.objectContaining({ scored: 1 })])
  })

  it('o sucesso depois de um 403 zera a sequência e a coleta volta ao ritmo normal', async () => {
    const { db, provider, poll } = await setup()
    provider.behavior = () => status(403)
    await poll(POLL_AT)
    expect(await readProviderState(db, 'espn')).toMatchObject({ forbiddenStreak: 1 })

    provider.behavior = (date) => scoreboard(date, true)
    await poll(POLL_AT + 16 * MIN)

    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: 0,
      suspendedAt: null,
    })
  })

  it.each([401, 451])('um %i suspende a coleta na primeira resposta', async (code) => {
    const { db, provider, poll } = await setup()
    provider.behavior = () => status(code)

    await poll(POLL_AT)
    await poll(POLL_AT + 60 * MIN)

    expect(provider.calls).toHaveLength(1)
    expect(await readProviderState(db, 'espn')).toMatchObject({
      suspendedReason: `http_${code}`,
    })
  })
})

describe('coordenação das chamadas da ESPN: 429', () => {
  it('pausa pelo Retry-After, não gasta tentativa e retoma sozinho', async () => {
    const { db, sqlite, provider, poll, drain } = await setup()
    provider.behavior = () => status(429, { 'retry-after': '90' })

    await poll(POLL_AT)
    const callsAfterFirst = provider.calls.length
    expect(callsAfterFirst).toBe(1)
    await poll(POLL_AT + 30_000)
    expect(provider.calls).toHaveLength(callsAfterFirst)
    expect(workRows(sqlite).every((row) => row.attempts === 0)).toBe(true)
    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: 0,
      blockedUntil: POLL_AT + 90_000,
    })

    provider.behavior = (date) => scoreboard(date, true)
    await drain(POLL_AT + 2 * MIN)

    expect(workRows(sqlite).every((row) => row.status === 'done')).toBe(true)
    expect(matchRows(sqlite)).toEqual([expect.objectContaining({ status: 'finished' })])
  })
})

describe('coordenação das chamadas da ESPN: falhas parciais e respostas incompletas', () => {
  it('falha parcial grava as datas que chegaram e adia a que falhou, sem refazer as outras', async () => {
    const { sqlite, provider, poll, drain } = await setup()
    const initial = matchRows(sqlite)
    const early = event('espn-0', '2026-10-13T20:00:00Z', false)
    provider.behavior = (date) =>
      date === '20261013' ? Response.json({ events: [early] }) : status(503)

    await poll(POLL_AT)

    expect(provider.datesCalled()).toEqual(['20261013', '20261014', '20261014'])
    expect(matchRows(sqlite).map((row) => (row as { external_id: string }).external_id)).toEqual([
      'espn-0',
      'espn-1',
    ])
    expect(matchRows(sqlite)[1]).toEqual(initial[0])
    expect(workRows(sqlite)).toEqual([
      expect.objectContaining({ kind: 'result', round: '20261014', status: 'pending' }),
    ])

    provider.calls.length = 0
    provider.behavior = (date) => scoreboard(date, true)
    await drain(POLL_AT + 5 * MIN)

    expect(provider.datesCalled()).toEqual(['20261014'])
    expect(workRows(sqlite)).toEqual([
      expect.objectContaining({ round: '20261014', status: 'done' }),
    ])
    expect(matchRows(sqlite)[1]).toMatchObject({
      id: (initial[0] as { id: string }).id,
      status: 'finished',
    })
  })

  it('timeout conta tentativa, vira falha no teto e o produtor revive o item no tick seguinte', async () => {
    const { sqlite, provider, poll, drain, byType } = await setup()
    provider.behavior = () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }
    await poll(POLL_AT)
    expect(workRows(sqlite).length).toBeGreaterThan(0)

    for (let i = 1; i <= WORK_MAX_ATTEMPTS; i++) {
      await drain(POLL_AT + (5 + i * 10) * MIN)
    }

    const failed = workRows(sqlite)
    expect(
      failed.every((row) => row.status === 'failed' && row.attempts === WORK_MAX_ATTEMPTS),
    ).toBe(true)
    expect(byType('provider_work_run').some((point) => point.blobs[1] === 'error')).toBe(true)

    await poll(POLL_AT + 3 * 60 * MIN)
    expect(workRows(sqlite).every((row) => row.status === 'pending' && row.attempts === 0)).toBe(
      true,
    )

    provider.behavior = (date) => scoreboard(date, true)
    await drain(POLL_AT + 4 * 60 * MIN)
    expect(workRows(sqlite).every((row) => row.status === 'done')).toBe(true)
    expect(matchRows(sqlite)).toEqual([expect.objectContaining({ status: 'finished' })])
  })

  it('resposta 200 sem a lista de eventos é incompleta: não confirma nada e fica pendente', async () => {
    const { sqlite, provider, poll } = await setup()
    const initial = matchRows(sqlite)
    provider.behavior = () => Response.json({})

    await poll(POLL_AT)

    expect(matchRows(sqlite)).toEqual(initial)
    const pending = workRows(sqlite)
    expect(pending.length).toBeGreaterThan(0)
    expect(pending.every((row) => row.status === 'pending')).toBe(true)
    expect(String(pending[0].last_error)).toContain('resposta incompleta')
  })

  it('data sem eventos não confirma resultado: a partida segue pendente e nada é cancelado', async () => {
    const { sqlite, provider, poll, drain } = await setup()
    const initial = matchRows(sqlite)
    provider.behavior = () => Response.json({ events: [] })

    await poll(POLL_AT)
    await drain(POLL_AT + 5 * MIN)
    await poll(POLL_AT + 30 * MIN)

    expect(matchRows(sqlite)).toEqual(initial)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM matches').get()).toEqual({ n: 1 })
    expect(sqlite.prepare('SELECT status, postponed FROM matches').get()).toEqual({
      status: 'scheduled',
      postponed: 0,
    })
  })

  it('a identidade da partida se mantém entre o sync parcial e a recuperação', async () => {
    const { sqlite, provider, poll, drain } = await setup()
    const before = sqlite
      .prepare('SELECT id, external_id, home_team_id, away_team_id FROM matches')
      .all()
    provider.behavior = (date) => (date === MATCH_DATE ? status(500) : scoreboard(date, false))
    await poll(POLL_AT)
    provider.behavior = (date) => scoreboard(date, true)
    await drain(POLL_AT + 5 * MIN)

    expect(
      sqlite.prepare('SELECT id, external_id, home_team_id, away_team_id FROM matches').all(),
    ).toEqual(before)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM teams').get()).toEqual({ n: 2 })
  })
})

describe('coordenação das chamadas da ESPN: reinício do dreno', () => {
  it('o item de um dreno que morreu volta depois do lease e o resultado atrasado não o fecha', async () => {
    const { db, sqlite, provider, poll } = await setup()
    provider.behavior = () => status(500)
    await poll(POLL_AT)
    const now = POLL_AT + 5 * MIN
    const claimedByA = await claimProviderWork(db, { provider: 'espn', now })
    expect(claimedByA.length).toBeGreaterThan(0)

    expect(await claimProviderWork(db, { provider: 'espn', now: now + MIN })).toEqual([])
    const claimedByB = await claimProviderWork(db, { provider: 'espn', now: now + 6 * MIN })
    expect(claimedByB.map((item) => item.round).sort()).toEqual(
      claimedByA.map((item) => item.round).sort(),
    )
    expect(claimedByB[0].leaseOwner).not.toBe(claimedByA[0].leaseOwner)
    expect(workRows(sqlite).every((row) => row.status === 'running')).toBe(true)
  })
})

describe('coordenação das chamadas da ESPN: descoberta e fallback', () => {
  it('a descoberta com 403 alimenta o gate, adia as nove datas e não avança o status', async () => {
    const { sqlite, db, provider, ae, byType, at } = await setup()
    sqlite.exec("UPDATE competitions SET status = 'upcoming'")
    provider.behavior = () => status(403)
    at(POLL_AT)

    await discoverFixtures(db, '', ae, POLL_AT)

    expect(provider.calls).toHaveLength(1)
    expect(workRows(sqlite)).toHaveLength(9)
    expect(sqlite.prepare('SELECT status FROM competitions').get()).toEqual({ status: 'upcoming' })
    expect(byType('football_api_error')).toHaveLength(0)
    expect(byType('provider_access_blocked')).toHaveLength(1)
    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: 1,
      blockedUntil: POLL_AT + 15 * MIN,
    })

    await discoverFixtures(db, '', ae, POLL_AT + 5 * MIN)
    expect(provider.calls).toHaveLength(1)
  })

  it('o fallback pelo poller respeita o bloqueio: sem request e sem erro de fallback', async () => {
    const { sqlite, db, provider, ae, byType, at } = await setup()
    sqlite.exec(
      `INSERT INTO competitions (id,name,slug,external_id,provider,season,status)
         VALUES ('fd','Brasileirão','brasileirao-2026','BSA','football-data','2026','ongoing');
       INSERT INTO teams (id,name,slug) VALUES ('flamengo','Flamengo','flamengo'),
         ('corinthians','Corinthians','corinthians');
       INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round)
         VALUES ('m-fd','fd','900','football-data','flamengo','corinthians','${KICKOFF}','scheduled','1')`,
    )
    provider.behavior = () => status(403)
    at(POLL_AT)

    await scoreWindowFromEspn(db, ae, ['fd'], { now: POLL_AT, coordinate: true })
    const firstCalls = provider.calls.length
    expect(firstCalls).toBeGreaterThan(0)
    await scoreWindowFromEspn(db, ae, ['fd'], { now: POLL_AT + MIN, coordinate: true })

    expect(provider.calls).toHaveLength(firstCalls)
    expect(byType('match_results_fallback')).toHaveLength(0)
    expect(sqlite.prepare("SELECT status FROM matches WHERE id = 'm-fd'").get()).toEqual({
      status: 'scheduled',
    })
  })
})
