/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import libertadoresFixtureJson from '../providers/__fixtures__/espn-conmebol-libertadores-scoreboard.json'
import type { EspnScoreboard } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { scoreWindowFromEspn } from './espnFallback'
import { isEspnPrimaryCompetition, syncEspnFixtures } from './espnSync'
import { discoverFixtures } from './fixtureDiscovery'
import { pollActiveMatches } from './poller'
import { syncFixtures } from './sync'

const LIBERTADORES_ID = '07830000-0000-4000-8000-000000002026'
const JWT_SECRET = 'test-libertadores-secret'
const ADMIN_EMAIL = 'admin@palpitae.com'
const PILOT_EMAIL = 'piloto@palpitae.com'
const ORDINARY_EMAIL = 'comum@palpitae.com'

const LIBERTADORES_BOARD = libertadoresFixtureJson as unknown as EspnScoreboard

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
 * Converte a fixture real da Libertadores com jogos encerrados em 2026 para o
 * estado agendado `pre` no futuro, para simular a descoberta inicial antes da
 * bola rolar.
 */
function buildScheduledLibertadoresBoard(): EspnScoreboard {
  const clone = structuredClone(LIBERTADORES_BOARD)
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
    if (url.includes('/sports/soccer/conmebol.libertadores/scoreboard')) {
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

describe('ESPN primária e Copa Libertadores em piloto', () => {
  it('reconhece os códigos das três copas ESPN como primárias', () => {
    expect(isEspnPrimaryCompetition('conmebol.libertadores')).toBe(true)
    expect(isEspnPrimaryCompetition('conmebol.sudamericana')).toBe(true)
    expect(isEspnPrimaryCompetition('bra.copa_do_brazil')).toBe(true)
    expect(isEspnPrimaryCompetition('WC')).toBe(false)
    expect(isEspnPrimaryCompetition('CL')).toBe(false)
  })

  it('sincroniza a Libertadores pela ESPN, isola no grupo fechado, pontua pênaltis e atualiza no ciclo automático', async () => {
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

    // 1. A migration 0020 cadastra a Libertadores 2026 como cup, provider espn e visibility pilot.
    const seededRow = sqlite
      .prepare(
        `SELECT id, name, slug, external_id, provider, season, status, type, visibility
           FROM competitions WHERE id = ?`,
      )
      .get(LIBERTADORES_ID)
    expect(seededRow).toEqual({
      id: LIBERTADORES_ID,
      name: 'Copa Libertadores',
      slug: 'conmebol-libertadores-2026',
      external_id: 'conmebol.libertadores',
      provider: 'espn',
      season: '2026',
      status: 'ongoing',
      type: 'cup',
      visibility: 'pilot',
    })

    // Piloto enxerga a Libertadores; usuário comum não a vê em GET /competitions.
    const pilotCompsRes = await request('/competitions', 'pilot')
    expect(pilotCompsRes.status).toBe(200)
    const pilotComps = (await pilotCompsRes.json()) as {
      competitions: Array<{ id: string; slug: string; has_penalty_phases: boolean }>
    }
    expect(pilotComps.competitions).toContainEqual(
      expect.objectContaining({
        id: LIBERTADORES_ID,
        slug: 'conmebol-libertadores-2026',
        has_penalty_phases: true,
      }),
    )

    const ordinaryCompsRes = await request('/competitions', 'ordinary')
    expect(ordinaryCompsRes.status).toBe(200)
    const ordinaryComps = (await ordinaryCompsRes.json()) as {
      competitions: Array<{ id: string }>
    }
    expect(ordinaryComps.competitions.map((c) => c.id)).not.toContain(LIBERTADORES_ID)

    // 2. Sincroniza jogos agendados pela rota POST /matches/sync mesmo sem FOOTBALL_API_KEY.
    stubEspnApi(buildScheduledLibertadoresBoard())

    const invalidDatesRes = await request('/matches/sync', 'admin', {
      method: 'POST',
      body: JSON.stringify({
        competition: 'conmebol.libertadores',
        season: 2026,
        dates: ['2026-02-04'],
      }),
    })
    expect(invalidDatesRes.status).toBe(400)

    const syncRes = await request('/matches/sync', 'admin', {
      method: 'POST',
      body: JSON.stringify({
        competition: 'conmebol.libertadores',
        season: 2026,
        dates: ['20260203', '20260407'],
      }),
    })
    expect(syncRes.status).toBe(200)
    expect(await syncRes.json()).toEqual({
      ok: true,
      synced: {
        competition: 'Copa Libertadores',
        competitionId: LIBERTADORES_ID,
        matches: 6,
        teams: 9,
      },
    })

    // 3. Lista partidas como membro do grupo piloto e confere fases, rótulos, grupo C e gate de pênaltis.
    const matchesRes = await request(`/matches?competition_id=${LIBERTADORES_ID}`, 'pilot')
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
        home: 'Deportivo La Guaira',
        away: 'Fluminense',
        status: 'scheduled',
        home_score: null,
        away_score: null,
        phase: 'GROUP_STAGE',
        round: 'GROUP_STAGE',
        round_label: 'Fase de grupos',
        group_name: 'C',
        decides_on_penalties: false,
      },
      {
        home: 'The Strongest',
        away: 'Deportivo Táchira',
        status: 'scheduled',
        home_score: null,
        away_score: null,
        phase: 'FIRST_STAGE',
        round: 'FIRST_STAGE',
        round_label: '1ª fase',
        group_name: null,
        decides_on_penalties: false,
      },
      {
        home: 'Fluminense',
        away: 'Independiente Rivadavia',
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
        home: 'Independiente Rivadavia',
        away: 'Fluminense',
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
        home: 'Liga de Quito',
        away: 'Palmeiras',
        status: 'scheduled',
        home_score: null,
        away_score: null,
        phase: 'QUARTER_FINALS',
        round: 'QUARTER_FINALS',
        round_label: 'Quartas de final',
        group_name: null,
        decides_on_penalties: true,
      },
      {
        home: 'Estudiantes de La Plata',
        away: 'Flamengo',
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
        name: 'Bolão Libertadores Piloto',
        competition_id: LIBERTADORES_ID,
        points_exact: 3,
        points_winner: 1,
        points_penalty: 1,
      }),
    })
    expect(createGroupRes.status).toBe(201)
    const { group } = (await createGroupRes.json()) as {
      group: { id: string; invite_code: string }
    }

    expect((await request(`/matches?competition_id=${LIBERTADORES_ID}`, 'ordinary')).status).toBe(
      404,
    )
    expect(
      (
        await request('/groups', 'ordinary', {
          method: 'POST',
          body: JSON.stringify({ name: 'Tentativa Comum', competition_id: LIBERTADORES_ID }),
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

    const groupMatch = matches.find((m) => m.phase === 'GROUP_STAGE')!
    const firstStageMatch = matches.find((m) => m.phase === 'FIRST_STAGE')!
    const round16Leg2 = matches.find(
      (m) => m.phase === 'LAST_16' && m.home_team_name === 'Independiente Rivadavia',
    )!
    const quarterMatch = matches.find((m) => m.phase === 'QUARTER_FINALS')!

    // Na Fase de grupos fora de penalty_phases, o empate não pede pênaltis.
    expect(
      (
        await request('/predictions', 'pilot', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: groupMatch.id,
            predicted_home_score: 0,
            predicted_away_score: 0,
          }),
        })
      ).status,
    ).toBe(200)

    // Sem palpite da ida, a volta não tem agregado previsto nem vencedor de pênaltis.
    expect(
      (
        await request('/predictions', 'pilot', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: round16Leg2.id,
            predicted_home_score: 1,
            predicted_away_score: 1,
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
            match_id: firstStageMatch.id,
            predicted_home_score: 2,
            predicted_away_score: 1,
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
            match_id: quarterMatch.id,
            predicted_home_score: 3,
            predicted_away_score: 2,
          }),
        })
      ).status,
    ).toBe(200)

    // 5. O ciclo automático com discoverFixtures e pollActiveMatches atualiza a partir da fixture real encerrada.
    stubEspnApi(LIBERTADORES_BOARD)
    await discoverFixtures(db, 'unused-key')

    // Verifica que todas as 6 partidas foram finalizadas com placares e pênaltis reais da fixture.
    const dbMatches = sqlite
      .prepare(
        `SELECT external_id, start_time, status, home_score, away_score,
                phase, round, group_name, duration, penalty_winner,
                home_penalty_goals, away_penalty_goals, locked_at, scored_at
           FROM matches
          WHERE competition_id = ?
          ORDER BY start_time ASC`,
      )
      .all(LIBERTADORES_ID) as Array<Record<string, unknown>>

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
        external_id: '401842610',
        start_time: '2026-02-04T00:30:00Z',
        status: 'finished',
        home_score: 2,
        away_score: 1,
        phase: 'FIRST_STAGE',
        group_name: null,
        duration: 'REGULAR',
        penalty_winner: null,
        home_penalty_goals: null,
        away_penalty_goals: null,
      },
      {
        external_id: '401865480',
        start_time: '2026-04-07T22:00:00Z',
        status: 'finished',
        home_score: 0,
        away_score: 0,
        phase: 'GROUP_STAGE',
        group_name: 'C',
        duration: 'REGULAR',
        penalty_winner: null,
        home_penalty_goals: null,
        away_penalty_goals: null,
      },
      {
        external_id: '401874070',
        start_time: '2026-08-11T22:00:00Z',
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
        external_id: '401874156',
        start_time: '2026-08-18T22:00:00Z',
        status: 'finished',
        home_score: 1,
        away_score: 1,
        phase: 'LAST_16',
        group_name: null,
        duration: 'PENALTY_SHOOTOUT',
        penalty_winner: 'away',
        home_penalty_goals: 4,
        away_penalty_goals: 5,
      },
      {
        external_id: '401912525',
        start_time: '2026-09-16T22:00:00Z',
        status: 'finished',
        home_score: 3,
        away_score: 2,
        phase: 'QUARTER_FINALS',
        group_name: null,
        duration: 'PENALTY_SHOOTOUT',
        penalty_winner: 'away',
        home_penalty_goals: 3,
        away_penalty_goals: 4,
      },
      {
        external_id: '401912523',
        start_time: '2026-10-16T00:30:00Z',
        status: 'finished',
        home_score: 0,
        away_score: 0,
        phase: 'SEMI_FINALS',
        group_name: null,
        duration: 'REGULAR',
        penalty_winner: null,
        home_penalty_goals: null,
        away_penalty_goals: null,
      },
    ])

    for (const m of dbMatches) {
      expect(m.locked_at).toEqual(expect.any(String))
      expect(m.scored_at).toEqual(expect.any(String))
    }

    // 6. Confere também pollActiveMatches quando um jogo da Libertadores cai na janela ativa sem scored_at.
    sqlite.prepare(`UPDATE matches SET scored_at = NULL WHERE external_id = '401912523'`).run()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse('2026-10-16T00:30:00Z') + 130 * 60 * 1000))
    await pollActiveMatches(db, 'unused-key')
    vi.useRealTimers()

    const rescored = sqlite
      .prepare(`SELECT scored_at FROM matches WHERE external_id = '401912523'`)
      .get() as { scored_at: string | null }
    expect(rescored.scored_at).toEqual(expect.any(String))

    // 7. Verifica a pontuação do piloto no ranking com 13 pontos totais, 1 ponto de bônus de pênalti e 4 placares exatos.
    const membersRes = await request(`/groups/${group.id}/members`, 'pilot')
    expect(membersRes.status).toBe(200)
    const { members } = (await membersRes.json()) as {
      members: Array<{ user_id: string; total_points: number; exact_hits: number }>
    }
    expect(members).toEqual([
      expect.objectContaining({
        user_id: 'u-pilot',
        total_points: 12,
        exact_hits: 4,
      }),
    ])

    const predsRes = await request(`/predictions?group_id=${group.id}`, 'pilot')
    expect(predsRes.status).toBe(200)
    const { predictions } = (await predsRes.json()) as {
      predictions: Array<{ match_id: string; points_awarded: number; penalty_points: number }>
    }
    const r16Pred = predictions.find((p) => p.match_id === round16Leg2.id)
    expect(r16Pred).toMatchObject({ points_awarded: 3, penalty_points: 0 })
  })

  it('re-sync e fallback não duplicam competição, time ou jogo entre os providers espn e football-data', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)

    // Semeia competição, times e partida do Brasileirão na football-data com clubes que também jogam a Libertadores.
    sqlite.exec(`
      INSERT INTO competitions (id, name, slug, external_id, provider, season, status, type, visibility)
      VALUES ('comp-bsa', 'Campeonato Brasileiro Série A', 'campeonato-brasileiro-serie-a-2026', 'BSA', 'football-data', '2026', 'ongoing', 'league', 'public');

      INSERT INTO teams (id, name, short_name, slug, external_id, provider) VALUES
        ('fd-flu', 'Fluminense FC', 'FLU', 'fluminense-fc', '1765', 'football-data'),
        ('fd-fla', 'CR Flamengo', 'FLA', 'cr-flamengo', '1783', 'football-data'),
        ('fd-pal', 'SE Palmeiras', 'PAL', 'se-palmeiras', '1769', 'football-data');

      INSERT INTO matches (
        id, competition_id, external_id, provider,
        home_team_id, away_team_id, start_time, status, phase, round
      ) VALUES (
        'm-bsa-1', 'comp-bsa', '999001', 'football-data',
        'fd-flu', 'fd-fla', '2026-10-16T00:30:00Z', 'scheduled', 'REGULAR_SEASON', '30'
      );
    `)

    const espnTotalBefore = sqlite
      .prepare(`SELECT COUNT(*) AS total FROM competitions WHERE provider = 'espn'`)
      .get() as { total: number }

    stubEspnApi(LIBERTADORES_BOARD)

    const first = await syncFixtures({
      competitionCode: 'conmebol.libertadores',
      season: 2026,
      db,
    })
    const second = await syncFixtures({
      competitionCode: 'conmebol.libertadores',
      season: 2026,
      dates: ['20260818', '20260818', '20260916'],
      db,
    })

    expect(first).toEqual({
      competition: 'Copa Libertadores',
      competitionId: LIBERTADORES_ID,
      matches: 6,
      teams: 9,
    })
    expect(second).toEqual(first)

    // Roda o fallback da ESPN com a Libertadores da ESPN e o Brasileirão da football-data.
    const now = Date.parse('2026-10-16T00:30:00Z') + 130 * 60 * 1000
    const updatedMap = await scoreWindowFromEspn(db, undefined, [LIBERTADORES_ID, 'comp-bsa'], {
      now,
    })
    // A Libertadores tem provider = 'espn' e é ignorada pelo fallback sem tocar nas linhas dela.
    expect(updatedMap.get(LIBERTADORES_ID)).toBe(0)

    const compCounts = sqlite
      .prepare(
        `SELECT provider, COUNT(*) AS total FROM competitions GROUP BY provider ORDER BY provider`,
      )
      .all()
    expect(compCounts).toEqual([
      { provider: 'espn', total: espnTotalBefore.total },
      { provider: 'football-data', total: 6 }, // Champions, Premier (0018), La Liga (0025), Serie A (0026), Bundesliga (0027) e Brasileirão
    ])
    const libertaSlugCount = sqlite
      .prepare(
        `SELECT COUNT(*) AS total FROM competitions WHERE slug = 'conmebol-libertadores-2026'`,
      )
      .get() as { total: number }
    expect(libertaSlugCount.total).toBe(1)

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

    // Preserva status 'ongoing', type 'cup', visibility 'pilot' e penalty_phases da Libertadores após re-sync.
    const liberta = sqlite
      .prepare(`SELECT status, type, visibility, penalty_phases FROM competitions WHERE id = ?`)
      .get(LIBERTADORES_ID) as Record<string, string>
    expect(liberta).toEqual({
      status: 'ongoing',
      type: 'cup',
      visibility: 'pilot',
      penalty_phases:
        '["FIRST_STAGE","SECOND_STAGE","THIRD_STAGE","LAST_16","QUARTER_FINALS","SEMI_FINALS","FINAL"]',
    })
  })

  it('cobre casos de borda fail-closed, prorrogação, jogo em andamento e adiamento no syncEspnFixtures', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)

    await expect(
      syncEspnFixtures({ competitionCode: 'liga.inexistente', season: 2026, db }),
    ).rejects.toThrow('Competição ESPN desconhecida liga.inexistente')

    // Scoreboard sem eventos válidos devolve contadores zerados sem gravar nada.
    stubEspnApi({
      events: [
        { id: '', date: '2026-05-01T20:00Z', season: { year: 2026, slug: 'final' } },
        { id: 'ev-other-year', date: '2025-05-01T20:00Z', season: { year: 2025, slug: 'final' } },
        { id: 'ev-bad-stage', date: '2026-05-01T20:00Z', season: { year: 2026, slug: 'unknown' } },
        { id: 'ev-bad-date', date: 'not-a-date', season: { year: 2026, slug: 'final' } },
        {
          id: 'ev-missing-teams',
          date: '2026-05-01T20:00Z',
          season: { year: 2026, slug: 'final' },
          competitions: [
            { competitors: [{ homeAway: 'home', team: { id: '1', displayName: 'A' } }] },
          ],
        },
      ],
    })

    const emptyRes = await syncEspnFixtures({
      competitionCode: 'conmebol.libertadores',
      season: 2026,
      db,
    })
    expect(emptyRes).toEqual({
      competition: 'Copa Libertadores',
      competitionId: '',
      matches: 0,
      teams: 0,
    })

    // Eventos que cobrem STATUS_FINAL_AET, STATUS_POSTPONED, estado 'in', fallback de short_name e winner booleano nos pênaltis.
    stubEspnApi({
      events: [
        {
          id: 'ev-aet',
          date: '2026-11-01T20:00Z',
          season: { year: 2026, slug: 'second-stage' },
          competitions: [
            {
              status: { type: { name: 'STATUS_FINAL_AET', state: 'post', completed: true } },
              competitors: [
                {
                  homeAway: 'home',
                  score: '2',
                  team: { id: 't1', displayName: 'Botafogo', shortDisplayName: 'BOT' },
                },
                {
                  homeAway: 'away',
                  score: '1',
                  team: { id: 't2', displayName: 'Nacional' },
                },
              ],
            },
          ],
        },
        {
          id: 'ev-pen-winner-flag',
          date: '2026-11-02T20:00Z',
          season: { year: 2026, slug: 'third-stage' },
          competitions: [
            {
              status: { type: { name: 'STATUS_FINAL_PEN', state: 'post', completed: true } },
              competitors: [
                {
                  homeAway: 'home',
                  score: '0',
                  winner: true,
                  team: { id: 't1', displayName: 'Botafogo', shortDisplayName: 'BOT' },
                },
                {
                  homeAway: 'away',
                  score: '0',
                  winner: false,
                  team: { id: 't2', displayName: 'Nacional' },
                },
              ],
            },
          ],
        },
        {
          id: 'ev-postponed-live',
          date: '2026-11-03T20:00Z',
          season: { year: 2026, slug: 'final' },
          competitions: [
            {
              status: { type: { name: 'STATUS_POSTPONED', state: 'in', completed: false } },
              competitors: [
                {
                  homeAway: 'home',
                  score: '0',
                  team: { id: 't1', displayName: 'Botafogo' },
                },
                {
                  homeAway: 'away',
                  score: '0',
                  team: { id: 't2', displayName: 'Nacional' },
                },
              ],
            },
          ],
        },
      ],
    })

    const edgeRes = await syncEspnFixtures({
      competitionCode: 'conmebol.libertadores',
      season: 2026,
      now: '2026-11-03T20:15:00Z',
      db,
    })
    expect(edgeRes.matches).toBe(3)
    expect(edgeRes.teams).toBe(2)

    const teams = sqlite
      .prepare(
        `SELECT external_id, short_name FROM teams WHERE provider = 'espn' ORDER BY external_id`,
      )
      .all()
    expect(teams).toEqual([
      { external_id: 't1', short_name: 'BOT' },
      { external_id: 't2', short_name: 'NAC' },
    ])

    const rows = sqlite
      .prepare(
        `SELECT external_id, status, duration, penalty_winner, postponed, locked_at
           FROM matches WHERE competition_id = ? ORDER BY external_id`,
      )
      .all(LIBERTADORES_ID)
    expect(rows).toEqual([
      {
        external_id: 'ev-aet',
        status: 'finished',
        duration: 'EXTRA_TIME',
        penalty_winner: null,
        postponed: 0,
        locked_at: '2026-11-03T20:15:00Z',
      },
      {
        external_id: 'ev-pen-winner-flag',
        status: 'finished',
        duration: 'PENALTY_SHOOTOUT',
        penalty_winner: 'home',
        postponed: 0,
        locked_at: '2026-11-03T20:15:00Z',
      },
      {
        external_id: 'ev-postponed-live',
        status: 'scheduled',
        duration: null,
        penalty_winner: null,
        postponed: 1,
        locked_at: '2026-11-03T20:15:00Z',
      },
    ])
  })
})
