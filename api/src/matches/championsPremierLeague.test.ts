import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

const JWT_SECRET = 'test-secret-champions-premier'
const ADMIN_EMAIL = 'admin@palpitae.com'
const USER_ID = 'user-1'

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    JWT_SECRET,
    ADMIN_EMAIL,
    FOOTBALL_API_KEY: 'test-football-key',
    FRONTEND_URL: 'https://palpitae.com',
  } as Env
}

const fakeExecutionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext

function team(id: number, name: string, tla: string) {
  return { id, name, shortName: name, tla, crest: `https://crests.example/${id}.png` }
}

const REAL_MADRID = team(86, 'Real Madrid CF', 'RMA')
const BAYERN = team(5, 'FC Bayern München', 'FCB')
const ARSENAL = team(57, 'Arsenal FC', 'ARS')
const LIVERPOOL = team(64, 'Liverpool FC', 'LIV')

function buildClMatches(finished: boolean) {
  const futureDate = '2099-05-30T19:00:00Z'
  return [
    {
      id: 900001,
      utcDate: futureDate,
      status: finished ? 'FINISHED' : 'TIMED',
      matchday: 1,
      stage: 'LEAGUE_STAGE',
      group: null,
      homeTeam: REAL_MADRID,
      awayTeam: BAYERN,
      score: {
        winner: finished ? ('HOME_TEAM' as const) : null,
        duration: 'REGULAR' as const,
        fullTime: { home: finished ? 2 : null, away: finished ? 1 : null },
        halfTime: { home: null, away: null },
      },
    },
    {
      id: 900002,
      utcDate: futureDate,
      status: finished ? 'FINISHED' : 'TIMED',
      matchday: 1,
      stage: 'PLAYOFFS',
      group: null,
      homeTeam: BAYERN,
      awayTeam: REAL_MADRID,
      score: {
        winner: finished ? ('DRAW' as const) : null,
        duration: 'REGULAR' as const,
        fullTime: { home: finished ? 1 : null, away: finished ? 1 : null },
        halfTime: { home: null, away: null },
      },
    },
    {
      id: 900003,
      utcDate: futureDate,
      status: finished ? 'FINISHED' : 'TIMED',
      matchday: 2,
      stage: 'LAST_16',
      group: null,
      homeTeam: REAL_MADRID,
      awayTeam: ARSENAL,
      score: {
        winner: finished ? ('HOME_TEAM' as const) : null,
        duration: 'REGULAR' as const,
        fullTime: { home: finished ? 3 : null, away: finished ? 0 : null },
        halfTime: { home: null, away: null },
      },
    },
    {
      id: 900004,
      utcDate: futureDate,
      status: finished ? 'FINISHED' : 'TIMED',
      matchday: 1,
      stage: 'FINAL',
      group: null,
      homeTeam: REAL_MADRID,
      awayTeam: LIVERPOOL,
      score: finished
        ? {
            winner: 'HOME_TEAM' as const,
            duration: 'PENALTY_SHOOTOUT' as const,
            fullTime: { home: 5, away: 4 },
            regularTime: { home: 1, away: 1 },
            extraTime: { home: 0, away: 0 },
            penalties: { home: 4, away: 3 },
            halfTime: { home: 0, away: 0 },
          }
        : {
            winner: null,
            duration: 'REGULAR' as const,
            fullTime: { home: null, away: null },
            halfTime: { home: null, away: null },
          },
    },
  ]
}

