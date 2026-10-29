/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sudamericanaJson from '../providers/__fixtures__/espn-conmebol-sudamericana-scoreboard.json'
import type { EspnCompetitorTeam, EspnScoreboardEvent } from '../providers/espn'
import {
  resetEspnClientForTests,
  setEspnMinIntervalForTests,
} from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import { ESPN_PRIMARY_COMPETITIONS, syncEspnFixtures } from './espnSync'

const handles: DatabaseSync[] = []

beforeEach(() => {
  resetEspnClientForTests()
  setEspnMinIntervalForTests(0)
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  resetEspnClientForTests()
})

function database() {
  const result = createSqliteD1()
  handles.push(result.sqlite)
  return result
}

function realEvent(id = 'real-event'): EspnScoreboardEvent {
  const event: EspnScoreboardEvent = structuredClone(sudamericanaJson.events[0])
  event.id = id
  return event
}

/** Competição de teste para sync de liga sem registrar bra.2 em produção. */
const TEST_LEAGUE_CODE = 'test.bra.2'

function withTestLeague(run: () => Promise<void>): Promise<void> {
  ESPN_PRIMARY_COMPETITIONS[TEST_LEAGUE_CODE] = {
    name: 'Brasileirão Série B (teste)',
    slugPrefix: 'brasileirao-serie-b-teste',
    type: 'league',
  }
  return run().finally(() => {
    delete ESPN_PRIMARY_COMPETITIONS[TEST_LEAGUE_CODE]
  })
}

function leagueEvent(id = 'serie-b-event'): EspnScoreboardEvent {
  const event = realEvent(id)
  event.season = { year: 2026, slug: '2026-brasileiro-serie-b' }
  return event
}

// Campos consumidos pelo sync nas finais dos scoreboards de 21/11 e 06/12/2026.
function finalEvent(id = '401913961'): EspnScoreboardEvent {
  return {
    id,
    date: '2026-11-21T20:00Z',
    season: { year: 2026, slug: 'final' },
    competitions: [
      {
        status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
        competitors: [
          {
            homeAway: 'home',
            team: {
              id: '131556',
              displayName: 'TBD Home',
              shortDisplayName: 'TBD Home',
              abbreviation: 'TBD Home',
            },
          },
          {
            homeAway: 'away',
            team: {
              id: '131554',
              displayName: 'TBD Away',
              shortDisplayName: 'TBD Away',
              abbreviation: 'TBD Away',
            },
          },
        ],
      },
    ],
  }
}

function team(event: EspnScoreboardEvent, side: 'home' | 'away'): EspnCompetitorTeam {
  return event.competitions![0].competitors!.find((c) => c.homeAway === side)!.team!
}

function scoreboard(events: EspnScoreboardEvent[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ events }))),
  )
}

