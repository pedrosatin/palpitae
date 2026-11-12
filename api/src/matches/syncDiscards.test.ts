/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import template from '../providers/__fixtures__/espn-conmebol-sudamericana-scoreboard.json'
import type { EspnScoreboardEvent } from '../providers/espn'
import { resetEspnClientForTests, setEspnMinIntervalForTests } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import { syncEspnFixtures } from './espnSync'
import { discoverFixtures } from './fixtureDiscovery'
import { pollActiveMatches } from './poller'
import { syncFixtures } from './sync'

/**
 * O sync descarta eventos do provedor que não consegue importar (fase fora do
 * mapa, outra temporada, competidor ausente) e a football-data pode deixar de
 * trazer um jogo pendente. As rotinas rodam sobre o SQLite das migrations, com
 * os provedores simulados, e o resultado se lê no D1 e nos eventos gravados.
 */

type WrittenPoint = { indexes: string[]; blobs: string[]; doubles: number[] }

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
  result.sqlite.exec('DELETE FROM competitions')
  return result
}

function analytics() {
  const ae = { writeDataPoint: vi.fn() }
  const points = () => ae.writeDataPoint.mock.calls.map(([point]) => point as WrittenPoint)
  const of = (type: string) => points().filter((point) => point.blobs[0] === type)
  return { ae, dataset: ae as unknown as AnalyticsEngineDataset, of }
}

// ---------------------------------------------------------------------------
// ESPN
// ---------------------------------------------------------------------------

const CUP_ID = '0c0c0c0c-0000-4000-8000-000000002026'

function espnEvent(id: string, date: string, finished = false): EspnScoreboardEvent {
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

/** Um evento com fase fora do mapa, um de outra edição e um com time ainda indefinido. */
function rejectedEspnEvents(date: string): EspnScoreboardEvent[] {
  const unknownStage = espnEvent('unknown-stage', date)
  unknownStage.season!.slug = 'round-of-32'
  const otherSeason = espnEvent('other-season', date)
  otherSeason.season!.year = 2027
  const tbd = espnEvent('tbd', date)
  tbd.competitions![0].competitors![0].team!.displayName = 'TBD Home'
  return [unknownStage, otherSeason, tbd]
}

/** O scoreboard da ESPN responde por data; datas sem entrada vêm vazias. */
function espnFeed(boards: Record<string, EspnScoreboardEvent[]>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const date = new URL(String(input)).searchParams.get('dates') ?? ''
      return new Response(JSON.stringify({ events: boards[date] ?? [] }))
    }),
  )
}

function insertSulAmericana(sqlite: DatabaseSync) {
  sqlite.exec(
    `INSERT INTO competitions (id, name, slug, external_id, provider, season, status, visibility)
     VALUES ('${CUP_ID}', 'Copa Sul-Americana', 'conmebol-sudamericana-2026',
             'conmebol.sudamericana', 'espn', '2026', 'ongoing', 'pilot')`,
  )
}

const ESPN_DISCARDS = [
  ['sync_event_discarded', 'espn', CUP_ID, 'unknown_stage', 'round-of-32', 'conmebol.sudamericana'],
  ['sync_event_discarded', 'espn', CUP_ID, 'season_mismatch', '2027', 'conmebol.sudamericana'],
  ['sync_event_discarded', 'espn', CUP_ID, 'missing_competitor', 'tbd', 'conmebol.sudamericana'],
]

