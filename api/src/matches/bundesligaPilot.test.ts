/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

const BUNDESLIGA_ID = '20020000-0000-4000-8000-000000002026'
const JWT_SECRET = 'test-bundesliga-secret'
const ADMIN_EMAIL = 'admin@palpitae.com'
const PILOT_EMAIL = 'piloto@palpitae.com'
const ORDINARY_EMAIL = 'comum@palpitae.com'
const USER_ADMIN = 'u-admin'
const USER_PILOT = 'u-pilot'
const USER_ORDINARY = 'u-ordinary'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
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

function team(id: number, name: string, tla: string) {
  return { id, name, shortName: name, tla, crest: `https://crests.example/${id}.png` }
}

const BAYERN = team(5, 'FC Bayern München', 'FCB')
const DORTMUND = team(4, 'Borussia Dortmund', 'BVB')
const LEVERKUSEN = team(3, 'Bayer 04 Leverkusen', 'B04')
const LEIPZIG = team(721, 'RB Leipzig', 'RBL')

function buildBl1Matches(finished: boolean) {
  const futureDate = '2099-08-16T15:00:00Z'
  return [
    {
      id: 554701,
      utcDate: futureDate,
      status: finished ? 'FINISHED' : 'TIMED',
      matchday: 1,
      stage: 'REGULAR_SEASON',
      group: null,
      homeTeam: BAYERN,
      awayTeam: DORTMUND,
      score: {
        winner: finished ? ('HOME_TEAM' as const) : null,
        duration: 'REGULAR' as const,
        fullTime: { home: finished ? 2 : null, away: finished ? 1 : null },
        halfTime: { home: null, away: null },
      },
    },
    {
      id: 554702,
      utcDate: '2099-08-17T17:00:00Z',
      status: finished ? 'FINISHED' : 'TIMED',
      matchday: 1,
      stage: 'REGULAR_SEASON',
      group: null,
      homeTeam: LEVERKUSEN,
      awayTeam: LEIPZIG,
      score: {
        winner: finished ? ('DRAW' as const) : null,
        duration: 'REGULAR' as const,
        fullTime: { home: finished ? 1 : null, away: finished ? 1 : null },
        halfTime: { home: null, away: null },
      },
    },
    {
      id: 554703,
      utcDate: '2099-08-23T19:00:00Z',
      status: finished ? 'FINISHED' : 'TIMED',
      matchday: 2,
      stage: 'REGULAR_SEASON',
      group: null,
      homeTeam: DORTMUND,
      awayTeam: LEVERKUSEN,
      score: {
        winner: finished ? ('AWAY_TEAM' as const) : null,
        duration: 'REGULAR' as const,
        fullTime: { home: finished ? 0 : null, away: finished ? 2 : null },
        halfTime: { home: null, away: null },
      },
    },
  ]
}

function stubFootballDataApi(finished: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/competitions/BL1/matches') || url.includes('/competitions/2002/matches')) {
        return new Response(
          JSON.stringify({
            competition: { id: 2002, name: 'Bundesliga', code: 'BL1', type: 'LEAGUE' },
            matches: buildBl1Matches(finished),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('Not found', { status: 404 })
    }),
  )
}