describe('sync ESPN com participantes indefinidos', () => {
  it.each([
    ['conmebol.sudamericana', '401913961'],
    ['bra.copa_do_brazil', '401913106'],
  ])('descarta a final TBD de %s sem nenhuma mutação', async (competitionCode, id) => {
    const { sqlite, db } = database()
    sqlite.exec('DELETE FROM competitions')
    const event = finalEvent(id)
    if (competitionCode === 'bra.copa_do_brazil') event.date = '2026-12-06T20:00Z'
    scoreboard([event])
    const before = sqlite.prepare('SELECT total_changes() AS total').get()

    const result = await syncEspnFixtures({ db, competitionCode, season: 2026 })

    expect(result).toMatchObject({ competitionId: '', teams: 0, matches: 0 })
    expect(sqlite.prepare('SELECT total_changes() AS total').get()).toEqual(before)
    expect(sqlite.prepare('SELECT COUNT(*) AS total FROM competitions').get()).toEqual({ total: 0 })
  })

  it.each([
    ['home', 'displayName', '  tBd   hOmE  '],
    ['away', 'displayName', 'tbd away'],
    ['home', 'shortDisplayName', ' TBD '],
    ['away', 'shortDisplayName', ' TBD\tAWAY '],
    ['home', 'abbreviation', 'tbd home'],
    ['away', 'abbreviation', ' TbD '],
  ] as const)('descarta o evento inteiro com %s indefinido em %s', async (side, field, value) => {
    const { sqlite, db } = database()
    const event = realEvent()
    team(event, side)[field] = value
    scoreboard([event])
    const before = sqlite.prepare('SELECT total_changes() AS total').get()

    const result = await syncEspnFixtures({
      db,
      competitionCode: 'conmebol.sudamericana',
      season: 2026,
    })

    expect(result).toMatchObject({ competitionId: '', teams: 0, matches: 0 })
    expect(sqlite.prepare('SELECT total_changes() AS total').get()).toEqual(before)
  })

  it('preserva jogos reais do scoreboard e aceita os mesmos eventos após definir os times', async () => {
    const { sqlite, db } = database()
    const options = { db, competitionCode: 'conmebol.sudamericana', season: 2026 }
    const competitionsBefore = sqlite.prepare('SELECT * FROM competitions ORDER BY id').all()
    const real = realEvent()
    const pending = [finalEvent('401913961'), finalEvent('401913106')]
    scoreboard([pending[0], real, pending[1]])

    const first = await syncEspnFixtures(options)

    expect(first).toMatchObject({ matches: 1, teams: 2 })
    expect(sqlite.prepare('SELECT external_id FROM matches').all()).toEqual([
      { external_id: real.id },
    ])
    expect(
      sqlite.prepare("SELECT id FROM teams WHERE external_id IN ('131556', '131554')").all(),
    ).toEqual([])
    const storedBefore = sqlite.prepare('SELECT * FROM matches').all()
    const changesBefore = sqlite.prepare('SELECT total_changes() AS total').get()
    scoreboard(pending)
    await syncEspnFixtures(options)
    expect(sqlite.prepare('SELECT total_changes() AS total').get()).toEqual(changesBefore)
    expect(sqlite.prepare('SELECT * FROM matches').all()).toEqual(storedBefore)

    for (const event of pending) {
      for (const side of ['home', 'away'] as const) {
        Object.assign(team(event, side), team(real, side))
      }
    }
    scoreboard(pending)
    expect(await syncEspnFixtures(options)).toMatchObject({
      competitionId: first.competitionId,
      matches: 2,
      teams: 2,
    })
    expect(sqlite.prepare('SELECT external_id FROM matches ORDER BY external_id').all()).toEqual([
      { external_id: '401913106' },
      { external_id: '401913961' },
      { external_id: real.id },
    ])
    expect(sqlite.prepare('SELECT COUNT(*) AS total FROM teams').get()).toEqual({ total: 2 })
    expect(sqlite.prepare('SELECT * FROM competitions ORDER BY id').all()).toEqual(competitionsBefore)
  })

  it.each(['TBD United', 'Sport TBD Home', 'Tbdale FC', 'Away Wanderers'])(
    'aceita nome legítimo %s e IDs sem lista de bloqueio',
    async (name) => {
      const { db } = database()
      const event = realEvent()
      Object.assign(team(event, 'home'), {
        id: '131556',
        displayName: name,
        shortDisplayName: name,
        abbreviation: name,
      })
      scoreboard([event])

      expect(
        await syncEspnFixtures({ db, competitionCode: 'conmebol.sudamericana', season: 2026 }),
      ).toMatchObject({ matches: 1, teams: 2 })
    },
  )
})

