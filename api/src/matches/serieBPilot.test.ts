/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import serieBFixtureJson from '../providers/__fixtures__/espn-bra-2-scoreboard.json'
import type { EspnScoreboard } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { isEspnPrimaryCompetition, syncEspnFixtures } from './espnSync'
import { discoverFixtures } from './fixtureDiscovery'
import { pollActiveMatches } from './poller'
import { syncFixtures } from './sync'

const SERIE_B_ID = '40070000-0000-4000-8000-000000002026'
const JWT_SECRET = 'test-serie-b-secret'
const ADMIN_EMAIL = 'admin@palpitae.com'
const PILOT_EMAIL = 'piloto@palpitae.com'
const ORDINARY_EMAIL = 'comum@palpitae.com'

const SERIE_B_BOARD = serieBFixtureJson as unknown as EspnScoreboard

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    JWT_SECRET,
    ADMIN_EMAIL,
    PILOT_EMAILS: PILOT_EMAIL,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com',
    FRONTEND_URL: 'https://palpitae.com',
    FOOTBALL_API_KEY: 'test-football-key',
    RESEND_API_KEY: 'test-resend-key',
    ...overrides,
  }
}

const fakeExecutionCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext

/**
 * Converte a fixture real da Série B em 2026 para o estado agendado `pre` no
 * futuro, para simular a descoberta inicial antes da bola rolar.
 */
function buildScheduledSerieBBoard(): EspnScoreboard {
  const clone = structuredClone(SERIE_B_BOARD)
  const baseMs = Date.parse('2099-04-01T22:00:00Z')

  for (const [idx, ev] of (clone.events ?? []).entries()) {
    const futureIso = new Date(baseMs + idx * 86_400_000)
      .toISOString()
      .replace(/:\d{2}\.\d{3}Z$/, 'Z')
    ev.date = futureIso
    if (ev.status?.type) {
      ev.status.type = { name: 'STATUS_SCHEDULED', state: 'pre', completed: false }
    }
    const comp = ev.competitions?.[0]
    if (!comp) continue
    comp.date = futureIso
    if (comp.status?.type) {
      comp.status.type = { name: 'STATUS_SCHEDULED', state: 'pre', completed: false }
    }
    for (const c of comp.competitors ?? []) {
      c.score = '0'
      c.winner = false
      delete c.shootoutScore
    }
  }
  return clone
}

