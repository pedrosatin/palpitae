/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { discoverFixtures } from './fixtureDiscovery'

/**
 * Identidade da competição no sync da football-data: a competição é a do
 * provedor, do id externo e da temporada, não a do nome que a API envia.
 * Competição nova só nasce com configuração cadastrada e em piloto.
 */

const PL_ID = '20210000-0000-4000-8000-000000002026'
const JWT_SECRET = 'competition-identity-secret'
const ADMIN_EMAIL = 'admin@palpitae.com'

const ARSENAL = { id: 57, name: 'Arsenal FC', shortName: 'Arsenal', tla: 'ARS', crest: '' }
const CHELSEA = { id: 61, name: 'Chelsea FC', shortName: 'Chelsea', tla: 'CHE', crest: '' }
const LIVERPOOL = { id: 64, name: 'Liverpool FC', shortName: 'Liverpool', tla: 'LIV', crest: '' }
const SPURS = { id: 73, name: 'Tottenham Hotspur FC', shortName: 'Spurs', tla: 'TOT', crest: '' }

type Team = typeof ARSENAL
type ApiCompetition = { id: number; code: string; name: string }

function fdMatch(id: number, utcDate: string, matchday: number, home: Team, away: Team) {
  return {
    id,
    utcDate,
    status: 'TIMED',
    matchday,
    stage: 'REGULAR_SEASON',
    group: null,
    homeTeam: home,
    awayTeam: away,
    score: { winner: null, duration: 'REGULAR', fullTime: { home: null, away: null } },
  }
}

/** A football-data responde só pelo id ou código pedido; o resto volta vazio. */
function stubFootballData(
  byCode: Record<string, { competition: ApiCompetition; matches: unknown[] }>,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname !== 'api.football-data.org') return Response.json({ events: [] })
      const code = url.pathname.split('/')[3]
      const entry = byCode[code]
      if (!entry) {
        return Response.json({ competition: { id: Number(code), code, name: code }, matches: [] })
      }
      return Response.json(entry)
    }),
  )
}

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`INSERT INTO users (id, email, provider, provider_id) VALUES
    ('u-admin', '${ADMIN_EMAIL}', 'google', 'g-admin')`)
  const ae = { writeDataPoint: vi.fn<(point: { blobs: string[] }) => void>() }
  const env = {
    DB: db,
    AE: ae as unknown as AnalyticsEngineDataset,
    JWT_SECRET,
    ADMIN_EMAIL,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com',
    FRONTEND_URL: 'https://palpitae.com',
    FOOTBALL_API_KEY: 'test-football-key',
  } as Env
  const adminSync = async (competition: string, season: number) => {
    const token = await signJwt({ sub: 'u-admin', email: ADMIN_EMAIL }, JWT_SECRET, 3600)
    return worker.fetch(
      new Request('https://api.palpitae.com/matches/sync', {
        method: 'POST',
        headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ competition, season }),
      }),
      env,
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
        props: {},
      } as unknown as ExecutionContext,
    )
  }
  const events = (type: string) =>
    ae.writeDataPoint.mock.calls.map(([point]) => point.blobs).filter((blobs) => blobs[0] === type)
  return { sqlite, db, ae, adminSync, events }
}

function competitionsByKey(sqlite: DatabaseSync, externalId: string, season: string) {
  return sqlite
    .prepare(
      `SELECT id, name, slug, type, penalty_phases, visibility FROM competitions
        WHERE provider = 'football-data' AND external_id = ? AND season = ?`,
    )
    .all(externalId, season)
}

describe('identidade da competição no sync da football-data', () => {
  it('competição renomeada pela API continua a mesma e recebe os jogos novos', async () => {
    const { sqlite, db, ae } = setup()
    const discover = () =>
      discoverFixtures(
        db,
        'test',
        ae as unknown as AnalyticsEngineDataset,
        Date.parse('2026-11-10T06:00:00Z'),
      )
    const primeiraRodada = fdMatch(9101, '2026-11-14T15:00:00Z', 12, ARSENAL, CHELSEA)

    stubFootballData({
      '2021': {
        competition: { id: 2021, code: 'PL', name: 'Premier League' },
        matches: [primeiraRodada],
      },
    })
    await discover()

    // O provedor passa a mandar outro nome para a mesma competição.
    stubFootballData({
      '2021': {
        competition: { id: 2021, code: 'PL', name: 'English Premier League' },
        matches: [primeiraRodada, fdMatch(9102, '2026-11-21T15:00:00Z', 13, LIVERPOOL, SPURS)],
      },
    })
    await discover()

    expect(competitionsByKey(sqlite, '2021', '2026')).toEqual([
      expect.objectContaining({ id: PL_ID, name: 'Premier League', slug: 'premier-league-2026' }),
    ])
    const matches = sqlite
      .prepare(
        `SELECT external_id, competition_id FROM matches WHERE provider = 'football-data' ORDER BY external_id`,
      )
      .all()
    expect(matches).toEqual([
      { external_id: '9101', competition_id: PL_ID },
      { external_id: '9102', competition_id: PL_ID },
    ])
  })

  it('código sem configuração não cria competição e registra o evento', async () => {
    const { sqlite, adminSync, events } = setup()
    // Libertadores da football-data: no app ela vem da ESPN, em piloto.
    stubFootballData({
      CLI: {
        competition: { id: 2152, code: 'CLI', name: 'Copa Libertadores' },
        matches: [fdMatch(9201, '2026-11-14T22:00:00Z', 1, ARSENAL, CHELSEA)],
      },
    })

    const res = await adminSync('CLI', 2026)

    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: string }).error).toContain('sem configuração')
    expect(competitionsByKey(sqlite, '2152', '2026')).toEqual([])
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS total FROM competitions WHERE visibility = 'public' AND name = 'Copa Libertadores'`,
        )
        .get(),
    ).toEqual({ total: 0 })
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS total FROM matches WHERE external_id = '9201'`).get(),
    ).toEqual({ total: 0 })
    expect(events('competition_unconfigured')).toEqual([
      ['competition_unconfigured', 'football-data', 'CLI', '2152', '2026'],
    ])
  })

  it('recriar o Brasileirão pelo sync num banco vazio produz liga em piloto', async () => {
    const { sqlite, adminSync } = setup()
    stubFootballData({
      BSA: {
        competition: { id: 2013, code: 'BSA', name: 'Campeonato Brasileiro Série A' },
        matches: [fdMatch(9301, '2027-04-03T21:30:00Z', 1, ARSENAL, CHELSEA)],
      },
    })

    const res = await adminSync('BSA', 2027)

    expect(res.status).toBe(200)
    const [row] = competitionsByKey(sqlite, '2013', '2027') as Array<{ id: string }>
    expect(row).toEqual({
      id: expect.any(String),
      name: 'Brasileirão Série A',
      slug: 'campeonato-brasileiro-serie-a-2027',
      type: 'league',
      penalty_phases: '[]',
      visibility: 'pilot',
    })
    expect(
      sqlite.prepare(`SELECT competition_id FROM matches WHERE external_id = '9301'`).get(),
    ).toEqual({
      competition_id: row.id,
    })
  })

  it('o banco recusa duas competições com o mesmo provedor, id externo e temporada', () => {
    const { sqlite } = setup()
    expect(() =>
      sqlite.exec(`INSERT INTO competitions (id, name, slug, external_id, provider, season, status)
        VALUES ('pl-dup', 'Premier League', 'english-premier-league-2026', '2021', 'football-data', '2026', 'ongoing')`),
    ).toThrow(/UNIQUE/)
  })
})