function buildPlMatches(finished: boolean) {
  const futureDate = '2099-08-15T14:00:00Z'
  return [
    {
      id: 800001,
      utcDate: futureDate,
      status: finished ? 'FINISHED' : 'TIMED',
      matchday: 1,
      stage: 'REGULAR_SEASON',
      group: null,
      homeTeam: ARSENAL,
      awayTeam: LIVERPOOL,
      score: {
        winner: finished ? ('HOME_TEAM' as const) : null,
        duration: 'REGULAR' as const,
        fullTime: { home: finished ? 2 : null, away: finished ? 0 : null },
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
      if (url.includes('/competitions/CL/matches') || url.includes('/competitions/2001/matches')) {
        return new Response(
          JSON.stringify({
            competition: { id: 2001, name: 'UEFA Champions League', code: 'CL' },
            matches: buildClMatches(finished),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/competitions/PL/matches') || url.includes('/competitions/2021/matches')) {
        return new Response(
          JSON.stringify({
            competition: { id: 2021, name: 'Premier League', code: 'PL' },
            matches: buildPlMatches(finished),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('Not found', { status: 404 })
    }),
  )
}

describe('Liga dos Campeões e Premier League ponta a ponta', () => {
  it('sincroniza sem duplicatas, cria grupos com tipo correto, lista fases, registra palpites e pontua', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    const env = makeEnv(db)

    sqlite
      .prepare(`INSERT INTO users (id, email, provider, provider_id, user_name) VALUES (?, ?, ?, ?, ?)`)
      .run(USER_ID, ADMIN_EMAIL, 'google', 'google-1', 'Pedro')

    const token = await signJwt({ sub: USER_ID, email: ADMIN_EMAIL }, JWT_SECRET, 3600)
    const headers = {
      Cookie: `session=${token}`,
      'Content-Type': 'application/json',
    }

    const request = async (path: string, init: RequestInit = {}) =>
      worker.fetch(
        new Request(`https://api.palpitae.com${path}`, {
          ...init,
          headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
        }),
        env,
        fakeExecutionCtx,
      )

    // 1. A migration 0018 já cadastrou as duas competições com o gate de pênaltis e o tipo certos.
    const compsBeforeRes = await request('/competitions')
    expect(compsBeforeRes.status).toBe(200)
    const compsBefore = (await compsBeforeRes.json()) as {
      competitions: Array<{
        id: string
        name: string
        slug: string
        status: string
        has_penalty_phases: boolean
      }>
    }
    const clComp = compsBefore.competitions.find((c) => c.slug === 'uefa-champions-league-2026')
    const plComp = compsBefore.competitions.find((c) => c.slug === 'premier-league-2026')
    expect(clComp).toMatchObject({
      id: '20010000-0000-4000-8000-000000002026',
      name: 'Liga dos Campeões',
      status: 'ongoing',
      has_penalty_phases: true,
    })
    expect(plComp).toMatchObject({
      id: '20210000-0000-4000-8000-000000002026',
      name: 'Premier League',
      status: 'ongoing',
      has_penalty_phases: false,
    })

    // 2. Sincroniza jogos agendados de CL e PL duas vezes seguidas e verifica ausência de duplicatas.
    stubFootballDataApi(false)
    for (const code of ['CL', 'PL', '2001', '2021']) {
      const syncRes = await request('/matches/sync', {
        method: 'POST',
        body: JSON.stringify({ competition: code, season: 2026 }),
      })
      expect(syncRes.status).toBe(200)
    }

    const compRows = sqlite
      .prepare(
        `SELECT slug, name, external_id, type, penalty_phases, status
         FROM competitions
         WHERE slug IN ('uefa-champions-league-2026', 'premier-league-2026')
         ORDER BY slug ASC`,
      )
      .all() as Array<{
      slug: string
      name: string
      external_id: string
      type: string
      penalty_phases: string
      status: string
    }>

    expect(compRows).toEqual([
      {
        slug: 'premier-league-2026',
        name: 'Premier League',
        external_id: '2021',
        type: 'league',
        penalty_phases: '[]',
        status: 'ongoing',
      },
      {
        slug: 'uefa-champions-league-2026',
        name: 'Liga dos Campeões',
        external_id: '2001',
        type: 'cup',
        penalty_phases: '["FINAL"]',
        status: 'ongoing',
      },
    ])

    const teamCount = sqlite.prepare(`SELECT COUNT(*) AS total FROM teams`).get() as {
      total: number
    }
    const matchCount = sqlite.prepare(`SELECT COUNT(*) AS total FROM matches`).get() as {
      total: number
    }
    expect(teamCount.total).toBe(4)
    expect(matchCount.total).toBe(5)

    // 3. Cria um grupo em cada competição e verifica competition_type no detalhe do grupo.
    const createClGroupRes = await request('/groups', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bolão da Champions',
        competition_id: clComp!.id,
        points_exact: 3,
        points_winner: 1,
        points_penalty: 1,
      }),
    })
    expect(createClGroupRes.status).toBe(201)
    const { group: clGroup } = (await createClGroupRes.json()) as { group: { id: string } }

    const createPlGroupRes = await request('/groups', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bolão da Premier',
        competition_id: plComp!.id,
        points_exact: 3,
        points_winner: 1,
        points_penalty: 0,
      }),
    })
    expect(createPlGroupRes.status).toBe(201)
    const { group: plGroup } = (await createPlGroupRes.json()) as { group: { id: string } }

    const clDetailRes = await request(`/groups/${clGroup.id}`)
    expect(clDetailRes.status).toBe(200)
    const clDetail = (await clDetailRes.json()) as {
      group: { competition_name: string; competition_type: string }
    }
    expect(clDetail.group).toMatchObject({
      competition_name: 'Liga dos Campeões',
      competition_type: 'cup',
    })

    const plDetailRes = await request(`/groups/${plGroup.id}`)
    expect(plDetailRes.status).toBe(200)
    const plDetail = (await plDetailRes.json()) as {
      group: { competition_name: string; competition_type: string }
    }
    expect(plDetail.group).toMatchObject({
      competition_name: 'Premier League',
      competition_type: 'league',
    })

    // 4. Lista partidas e confere fases, rótulos e decides_on_penalties apenas na FINAL da Champions.
    const clMatchesRes = await request(`/matches?competition_id=${clComp!.id}`)
    expect(clMatchesRes.status).toBe(200)
    const { matches: clMatches } = (await clMatchesRes.json()) as {
      matches: Array<{
        id: string
        phase: string
        round: string
        round_label: string
        decides_on_penalties: boolean
      }>
    }
    expect(
      clMatches.map((m) => ({
        phase: m.phase,
        round: m.round,
        round_label: m.round_label,
        decides_on_penalties: m.decides_on_penalties,
      })),
    ).toEqual([
      {
        phase: 'LEAGUE_STAGE',
        round: '1',
        round_label: 'Rodada 1',
        decides_on_penalties: false,
      },
      {
        phase: 'PLAYOFFS',
        round: 'PLAYOFFS',
        round_label: 'Playoffs',
        decides_on_penalties: false,
      },
      {
        phase: 'LAST_16',
        round: 'LAST_16',
        round_label: 'Oitavas de final',
        decides_on_penalties: false,
      },
      {
        phase: 'FINAL',
        round: 'FINAL',
        round_label: 'Final',
        decides_on_penalties: true,
      },
    ])

    const plMatchesRes = await request(`/matches?competition_id=${plComp!.id}`)
    expect(plMatchesRes.status).toBe(200)
    const { matches: plMatches } = (await plMatchesRes.json()) as {
      matches: Array<{
        id: string
        phase: string
        round: string
        round_label: string
        decides_on_penalties: boolean
      }>
    }
    expect(
      plMatches.map((m) => ({
        phase: m.phase,
        round: m.round,
        round_label: m.round_label,
        decides_on_penalties: m.decides_on_penalties,
      })),
    ).toEqual([
      {
        phase: 'REGULAR_SEASON',
        round: '1',
        round_label: 'Rodada 1',
        decides_on_penalties: false,
      },
    ])

    // 5. Envia palpites nos jogos da Champions e da Premier League, com pênaltis no empate da final.
    const clLeagueMatch = clMatches.find((m) => m.phase === 'LEAGUE_STAGE')!
    const clPlayoffMatch = clMatches.find((m) => m.phase === 'PLAYOFFS')!
    const clFinalMatch = clMatches.find((m) => m.phase === 'FINAL')!
    const plRound1Match = plMatches[0]

    // Na fase de Playoffs em ida e volta, o empate não exige predicted_penalty_winner.
    const predPlayoffRes = await request('/predictions', {
      method: 'PUT',
      body: JSON.stringify({
        group_id: clGroup.id,
        match_id: clPlayoffMatch.id,
        predicted_home_score: 1,
        predicted_away_score: 1,
      }),
    })
    expect(predPlayoffRes.status).toBe(200)

    // Na Final em jogo único, o empate sem predicted_penalty_winner retorna 400.
    const predFinalMissingPenRes = await request('/predictions', {
      method: 'PUT',
      body: JSON.stringify({
        group_id: clGroup.id,
        match_id: clFinalMatch.id,
        predicted_home_score: 1,
        predicted_away_score: 1,
      }),
    })
    expect(predFinalMissingPenRes.status).toBe(400)

    const predFinalRes = await request('/predictions', {
      method: 'PUT',
      body: JSON.stringify({
        group_id: clGroup.id,
        match_id: clFinalMatch.id,
        predicted_home_score: 1,
        predicted_away_score: 1,
        predicted_penalty_winner: 'home',
      }),
    })
    expect(predFinalRes.status).toBe(200)

    const predLeagueStageRes = await request('/predictions', {
      method: 'PUT',
      body: JSON.stringify({
        group_id: clGroup.id,
        match_id: clLeagueMatch.id,
        predicted_home_score: 1,
        predicted_away_score: 0,
      }),
    })
    expect(predLeagueStageRes.status).toBe(200)

    const predPlRes = await request('/predictions', {
      method: 'PUT',
      body: JSON.stringify({
        group_id: plGroup.id,
        match_id: plRound1Match.id,
        predicted_home_score: 2,
        predicted_away_score: 0,
      }),
    })
    expect(predPlRes.status).toBe(200)

    // 6. Finaliza e pontua as partidas via POST /matches/sync e confere ranking e palpites.
    stubFootballDataApi(true)
    for (const code of ['CL', 'PL']) {
      const finishSyncRes = await request('/matches/sync', {
        method: 'POST',
        body: JSON.stringify({ competition: code, season: 2026 }),
      })
      expect(finishSyncRes.status).toBe(200)
    }

    // Champions soma 1 ponto na Rodada 1, 3 pontos nos Playoffs e 4 pontos na Final com pênaltis, total de 8 pontos e 2 placares exatos.
    const clMembersRes = await request(`/groups/${clGroup.id}/members`)
    expect(clMembersRes.status).toBe(200)
    const { members: clMembers } = (await clMembersRes.json()) as {
      members: Array<{ user_id: string; total_points: number; exact_hits: number }>
    }
    expect(clMembers).toEqual([
      expect.objectContaining({
        user_id: USER_ID,
        total_points: 8,
        exact_hits: 2,
      }),
    ])

    const clPredictionsRes = await request(`/predictions?group_id=${clGroup.id}`)
    expect(clPredictionsRes.status).toBe(200)
    const { predictions: clPreds } = (await clPredictionsRes.json()) as {
      predictions: Array<{
        match_id: string
        points_awarded: number
        penalty_points: number
      }>
    }
    const finalPred = clPreds.find((p) => p.match_id === clFinalMatch.id)
    expect(finalPred).toMatchObject({
      points_awarded: 3,
      penalty_points: 1,
    })

    // Premier League soma 3 pontos e 1 placar exato no 2x0 da Rodada 1.
    const plMembersRes = await request(`/groups/${plGroup.id}/members`)
    expect(plMembersRes.status).toBe(200)
    const { members: plMembers } = (await plMembersRes.json()) as {
      members: Array<{ user_id: string; total_points: number; exact_hits: number }>
    }
    expect(plMembers).toEqual([
      expect.objectContaining({
        user_id: USER_ID,
        total_points: 3,
        exact_hits: 1,
      }),
    ])
  })
})