describe('Bundesliga em piloto pelo football-data', () => {
  it('cadastra a liga piloto, sincroniza sem duplicar e permite grupo e palpite ao admin', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    const env = makeEnv(db)

    sqlite.exec(`
      INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
        ('${USER_ADMIN}', '${ADMIN_EMAIL}', 'google', 'g-admin', 'Admin'),
        ('${USER_PILOT}', '${PILOT_EMAIL}', 'google', 'g-pilot', 'Piloto'),
        ('${USER_ORDINARY}', '${ORDINARY_EMAIL}', 'google', 'g-ordinary', 'Comum');
      INSERT INTO profiles (user_id, nickname) VALUES
        ('${USER_ADMIN}', 'Admin'),
        ('${USER_PILOT}', 'Piloto'),
        ('${USER_ORDINARY}', 'Comum');
    `)

    const tokens = {
      admin: await signJwt({ sub: USER_ADMIN, email: ADMIN_EMAIL }, JWT_SECRET, 3600),
      pilot: await signJwt({ sub: USER_PILOT, email: PILOT_EMAIL }, JWT_SECRET, 3600),
      ordinary: await signJwt({ sub: USER_ORDINARY, email: ORDINARY_EMAIL }, JWT_SECRET, 3600),
    }

    const request = (path: string, user: keyof typeof tokens, init: RequestInit = {}) =>
      worker.fetch(
        new Request(`https://api.palpitae.com${path}`, {
          ...init,
          headers: {
            Cookie: `session=${tokens[user]}`,
            'Content-Type': 'application/json',
            ...(init.headers as Record<string, string> | undefined),
          },
        }),
        env,
        fakeExecutionCtx,
      )

    // 1. Migration 0027 cadastra Bundesliga 2026 como league, football-data e pilot.
    const seededRow = sqlite
      .prepare(
        `SELECT id, name, slug, external_id, provider, season, status, type, penalty_phases, visibility
           FROM competitions WHERE id = ?`,
      )
      .get(BUNDESLIGA_ID)
    expect(seededRow).toEqual({
      id: BUNDESLIGA_ID,
      name: 'Bundesliga',
      slug: 'bundesliga-2026',
      external_id: '2002',
      provider: 'football-data',
      season: '2026',
      status: 'ongoing',
      type: 'league',
      penalty_phases: '[]',
      visibility: 'pilot',
    })

    // Usuário comum não vê; admin e convidado piloto veem.
    const ordinaryCompsRes = await request('/competitions', 'ordinary')
    expect(ordinaryCompsRes.status).toBe(200)
    const ordinaryComps = (await ordinaryCompsRes.json()) as {
      competitions: Array<{ id: string }>
    }
    expect(ordinaryComps.competitions.map((c) => c.id)).not.toContain(BUNDESLIGA_ID)

    for (const user of ['admin', 'pilot'] as const) {
      const res = await request('/competitions', user)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        competitions: Array<{ id: string; slug: string; has_penalty_phases: boolean }>
      }
      expect(body.competitions).toContainEqual(
        expect.objectContaining({
          id: BUNDESLIGA_ID,
          slug: 'bundesliga-2026',
          has_penalty_phases: false,
        }),
      )
    }

    // 2. Sync duas vezes com BL1 e uma com 2002. Sem duplicar jogos. type league permanece.
    stubFootballDataApi(false)
    for (const code of ['BL1', 'BL1', '2002']) {
      const syncRes = await request('/matches/sync', 'admin', {
        method: 'POST',
        body: JSON.stringify({ competition: code, season: 2026 }),
      })
      expect(syncRes.status).toBe(200)
      const syncBody = (await syncRes.json()) as {
        ok: boolean
        synced: { competition: string; matches: number }
      }
      expect(syncBody).toMatchObject({
        ok: true,
        synced: { competition: 'Bundesliga', matches: 3 },
      })
    }

    const afterSync = sqlite
      .prepare(
        `SELECT id, name, slug, external_id, type, penalty_phases, visibility, provider, status
           FROM competitions WHERE slug = 'bundesliga-2026'`,
      )
      .get() as {
      id: string
      name: string
      slug: string
      external_id: string
      type: string
      penalty_phases: string
      visibility: string
      provider: string
      status: string
    }
    expect(afterSync).toEqual({
      id: BUNDESLIGA_ID,
      name: 'Bundesliga',
      slug: 'bundesliga-2026',
      external_id: '2002',
      type: 'league',
      penalty_phases: '[]',
      visibility: 'pilot',
      provider: 'football-data',
      status: 'ongoing',
    })

    const duplicateSlugCount = sqlite
      .prepare(
        `SELECT COUNT(*) AS total FROM competitions
         WHERE external_id = '2002' OR slug = 'bundesliga-2026'`,
      )
      .get() as { total: number }
    expect(duplicateSlugCount.total).toBe(1)

    const matchCount = sqlite.prepare(`SELECT COUNT(*) AS total FROM matches`).get() as {
      total: number
    }
    expect(matchCount.total).toBe(3)

    const teamCount = sqlite.prepare(`SELECT COUNT(*) AS total FROM teams`).get() as {
      total: number
    }
    expect(teamCount.total).toBe(4)

    // 3. Admin cria grupo, palpite e lê de volta; competition_type=league habilita Tabela.
    const createGroupRes = await request('/groups', 'admin', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bolão da Bundesliga',
        competition_id: BUNDESLIGA_ID,
        points_exact: 3,
        points_winner: 1,
        points_penalty: 0,
      }),
    })
    expect(createGroupRes.status).toBe(201)
    const { group } = (await createGroupRes.json()) as { group: { id: string } }

    const detailRes = await request(`/groups/${group.id}`, 'admin')
    expect(detailRes.status).toBe(200)
    const detail = (await detailRes.json()) as {
      group: { competition_name: string; competition_type: string }
    }
    expect(detail.group).toMatchObject({
      competition_name: 'Bundesliga',
      competition_type: 'league',
    })

    const matchesRes = await request(`/matches?competition_id=${BUNDESLIGA_ID}`, 'admin')
    expect(matchesRes.status).toBe(200)
    const { matches } = (await matchesRes.json()) as {
      matches: Array<{ id: string; phase: string; round: string; round_label: string }>
    }
    expect(matches).toHaveLength(3)
    expect(matches[0]).toMatchObject({
      phase: 'REGULAR_SEASON',
      round: '1',
      round_label: 'Rodada 1',
    })

    const openMatch = matches[0]
    const predRes = await request('/predictions', 'admin', {
      method: 'PUT',
      body: JSON.stringify({
        group_id: group.id,
        match_id: openMatch.id,
        predicted_home_score: 2,
        predicted_away_score: 1,
      }),
    })
    expect(predRes.status).toBe(200)

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
  })
})