describe('descoberta ESPN com eventos que o sync não importa', () => {
  it('importa o jogo válido, conta os descartes na execução e registra o motivo de cada um', async () => {
    const { sqlite, db } = database()
    insertSulAmericana(sqlite)
    espnFeed({
      '20261020': [
        espnEvent('valid', '2026-10-20T22:00:00Z'),
        ...rejectedEspnEvents('2026-10-20T23:00:00Z'),
      ],
    })
    const { dataset, of } = analytics()

    await discoverFixtures(db, '', dataset, Date.parse('2026-10-15T04:00:00Z'))

    expect(sqlite.prepare('SELECT external_id, status FROM matches').all()).toEqual([
      { external_id: 'valid', status: 'scheduled' },
    ])
    const [run] = of('fixture_discovery_run')
    expect(run.blobs).toEqual(['fixture_discovery_run', 'ok'])
    // doubles = [competitions, fixtures_updated, api_calls, duration_ms, events_discarded]
    expect(run.doubles[1]).toBe(1)
    expect(run.doubles[4]).toBe(3)
    expect(of('sync_event_discarded').map((point) => point.blobs)).toEqual(ESPN_DISCARDS)
    expect(of('sync_event_discarded').map((point) => point.doubles)).toEqual([[1], [1], [1]])
  })

  it('soma eventos repetidos pelo mesmo motivo e fase num único registro', async () => {
    const { sqlite, db } = database()
    insertSulAmericana(sqlite)
    const first = espnEvent('a', '2026-10-20T22:00:00Z')
    const second = espnEvent('b', '2026-10-21T22:00:00Z')
    first.season!.slug = 'round-of-32'
    second.season!.slug = 'round-of-32'
    espnFeed({ '20261020': [first], '20261021': [second] })
    const { dataset, of } = analytics()

    await discoverFixtures(db, '', dataset, Date.parse('2026-10-15T04:00:00Z'))

    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM matches').get()).toEqual({
      n: 0,
    })
    expect(
      of('sync_event_discarded').map((point) => [point.blobs[3], point.blobs[4], point.doubles]),
    ).toEqual([['unknown_stage', 'round-of-32', [2]]])
    expect(of('fixture_discovery_run')[0].doubles[4]).toBe(2)
    expect(of('fixture_discovery_run')[0].blobs[1]).toBe('ok')
  })

  it('com todos os eventos descartados, registra os motivos e não grava jogo', async () => {
    const { sqlite, db } = database()
    insertSulAmericana(sqlite)
    sqlite.exec(`UPDATE competitions SET season = '2027', slug = 'conmebol-sudamericana-2027'`)
    espnFeed({ '20261020': [espnEvent('a', '2026-10-20T22:00:00Z')] })
    const { dataset, of } = analytics()

    await discoverFixtures(db, '', dataset, Date.parse('2026-10-15T04:00:00Z'))

    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM matches').get()).toEqual({
      n: 0,
    })
    expect(of('sync_event_discarded').map((point) => point.blobs)).toEqual([
      ['sync_event_discarded', 'espn', CUP_ID, 'season_mismatch', '2026', 'conmebol.sudamericana'],
    ])
    expect(of('fixture_discovery_run')[0].doubles[4]).toBe(1)
  })

  it('sem a competição no banco, o descarte sai sem id de competição', async () => {
    const { sqlite, db } = database()
    const ev = espnEvent('a', '2026-10-20T22:00:00Z')
    ev.season!.slug = 'round-of-32'
    espnFeed({ '20261020': [ev] })
    const { dataset, of } = analytics()

    const result = await syncEspnFixtures({
      db,
      competitionCode: 'conmebol.sudamericana',
      season: 2026,
      dates: ['20261020'],
      ae: dataset,
    })

    expect(result).toMatchObject({ matches: 0, discarded: 1 })
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM competitions').get()).toEqual({ n: 0 })
    expect(of('sync_event_discarded').map((point) => point.blobs)).toEqual([
      ['sync_event_discarded', 'espn', '', 'unknown_stage', 'round-of-32', 'conmebol.sudamericana'],
    ])
  })
})