function stubEspnApi(board: EspnScoreboard) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/sports/soccer/bra.2/scoreboard')) {
      return new Response(JSON.stringify(board), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('Not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Brasileirão Série B em piloto pela ESPN', () => {
  it('reconhece bra.2 como competição ESPN primária', () => {
    expect(isEspnPrimaryCompetition('bra.2')).toBe(true)
    expect(isEspnPrimaryCompetition('BSB')).toBe(false)
  })

  it('sincroniza a Série B pela ESPN, isola no piloto, importa REGULAR_SEASON e permite palpite', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    const env = makeEnv(db, { FOOTBALL_API_KEY: '' })

    sqlite.exec(`
      INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
        ('u-admin', '${ADMIN_EMAIL}', 'google', 'g-admin', 'Admin'),
        ('u-pilot', '${PILOT_EMAIL}', 'google', 'g-pilot', 'Piloto'),
        ('u-ordinary', '${ORDINARY_EMAIL}', 'google', 'g-ordinary', 'Comum');
      INSERT INTO profiles (user_id, nickname) VALUES
        ('u-admin', 'Admin'),
        ('u-pilot', 'Piloto'),
        ('u-ordinary', 'Comum');
    `)

    const tokens = {
      admin: await signJwt({ sub: 'u-admin', email: ADMIN_EMAIL }, JWT_SECRET, 3600),
      pilot: await signJwt({ sub: 'u-pilot', email: PILOT_EMAIL }, JWT_SECRET, 3600),
      ordinary: await signJwt({ sub: 'u-ordinary', email: ORDINARY_EMAIL }, JWT_SECRET, 3600),
    }

    const request = (
      path: string,
      user: keyof typeof tokens,
      init: RequestInit = {},
      customEnv: Env = env,
    ) =>
      worker.fetch(
        new Request(`https://api.palpitae.com${path}`, {
          ...init,
          headers: {
            Cookie: `session=${tokens[user]}`,
            'Content-Type': 'application/json',
            ...(init.headers as Record<string, string> | undefined),
          },
        }),
        customEnv,
        fakeExecutionCtx,
      )

    // 1. A migration 0029 cadastra a Série B 2026 como league, provider espn e visibility pilot.
    const seededRow = sqlite
      .prepare(
        `SELECT id, name, slug, external_id, provider, season, status, type, penalty_phases, visibility
           FROM competitions WHERE id = ?`,
      )
      .get(SERIE_B_ID)
    expect(seededRow).toEqual({
      id: SERIE_B_ID,
      name: 'Brasileirão Série B',
      slug: 'brasileirao-serie-b-2026',
      external_id: 'bra.2',
      provider: 'espn',
      season: '2026',
      status: 'ongoing',
      type: 'league',
      penalty_phases: '[]',
      visibility: 'pilot',
    })

    // Usuário comum não vê; admin e piloto veem.
    const ordinaryCompsRes = await request('/competitions', 'ordinary')
    expect(ordinaryCompsRes.status).toBe(200)
    const ordinaryComps = (await ordinaryCompsRes.json()) as {
      competitions: Array<{ id: string }>
    }
    expect(ordinaryComps.competitions.map((c) => c.id)).not.toContain(SERIE_B_ID)

    for (const user of ['admin', 'pilot'] as const) {
      const res = await request('/competitions', user)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        competitions: Array<{ id: string; slug: string; has_penalty_phases: boolean }>
      }
      expect(body.competitions).toContainEqual(
        expect.objectContaining({
          id: SERIE_B_ID,
          slug: 'brasileirao-serie-b-2026',
          has_penalty_phases: false,
        }),
      )
    }

    // 2. Sincroniza jogos agendados pela rota POST /matches/sync mesmo sem FOOTBALL_API_KEY.
    // Fixture tem 6 eventos; TBD Home/Away é filtrado → 5 jogos e 7 times reais.
    stubEspnApi(buildScheduledSerieBBoard())

    const syncRes = await request('/matches/sync', 'admin', {
      method: 'POST',
      body: JSON.stringify({
        competition: 'bra.2',
        season: 2026,
        dates: ['20260412', '20261018', '20261101', '20261128'],
      }),
    })
    expect(syncRes.status).toBe(200)
    expect(await syncRes.json()).toEqual({
      ok: true,
      synced: {
        competition: 'Brasileirão Série B',
        competitionId: SERIE_B_ID,
        matches: 5,
        teams: 7,
      },
    })

    const matchesRes = await request(`/matches?competition_id=${SERIE_B_ID}`, 'pilot')
    expect(matchesRes.status).toBe(200)
    const { matches } = (await matchesRes.json()) as {
      matches: Array<{
        id: string
        status: string
        home_score: number | null
        away_score: number | null
        phase: string
        round: string
        round_label: string
        home_team_name: string
        away_team_name: string
      }>
    }
    expect(matches).toHaveLength(5)
    expect(matches.every((m) => m.phase === 'REGULAR_SEASON')).toBe(true)
    expect(matches.every((m) => m.round === 'REGULAR_SEASON')).toBe(true)
    expect(matches.every((m) => m.round_label === 'Temporada regular')).toBe(true)
    expect(matches.every((m) => m.status === 'scheduled')).toBe(true)
    expect(matches.every((m) => m.home_score === null && m.away_score === null)).toBe(true)
    expect(
      matches.flatMap((m) => [m.home_team_name, m.away_team_name]).every((n) => !/TBD/i.test(n)),
    ).toBe(true)
    expect(matches.map((m) => `${m.home_team_name}|${m.away_team_name}`).sort()).toEqual([
      'América Mineiro|Novorizontino',
      'CRB|Athletic',
      'CRB|Botafogo-SP',
      'Londrina|América Mineiro',
      'Vila Nova|Novorizontino',
    ])

    // 3. Admin cria grupo league e salva palpite; usuário comum recebe 404.
    const createGroupRes = await request('/groups', 'admin', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bolão Série B Piloto',
        competition_id: SERIE_B_ID,
        points_exact: 3,
        points_winner: 1,
        points_penalty: 0,
      }),
    })
    expect(createGroupRes.status).toBe(201)
    const { group } = (await createGroupRes.json()) as {
      group: { id: string; invite_code: string }
    }

    const detailRes = await request(`/groups/${group.id}`, 'admin')
    expect(detailRes.status).toBe(200)
    const detail = (await detailRes.json()) as {
      group: { competition_name: string; competition_type: string }
    }
    expect(detail.group).toMatchObject({
      competition_name: 'Brasileirão Série B',
      competition_type: 'league',
    })

    expect((await request(`/matches?competition_id=${SERIE_B_ID}`, 'ordinary')).status).toBe(404)
    expect(
      (
        await request('/groups', 'ordinary', {
          method: 'POST',
          body: JSON.stringify({ name: 'Tentativa Comum', competition_id: SERIE_B_ID }),
        })
      ).status,
    ).toBe(404)

    const openMatch = matches[0]
    expect(
      (
        await request('/predictions', 'ordinary', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: openMatch.id,
            predicted_home_score: 1,
            predicted_away_score: 0,
          }),
        })
      ).status,
    ).toBe(404)

    expect(
      (
        await request('/predictions', 'admin', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: openMatch.id,
            predicted_home_score: 2,
            predicted_away_score: 1,
          }),
        })
      ).status,
    ).toBe(200)

    const predsRes = await request(`/predictions?group_id=${group.id}`, 'admin')
    expect(predsRes.status).toBe(200)
    const { predictions } = (await predsRes.json()) as {
      predictions: Array<{
        match_id: string
        predicted_home_score: number
        predicted_away_score: number
      }>
    }
    expect(predictions).toContainEqual(
      expect.objectContaining({
        match_id: openMatch.id,
        predicted_home_score: 2,
        predicted_away_score: 1,
      }),
    )

    // 4. discoverFixtures com a fixture real atualiza placares e mantém TBD fora.
    stubEspnApi(SERIE_B_BOARD)
    await discoverFixtures(db, 'unused-key')

    const dbMatches = sqlite
      .prepare(
        `SELECT external_id, status, home_score, away_score, phase, round
           FROM matches
          WHERE competition_id = ?
          ORDER BY start_time ASC`,
      )
      .all(SERIE_B_ID) as Array<Record<string, unknown>>

    expect(dbMatches).toHaveLength(5)
    expect(dbMatches.every((m) => m.phase === 'REGULAR_SEASON' && m.round === 'REGULAR_SEASON')).toBe(
      true,
    )
    expect(dbMatches.map((m) => m.external_id).sort()).toEqual([
      '401860098',
      '401860100',
      '401860393',
      '401860396',
      '401860418',
    ])
    expect(dbMatches.find((m) => m.external_id === '401912683')).toBeUndefined()

    expect(dbMatches.find((m) => m.external_id === '401860100')).toMatchObject({
      status: 'finished',
      home_score: expect.any(Number),
      away_score: expect.any(Number),
    })
    expect(dbMatches.find((m) => m.external_id === '401860418')).toMatchObject({
      status: 'scheduled',
      home_score: null,
      away_score: null,
    })

    // 5. pollActiveMatches reprocessa um jogo encerrado da Série B na janela ativa.
    sqlite.prepare(`UPDATE matches SET scored_at = NULL WHERE external_id = '401860393'`).run()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse('2026-10-18T19:00:00Z') + 130 * 60 * 1000))
    await pollActiveMatches(db, 'unused-key')
    vi.useRealTimers()

    const rescored = sqlite
      .prepare(`SELECT scored_at FROM matches WHERE external_id = '401860393'`)
      .get() as { scored_at: string | null }
    expect(rescored.scored_at).toEqual(expect.any(String))
  })

  it('re-sync não duplica competição, time ou jogo e preserva type league', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)

    const espnTotalBefore = sqlite
      .prepare(`SELECT COUNT(*) AS total FROM competitions WHERE provider = 'espn'`)
      .get() as { total: number }

    stubEspnApi(SERIE_B_BOARD)

    const first = await syncFixtures({
      competitionCode: 'bra.2',
      season: 2026,
      db,
    })
    const second = await syncEspnFixtures({
      competitionCode: 'bra.2',
      season: 2026,
      dates: ['20260412', '20260412', '20261018'],
      db,
    })

    expect(first).toEqual({
      competition: 'Brasileirão Série B',
      competitionId: SERIE_B_ID,
      matches: 5,
      teams: 7,
    })
    expect(second).toEqual(first)

    const serieBSlugCount = sqlite
      .prepare(`SELECT COUNT(*) AS total FROM competitions WHERE slug = 'brasileirao-serie-b-2026'`)
      .get() as { total: number }
    expect(serieBSlugCount.total).toBe(1)

    const espnTotalAfter = sqlite
      .prepare(`SELECT COUNT(*) AS total FROM competitions WHERE provider = 'espn'`)
      .get() as { total: number }
    expect(espnTotalAfter.total).toBe(espnTotalBefore.total)

    const teamCount = sqlite
      .prepare(`SELECT COUNT(*) AS total FROM teams WHERE provider = 'espn' AND external_id IS NOT NULL`)
      .get() as { total: number }
    // Apenas os 7 times da Série B neste teste (sem sync das copas).
    expect(teamCount.total).toBe(7)

    const matchCount = sqlite
      .prepare(`SELECT COUNT(*) AS total FROM matches WHERE competition_id = ?`)
      .get(SERIE_B_ID) as { total: number }
    expect(matchCount.total).toBe(5)

    const serieB = sqlite
      .prepare(`SELECT status, type, visibility, penalty_phases, provider FROM competitions WHERE id = ?`)
      .get(SERIE_B_ID) as Record<string, string>
    expect(serieB).toEqual({
      status: 'ongoing',
      type: 'league',
      visibility: 'pilot',
      penalty_phases: '[]',
      provider: 'espn',
    })
  })
})
