/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import copaDoBrasilFixtureJson from '../providers/__fixtures__/espn-bra-copa-do-brazil-scoreboard.json'
import type { EspnScoreboard } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { scoreWindowFromEspn } from './espnFallback'
import { discoverFixtures } from './fixtureDiscovery'
import { pollActiveMatches } from './poller'
import { syncFixtures } from './sync'

const COPA_DO_BRASIL_ID = '06260000-0000-4000-8000-000000002026'
const JWT_SECRET = 'test-copa-do-brasil-secret'
const ADMIN_EMAIL = 'admin@palpitae.com'
const PILOT_EMAIL = 'piloto@palpitae.com'
const ORDINARY_EMAIL = 'comum@palpitae.com'

const COPA_DO_BRASIL_BOARD = copaDoBrasilFixtureJson as unknown as EspnScoreboard

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
 * Converte a fixture real da Copa do Brasil em 2026 para o estado agendado
 * `pre` no futuro, para simular a descoberta inicial antes da bola rolar.
 */
function buildScheduledCopaDoBrasilBoard(): EspnScoreboard {
  const clone = structuredClone(COPA_DO_BRASIL_BOARD)
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
    if (url.includes('/sports/soccer/bra.copa_do_brazil/scoreboard')) {
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

describe('Copa do Brasil em piloto', () => {
  it('sincroniza a Copa do Brasil pela ESPN, isola no grupo fechado, pontua pênaltis e atualiza no ciclo automático', async () => {
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

    // 1. A migration 0021 cadastra a Copa do Brasil 2026 como cup, provider espn e visibility pilot.
    const seededRow = sqlite
      .prepare(
        `SELECT id, name, slug, external_id, provider, season, status, type, visibility
           FROM competitions WHERE id = ?`,
      )
      .get(COPA_DO_BRASIL_ID)
    expect(seededRow).toEqual({
      id: COPA_DO_BRASIL_ID,
      name: 'Copa do Brasil',
      slug: 'copa-do-brasil-2026',
      external_id: 'bra.copa_do_brazil',
      provider: 'espn',
      season: '2026',
      status: 'ongoing',
      type: 'cup',
      visibility: 'pilot',
    })

    // Piloto enxerga a Copa do Brasil; usuário comum não a vê em GET /competitions.
    const pilotCompsRes = await request('/competitions', 'pilot')
    expect(pilotCompsRes.status).toBe(200)
    const pilotComps = (await pilotCompsRes.json()) as {
      competitions: Array<{ id: string; slug: string; has_penalty_phases: boolean }>
    }
    expect(pilotComps.competitions).toContainEqual(
      expect.objectContaining({
        id: COPA_DO_BRASIL_ID,
        slug: 'copa-do-brasil-2026',
        has_penalty_phases: true,
      }),
    )

    const ordinaryCompsRes = await request('/competitions', 'ordinary')
    expect(ordinaryCompsRes.status).toBe(200)
    const ordinaryComps = (await ordinaryCompsRes.json()) as {
      competitions: Array<{ id: string }>
    }
    expect(ordinaryComps.competitions.map((c) => c.id)).not.toContain(COPA_DO_BRASIL_ID)

    // 2. Sincroniza jogos agendados pela rota POST /matches/sync mesmo sem FOOTBALL_API_KEY.
    stubEspnApi(buildScheduledCopaDoBrasilBoard())

    const syncRes = await request('/matches/sync', 'admin', {
      method: 'POST',
      body: JSON.stringify({
        competition: 'bra.copa_do_brazil',
        season: 2026,
        dates: ['20260217', '20260310'],
      }),
    })
    expect(syncRes.status).toBe(200)
    expect(await syncRes.json()).toEqual({
      ok: true,
      synced: {
        competition: 'Copa do Brasil',
        competitionId: COPA_DO_BRASIL_ID,
        matches: 6,
        teams: 9,
      },
    })

    // 3. Lista partidas como membro do grupo piloto e confere fases, rótulos e gate de pênaltis.
    const matchesRes = await request(`/matches?competition_id=${COPA_DO_BRASIL_ID}`, 'pilot')
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
        group_name: string | null
        decides_on_penalties: boolean
        home_team_name: string
        away_team_name: string
      }>
    }
    expect(matches).toHaveLength(6)
    expect(
      matches.map((m) => ({
        home: m.home_team_name,
        away: m.away_team_name,
        status: m.status,
        home_score: m.home_score,
        away_score: m.away_score,
        phase: m.phase,
        round: m.round,
        round_label: m.round_label,
        group_name: m.group_name,
        decides_on_penalties: m.decides_on_penalties,
      })),
    ).toEqual([
      {
        home: 'Sampaio Correa RJ',
        away: 'Ferroviaria',
        status: 'scheduled',
        home_score: null,
        away_score: null,
        phase: 'FIRST_ROUND',
        round: 'FIRST_ROUND',
        round_label: '1ª fase',
        group_name: null,
        decides_on_penalties: true,
      },
      {
        home: 'Portuguesa',
        away: 'Avaí',
        status: 'scheduled',
        home_score: null,
        away_score: null,
        phase: 'THIRD_ROUND',
        round: 'THIRD_ROUND',
        round_label: '3ª fase',
        group_name: null,
        decides_on_penalties: true,
      },
      {
        home: 'Botafogo',
        away: 'Chapecoense',
        status: 'scheduled',
        home_score: null,
        away_score: null,
        phase: 'FIFTH_ROUND',
        round: 'FIFTH_ROUND',
        round_label: '5ª fase',
        group_name: null,
        decides_on_penalties: false,
      },
      {
        home: 'Vasco da Gama',
        away: 'Fluminense',
        status: 'scheduled',
        home_score: null,
        away_score: null,
        phase: 'LAST_16',
        round: 'LAST_16',
        round_label: 'Oitavas de final',
        group_name: null,
        decides_on_penalties: false,
      },
      {
        home: 'Fluminense',
        away: 'Vasco da Gama',
        status: 'scheduled',
        home_score: null,
        away_score: null,
        phase: 'LAST_16',
        round: 'LAST_16',
        round_label: 'Oitavas de final',
        group_name: null,
        decides_on_penalties: true,
      },
      {
        home: 'Palmeiras',
        away: 'Vasco da Gama',
        status: 'scheduled',
        home_score: null,
        away_score: null,
        phase: 'SEMI_FINALS',
        round: 'SEMI_FINALS',
        round_label: 'Semifinais',
        group_name: null,
        decides_on_penalties: false,
      },
    ])

    // 4. Grupo fechado cria bolão e palpita; usuário comum recebe 404.
    const createGroupRes = await request('/groups', 'pilot', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bolão Copa do Brasil Piloto',
        competition_id: COPA_DO_BRASIL_ID,
        points_exact: 3,
        points_winner: 1,
        points_penalty: 1,
      }),
    })
    expect(createGroupRes.status).toBe(201)
    const { group } = (await createGroupRes.json()) as {
      group: { id: string; invite_code: string }
    }

    expect((await request(`/matches?competition_id=${COPA_DO_BRASIL_ID}`, 'ordinary')).status).toBe(
      404,
    )
    expect(
      (
        await request('/groups', 'ordinary', {
          method: 'POST',
          body: JSON.stringify({ name: 'Tentativa Comum', competition_id: COPA_DO_BRASIL_ID }),
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request('/groups/join', 'ordinary', {
          method: 'POST',
          body: JSON.stringify({ invite_code: group.invite_code }),
        })
      ).status,
    ).toBe(404)
    expect((await request(`/groups/${group.id}/members`, 'ordinary')).status).toBe(404)

    const firstRoundMatch = matches.find((m) => m.phase === 'FIRST_ROUND')!
    const thirdRoundMatch = matches.find((m) => m.phase === 'THIRD_ROUND')!
    const fifthRoundMatch = matches.find((m) => m.phase === 'FIFTH_ROUND')!
    const round16Leg1 = matches.find(
      (m) => m.phase === 'LAST_16' && m.home_team_name === 'Vasco da Gama',
    )!
    const round16Leg2 = matches.find(
      (m) => m.phase === 'LAST_16' && m.home_team_name === 'Fluminense',
    )!
    const semiFinalMatch = matches.find((m) => m.phase === 'SEMI_FINALS')!

    expect(
      (
        await request('/predictions', 'ordinary', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: firstRoundMatch.id,
            predicted_home_score: 1,
            predicted_away_score: 0,
          }),
        })
      ).status,
    ).toBe(404)

    // No mata-mata com FIRST_ROUND em penalty_phases, o empate exige predicted_penalty_winner.
    expect(
      (
        await request('/predictions', 'pilot', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: firstRoundMatch.id,
            predicted_home_score: 1,
            predicted_away_score: 1,
          }),
        })
      ).status,
    ).toBe(400)

    expect(
      (
        await request('/predictions', 'pilot', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: firstRoundMatch.id,
            predicted_home_score: 1,
            predicted_away_score: 1,
            predicted_penalty_winner: 'away',
          }),
        })
      ).status,
    ).toBe(200)

    expect(
      (
        await request('/predictions', 'pilot', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: thirdRoundMatch.id,
            predicted_home_score: 1,
            predicted_away_score: 1,
            predicted_penalty_winner: 'home',
          }),
        })
      ).status,
    ).toBe(200)

    expect(
      (
        await request('/predictions', 'pilot', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: fifthRoundMatch.id,
            predicted_home_score: 1,
            predicted_away_score: 0,
          }),
        })
      ).status,
    ).toBe(200)

    expect(
      (
        await request('/predictions', 'pilot', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: round16Leg1.id,
            predicted_home_score: 0,
            predicted_away_score: 0,
            predicted_penalty_winner: 'home',
          }),
        })
      ).status,
    ).toBe(200)

    expect(
      (
        await request('/predictions', 'pilot', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: round16Leg2.id,
            predicted_home_score: 0,
            predicted_away_score: 2,
          }),
        })
      ).status,
    ).toBe(200)

    expect(
      (
        await request('/predictions', 'pilot', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: semiFinalMatch.id,
            predicted_home_score: 2,
            predicted_away_score: 1,
          }),
        })
      ).status,
    ).toBe(200)

    // 5. O ciclo automático com discoverFixtures e pollActiveMatches atualiza a partir da fixture real.
    stubEspnApi(COPA_DO_BRASIL_BOARD)
    await discoverFixtures(db, 'unused-key')

    // Verifica que os 5 jogos encerrados e a semifinal agendada foram gravados conforme a fixture real.
    const dbMatches = sqlite
      .prepare(
        `SELECT external_id, start_time, status, home_score, away_score,
                phase, round, group_name, duration, penalty_winner,
                home_penalty_goals, away_penalty_goals, locked_at, scored_at
           FROM matches
          WHERE competition_id = ?
          ORDER BY start_time ASC`,
      )
      .all(COPA_DO_BRASIL_ID) as Array<Record<string, unknown>>

    expect(
      dbMatches.map((m) => ({
        external_id: m.external_id,
        start_time: m.start_time,
        status: m.status,
        home_score: m.home_score,
        away_score: m.away_score,
        phase: m.phase,
        group_name: m.group_name,
        duration: m.duration,
        penalty_winner: m.penalty_winner,
        home_penalty_goals: m.home_penalty_goals,
        away_penalty_goals: m.away_penalty_goals,
      })),
    ).toEqual([
      {
        external_id: '401858546',
        start_time: '2026-02-17T23:00:00Z',
        status: 'finished',
        home_score: 1,
        away_score: 1,
        phase: 'FIRST_ROUND',
        group_name: null,
        duration: 'PENALTY_SHOOTOUT',
        penalty_winner: 'away',
        home_penalty_goals: 1,
        away_penalty_goals: 3,
      },
      {
        external_id: '401862881',
        start_time: '2026-03-10T22:00:00Z',
        status: 'finished',
        home_score: 1,
        away_score: 1,
        phase: 'THIRD_ROUND',
        group_name: null,
        duration: 'PENALTY_SHOOTOUT',
        penalty_winner: 'home',
        home_penalty_goals: 4,
        away_penalty_goals: 1,
      },
      {
        external_id: '401866345',
        start_time: '2026-04-21T20:00:00Z',
        status: 'finished',
        home_score: 1,
        away_score: 0,
        phase: 'FIFTH_ROUND',
        group_name: null,
        duration: 'REGULAR',
        penalty_winner: null,
        home_penalty_goals: null,
        away_penalty_goals: null,
      },
      {
        external_id: '401873956',
        start_time: '2026-08-01T20:30:00Z',
        status: 'finished',
        home_score: 0,
        away_score: 0,
        phase: 'LAST_16',
        group_name: null,
        duration: 'REGULAR',
        penalty_winner: null,
        home_penalty_goals: null,
        away_penalty_goals: null,
      },
      {
        external_id: '401874095',
        start_time: '2026-08-06T00:30:00Z',
        status: 'finished',
        home_score: 1,
        away_score: 3,
        phase: 'LAST_16',
        group_name: null,
        duration: 'REGULAR',
        penalty_winner: null,
        home_penalty_goals: null,
        away_penalty_goals: null,
      },
      {
        external_id: '401913105',
        start_time: '2026-11-01T19:00:00Z',
        status: 'scheduled',
        home_score: null,
        away_score: null,
        phase: 'SEMI_FINALS',
        group_name: null,
        duration: null,
        penalty_winner: null,
        home_penalty_goals: null,
        away_penalty_goals: null,
      },
    ])

    for (const m of dbMatches.slice(0, 5)) {
      expect(m.locked_at).toEqual(expect.any(String))
      expect(m.scored_at).toEqual(expect.any(String))
    }
    expect(dbMatches[5].locked_at).toBeNull()
    expect(dbMatches[5].scored_at).toBeNull()

    // 6. Confere também pollActiveMatches quando um jogo da Copa do Brasil cai na janela ativa sem scored_at.
    sqlite.prepare(`UPDATE matches SET scored_at = NULL WHERE external_id = '401874095'`).run()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse('2026-08-06T00:30:00Z') + 130 * 60 * 1000))
    await pollActiveMatches(db, 'unused-key')
    vi.useRealTimers()

    const rescored = sqlite
      .prepare(`SELECT scored_at FROM matches WHERE external_id = '401874095'`)
      .get() as { scored_at: string | null }
    expect(rescored.scored_at).toEqual(expect.any(String))

    // 7. Verifica a pontuação do piloto no ranking com 15 pontos totais, 2 pontos de bônus de pênalti e 4 placares exatos.
    const membersRes = await request(`/groups/${group.id}/members`, 'pilot')
    expect(membersRes.status).toBe(200)
    const { members } = (await membersRes.json()) as {
      members: Array<{ user_id: string; total_points: number; exact_hits: number }>
    }
    expect(members).toEqual([
      expect.objectContaining({
        user_id: 'u-pilot',
        total_points: 15,
        exact_hits: 4,
      }),
    ])

    const predsRes = await request(`/predictions?group_id=${group.id}`, 'pilot')
    expect(predsRes.status).toBe(200)
    const { predictions } = (await predsRes.json()) as {
      predictions: Array<{ match_id: string; points_awarded: number; penalty_points: number }>
    }
    const r1Pred = predictions.find((p) => p.match_id === firstRoundMatch.id)
    const r3Pred = predictions.find((p) => p.match_id === thirdRoundMatch.id)
    expect(r1Pred).toMatchObject({ points_awarded: 3, penalty_points: 1 })
    expect(r3Pred).toMatchObject({ points_awarded: 3, penalty_points: 1 })
  })

  it('re-sync e fallback não duplicam competição, time ou jogo entre os providers espn e football-data', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)

    // Semeia competição, times e partida do Brasileirão na football-data com clubes que também jogam a Copa do Brasil.
    sqlite.exec(`
      INSERT INTO competitions (id, name, slug, external_id, provider, season, status, type, visibility)
      VALUES ('comp-bsa', 'Campeonato Brasileiro Série A', 'campeonato-brasileiro-serie-a-2026', 'BSA', 'football-data', '2026', 'ongoing', 'league', 'public');

      INSERT INTO teams (id, name, short_name, slug, external_id, provider) VALUES
        ('fd-flu', 'Fluminense FC', 'FLU', 'fluminense-fc', '1765', 'football-data'),
        ('fd-bot', 'Botafogo FR', 'BOT', 'botafogo-fr', '1770', 'football-data'),
        ('fd-pal', 'SE Palmeiras', 'PAL', 'se-palmeiras', '1769', 'football-data');

      INSERT INTO matches (
        id, competition_id, external_id, provider,
        home_team_id, away_team_id, start_time, status, phase, round
      ) VALUES (
        'm-bsa-1', 'comp-bsa', '999001', 'football-data',
        'fd-flu', 'fd-bot', '2026-08-06T00:30:00Z', 'scheduled', 'REGULAR_SEASON', '22'
      );
    `)

    const espnTotalBefore = sqlite
      .prepare(`SELECT COUNT(*) AS total FROM competitions WHERE provider = 'espn'`)
      .get() as { total: number }

    stubEspnApi(COPA_DO_BRASIL_BOARD)

    const first = await syncFixtures({
      competitionCode: 'bra.copa_do_brazil',
      season: 2026,
      db,
    })
    const second = await syncFixtures({
      competitionCode: 'bra.copa_do_brazil',
      season: 2026,
      dates: ['20260217', '20260217', '20260310'],
      db,
    })

    expect(first).toEqual({
      competition: 'Copa do Brasil',
      competitionId: COPA_DO_BRASIL_ID,
      matches: 6,
      teams: 9,
    })
    expect(second).toEqual(first)

    // Roda o fallback da ESPN com a Copa do Brasil da ESPN e o Brasileirão da football-data.
    const now = Date.parse('2026-08-06T00:30:00Z') + 130 * 60 * 1000
    const updatedMap = await scoreWindowFromEspn(db, undefined, [COPA_DO_BRASIL_ID, 'comp-bsa'], {
      now,
    })
    // A Copa do Brasil tem provider = 'espn' e é ignorada pelo fallback sem tocar nas linhas dela.
    expect(updatedMap.get(COPA_DO_BRASIL_ID)).toBe(0)

    const compCounts = sqlite
      .prepare(
        `SELECT provider, COUNT(*) AS total FROM competitions GROUP BY provider ORDER BY provider`,
      )
      .all()
    expect(compCounts).toEqual([
      { provider: 'espn', total: espnTotalBefore.total },
      { provider: 'football-data', total: 7 },
    ])
    const copaDoBrasilSlugCount = sqlite
      .prepare(`SELECT COUNT(*) AS total FROM competitions WHERE slug = 'copa-do-brasil-2026'`)
      .get() as { total: number }
    expect(copaDoBrasilSlugCount.total).toBe(1)

    const teamCounts = sqlite
      .prepare(`SELECT provider, COUNT(*) AS total FROM teams GROUP BY provider ORDER BY provider`)
      .all()
    expect(teamCounts).toEqual([
      { provider: 'espn', total: 9 },
      { provider: 'football-data', total: 3 },
    ])

    const matchCounts = sqlite
      .prepare(
        `SELECT provider, COUNT(*) AS total FROM matches GROUP BY provider ORDER BY provider`,
      )
      .all()
    expect(matchCounts).toEqual([
      { provider: 'espn', total: 6 },
      { provider: 'football-data', total: 1 },
    ])

    // Preserva status 'ongoing', type 'cup', visibility 'pilot' e penalty_phases da Copa do Brasil após re-sync.
    const copaDoBrasil = sqlite
      .prepare(`SELECT status, type, visibility, penalty_phases FROM competitions WHERE id = ?`)
      .get(COPA_DO_BRASIL_ID) as Record<string, string>
    expect(copaDoBrasil).toEqual({
      status: 'ongoing',
      type: 'cup',
      visibility: 'pilot',
      penalty_phases:
        '["FIRST_ROUND","SECOND_ROUND","THIRD_ROUND","FOURTH_ROUND","FIFTH_ROUND","LAST_16","QUARTER_FINALS","SEMI_FINALS","FINAL"]',
    })
  })
})