describe('poller ESPN com eventos que o sync não importa', () => {
  it('fecha o jogo válido e conta os descartes no poller_run sem marcar erro', async () => {
    const { sqlite, db } = database()
    insertSulAmericana(sqlite)
    const kickoff = '2026-10-14T22:00:00Z'
    espnFeed({ '20261014': [espnEvent('valid', kickoff)] })
    await discoverFixtures(db, '', undefined, Date.parse('2026-10-14T04:00:00Z'))
    // Três horas depois do início, o scoreboard traz o placar e os eventos rejeitados.
    espnFeed({
      '20261014': [
        espnEvent('valid', kickoff, true),
        ...rejectedEspnEvents('2026-10-14T23:00:00Z'),
      ],
    })
    const { dataset, of } = analytics()

    await pollActiveMatches(db, '', dataset, Date.parse('2026-10-15T01:00:00Z'))

    expect(
      sqlite
        .prepare('SELECT external_id, status, scored_at IS NOT NULL AS scored FROM matches')
        .all(),
    ).toEqual([{ external_id: 'valid', status: 'finished', scored: 1 }])
    const [run] = of('poller_run')
    expect(run.blobs).toEqual(['poller_run', 'ok'])
    // doubles = [matches_checked, fixtures_updated, api_calls, duration_ms, events_discarded]
    expect(run.doubles[4]).toBe(3)
    expect(of('sync_event_discarded').map((point) => point.blobs)).toEqual(ESPN_DISCARDS)
  })
})

// ---------------------------------------------------------------------------
// football-data
// ---------------------------------------------------------------------------

const PL_ID = '20210000-0000-4000-8000-000000002026'
const ARSENAL = {
  id: 57,
  name: 'Arsenal FC',
  shortName: 'Arsenal',
  tla: 'ARS',
  crest: '',
}
const CHELSEA = {
  id: 61,
  name: 'Chelsea FC',
  shortName: 'Chelsea',
  tla: 'CHE',
  crest: '',
}
const NO_TEAM = {
  id: null,
  name: null,
  shortName: null,
  tla: null,
  crest: null,
}

type FdTeam = typeof ARSENAL | typeof NO_TEAM

function fdMatch(
  id: number,
  utcDate: string,
  home: FdTeam,
  away: FdTeam,
  result?: { home: number; away: number },
) {
  return {
    id,
    utcDate,
    status: result ? 'FINISHED' : 'TIMED',
    matchday: 11,
    stage: 'REGULAR_SEASON',
    group: null,
    homeTeam: home,
    awayTeam: away,
    score: {
      winner: null,
      duration: 'REGULAR',
      fullTime: { home: result?.home ?? null, away: result?.away ?? null },
    },
  }
}

/** A football-data responde o calendário inteiro da Premier League; a ESPN, nada. */
function premierLeagueFeed() {
  const provider = { matches: [] as ReturnType<typeof fdMatch>[] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname !== 'api.football-data.org') return Response.json({ events: [] })
      return Response.json({
        competition: { id: 2021, code: 'PL', name: 'Premier League' },
        matches: provider.matches,
      })
    }),
  )
  return provider
}