describe('fases de liga no sync ESPN', () => {
  it('importa evento com slug 2026-brasileiro-serie-b como REGULAR_SEASON', async () => {
    await withTestLeague(async () => {
      const { sqlite, db } = database()
      const event = leagueEvent('401860401')
      scoreboard([event])

      const result = await syncEspnFixtures({
        db,
        competitionCode: TEST_LEAGUE_CODE,
        season: 2026,
      })

      expect(result).toMatchObject({ matches: 1, teams: 2 })
      expect(
        sqlite
          .prepare('SELECT phase, round FROM matches WHERE external_id = ?')
          .get('401860401'),
      ).toEqual({ phase: 'REGULAR_SEASON', round: 'REGULAR_SEASON' })
    })
  })

  it('usa week numérica como round quando a ESPN a expõe na liga', async () => {
    await withTestLeague(async () => {
      const { sqlite, db } = database()
      const event = leagueEvent('401860402')
      event.week = { number: 12 }
      scoreboard([event])

      await syncEspnFixtures({ db, competitionCode: TEST_LEAGUE_CODE, season: 2026 })

      expect(
        sqlite
          .prepare('SELECT phase, round FROM matches WHERE external_id = ?')
          .get('401860402'),
      ).toEqual({ phase: 'REGULAR_SEASON', round: '12' })
    })
  })

  it('aceita week como número puro (week: 12) na rodada da liga', async () => {
    await withTestLeague(async () => {
      const { sqlite, db } = database()
      const event = leagueEvent('401860403')
      event.week = 12
      scoreboard([event])

      await syncEspnFixtures({ db, competitionCode: TEST_LEAGUE_CODE, season: 2026 })

      expect(
        sqlite
          .prepare('SELECT phase, round FROM matches WHERE external_id = ?')
          .get('401860403'),
      ).toEqual({ phase: 'REGULAR_SEASON', round: '12' })
    })
  })

  it('usa matchday numérico como round quando week está ausente', async () => {
    await withTestLeague(async () => {
      const { sqlite, db } = database()
      const event = leagueEvent('401860404')
      event.matchday = 7
      scoreboard([event])

      await syncEspnFixtures({ db, competitionCode: TEST_LEAGUE_CODE, season: 2026 })

      expect(
        sqlite
          .prepare('SELECT phase, round FROM matches WHERE external_id = ?')
          .get('401860404'),
      ).toEqual({ phase: 'REGULAR_SEASON', round: '7' })
    })
  })

  it('descarta slug desconhecido fora do padrão YYYY-… (fail-closed)', async () => {
    await withTestLeague(async () => {
      const { sqlite, db } = database()
      const event = leagueEvent('mystery-stage-event')
      event.season = { year: 2026, slug: 'mystery-stage' }
      scoreboard([event])

      const result = await syncEspnFixtures({
        db,
        competitionCode: TEST_LEAGUE_CODE,
        season: 2026,
      })

      expect(result).toMatchObject({ matches: 0 })
      expect(
        sqlite
          .prepare('SELECT COUNT(*) AS total FROM matches WHERE external_id = ?')
          .get('mystery-stage-event'),
      ).toEqual({ total: 0 })
    })
  })

  it('mantém mapeamento de slug de copa (semifinals → SEMI_FINALS)', async () => {
    const { sqlite, db } = database()
    const event = realEvent('semi-event')
    event.season = { year: 2026, slug: 'semifinals' }
    scoreboard([event])

    await syncEspnFixtures({
      db,
      competitionCode: 'conmebol.sudamericana',
      season: 2026,
    })

    expect(
      sqlite.prepare('SELECT phase, round FROM matches WHERE external_id = ?').get('semi-event'),
    ).toEqual({ phase: 'SEMI_FINALS', round: 'SEMI_FINALS' })
  })

  it('descarta TBD também com slug de temporada de liga', async () => {
    await withTestLeague(async () => {
      const { sqlite, db } = database()
      sqlite.exec('DELETE FROM competitions')
      const event = leagueEvent('tbd-league')
      Object.assign(team(event, 'home'), {
        displayName: 'TBD Home',
        shortDisplayName: 'TBD Home',
        abbreviation: 'TBD Home',
      })
      Object.assign(team(event, 'away'), {
        displayName: 'TBD Away',
        shortDisplayName: 'TBD Away',
        abbreviation: 'TBD Away',
      })
      scoreboard([event])
      const before = sqlite.prepare('SELECT total_changes() AS total').get()

      const result = await syncEspnFixtures({
        db,
        competitionCode: TEST_LEAGUE_CODE,
        season: 2026,
      })

      expect(result).toMatchObject({ competitionId: '', teams: 0, matches: 0 })
      expect(sqlite.prepare('SELECT total_changes() AS total').get()).toEqual(before)
    })
  })
})

function feedByDate(boards: Record<string, EspnScoreboardEvent[]>) {
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const date = new URL(String(input)).searchParams.get('dates') ?? ''
    return new Response(JSON.stringify({ events: boards[date] ?? [] }))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const queriedDates = (fetch: ReturnType<typeof feedByDate>) =>
  fetch.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('dates'))

describe('fetchEventsForSync via syncEspnFixtures', () => {
  it('consulta o scoreboard uma vez quando dates está vazio', async () => {
    const { db } = database()
    const event = realEvent('once-no-dates')
    const fetch = feedByDate({ '': [event] })

    const result = await syncEspnFixtures({
      db,
      competitionCode: 'conmebol.sudamericana',
      season: 2026,
      dates: [],
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(queriedDates(fetch)).toEqual([null])
    expect(result).toMatchObject({ matches: 1, teams: 2 })
  })

  it('consulta cada data única e deduplica eventos pelo id entre scoreboards', async () => {
    const { sqlite, db } = database()
    const shared = realEvent('shared-event')
    const onlyFirst = realEvent('only-first')
    const onlySecond = realEvent('only-second')
    const fetch = feedByDate({
      '20260303': [shared, onlyFirst],
      '20260407': [shared, onlySecond],
    })

    const result = await syncEspnFixtures({
      db,
      competitionCode: 'conmebol.sudamericana',
      season: 2026,
      dates: ['20260303', '20260303', '', '20260407'],
    })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(queriedDates(fetch).sort()).toEqual(['20260303', '20260407'])
    expect(result).toMatchObject({ matches: 3, teams: 2 })
    expect(sqlite.prepare('SELECT external_id FROM matches ORDER BY external_id').all()).toEqual([
      { external_id: 'only-first' },
      { external_id: 'only-second' },
      { external_id: 'shared-event' },
    ])
  })
})