function premierLeague() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    DELETE FROM competitions WHERE id != '${PL_ID}';
    INSERT INTO users (id, email, provider, provider_id) VALUES ('u-ana', 'ana@palpitae.com', 'google', 'g-ana');
    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code)
      VALUES ('g-pl', 'Bolão Premier', '${PL_ID}', 'u-ana', 'INVPL');
    INSERT INTO group_members (id, group_id, user_id) VALUES ('gm', 'g-pl', 'u-ana');
  `)
  return { sqlite, db }
}

const NOVEMBER = '2026-11-08T16:30:00Z'
const DECEMBER = '2026-12-06T16:30:00Z'
const DISCOVERY = Date.parse('2026-11-01T06:15:00Z')

describe('descoberta da football-data quando um jogo pendente some do calendário', () => {
  it('registra o jogo como ausente e mantém a linha e os palpites', async () => {
    const { sqlite, db } = premierLeague()
    const provider = premierLeagueFeed()
    provider.matches = [
      fdMatch(9001, NOVEMBER, ARSENAL, CHELSEA),
      fdMatch(9002, DECEMBER, CHELSEA, ARSENAL),
    ]
    await discoverFixtures(db, 'key', undefined, DISCOVERY)
    sqlite.exec(`
      INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score)
      SELECT 'p-' || external_id, 'u-ana', 'g-pl', id, 2, 1 FROM matches;
    `)

    // O provedor reemite o jogo de dezembro com outro id.
    provider.matches = [
      fdMatch(9001, NOVEMBER, ARSENAL, CHELSEA),
      fdMatch(9102, DECEMBER, CHELSEA, ARSENAL),
    ]
    const { dataset, of } = analytics()
    await discoverFixtures(db, 'key', dataset, DISCOVERY)

    expect(
      sqlite
        .prepare(
          `SELECT m.external_id, m.status, COUNT(p.id) AS predictions
             FROM matches m LEFT JOIN predictions p ON p.match_id = m.id
            GROUP BY m.id ORDER BY m.external_id`,
        )
        .all(),
    ).toEqual([
      { external_id: '9001', status: 'scheduled', predictions: 1 },
      { external_id: '9002', status: 'scheduled', predictions: 1 },
      { external_id: '9102', status: 'scheduled', predictions: 0 },
    ])
    expect(of('match_missing_from_feed').map((point) => point.blobs)).toEqual([
      ['match_missing_from_feed', 'football-data', PL_ID, '9002', DECEMBER],
    ])
    const [run] = of('fixture_discovery_run')
    expect(run.blobs).toEqual(['fixture_discovery_run', 'ok'])
    // doubles[5] = jogos pendentes ausentes do calendário
    expect(run.doubles[5]).toBe(1)
  })

  it('fora da descoberta (poller e sync manual), o calendário completo não registra ausentes', async () => {
    const { db } = premierLeague()
    const provider = premierLeagueFeed()
    provider.matches = [
      fdMatch(9001, NOVEMBER, ARSENAL, CHELSEA),
      fdMatch(9002, DECEMBER, CHELSEA, ARSENAL),
    ]
    await discoverFixtures(db, 'key', undefined, DISCOVERY)

    provider.matches = [fdMatch(9001, NOVEMBER, ARSENAL, CHELSEA)]
    const { dataset, of } = analytics()
    const result = await syncFixtures({
      competitionCode: '2021',
      season: 2026,
      apiKey: 'key',
      db,
      ae: dataset,
    })

    expect(result).toMatchObject({ matches: 1, discarded: 0, missing: 0 })
    expect(of('match_missing_from_feed')).toEqual([])
  })

  it('jogo encerrado que sai do calendário não é registrado', async () => {
    const { db } = premierLeague()
    const provider = premierLeagueFeed()
    provider.matches = [
      fdMatch(9001, NOVEMBER, ARSENAL, CHELSEA, { home: 1, away: 0 }),
      fdMatch(9002, DECEMBER, CHELSEA, ARSENAL),
    ]
    await discoverFixtures(db, 'key', undefined, DISCOVERY)

    provider.matches = [fdMatch(9002, DECEMBER, CHELSEA, ARSENAL)]
    const { dataset, of } = analytics()
    await discoverFixtures(db, 'key', dataset, DISCOVERY)

    expect(of('match_missing_from_feed')).toEqual([])
    expect(of('fixture_discovery_run')[0].doubles[5]).toBe(0)
  })

  it('jogo com time ainda indefinido conta como descarte sem impedir os outros', async () => {
    const { sqlite, db } = premierLeague()
    const provider = premierLeagueFeed()
    provider.matches = [
      fdMatch(9001, NOVEMBER, ARSENAL, CHELSEA),
      fdMatch(9003, DECEMBER, NO_TEAM, CHELSEA),
    ]
    const { dataset, of } = analytics()

    await discoverFixtures(db, 'key', dataset, DISCOVERY)

    expect(sqlite.prepare('SELECT external_id FROM matches').all()).toEqual([
      { external_id: '9001' },
    ])
    expect(of('sync_event_discarded').map((point) => [point.blobs, point.doubles])).toEqual([
      [['sync_event_discarded', 'football-data', PL_ID, 'missing_competitor', 'tbd', '2021'], [1]],
    ])
    const [run] = of('fixture_discovery_run')
    expect(run.blobs[1]).toBe('ok')
    expect(run.doubles[4]).toBe(1)
    // O jogo sem time foi visto no calendário: não é ausente.
    expect(of('match_missing_from_feed')).toEqual([])
  })
})
