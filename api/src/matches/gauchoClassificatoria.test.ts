/// <reference types="node" />
/**
 * Risco Gaúcho: ESPN `first-round` mapeava para FIRST_ROUND (mata-mata),
 * e jogos da classificatória podiam receber classified_points.
 *
 * Fronteira canônica: POST /matches/sync → GET /matches → palpites → pontuação.
 * Cadastro temporário só no teste; sem seed de produção 2027.
 */
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import gauchoFixtureJson from '../providers/__fixtures__/espn-bra-camp-gaucho-scoreboard.json'
import copaDoBrasilFixtureJson from '../providers/__fixtures__/espn-bra-copa-do-brazil-scoreboard.json'
import type { EspnScoreboard } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { ESPN_PRIMARY_COMPETITIONS } from './espnSync'

const JWT_SECRET = 'test-gaucho-classificatoria-secret'
const ADMIN_EMAIL = 'admin@palpitae.com'
const PILOT_EMAIL = 'piloto@palpitae.com'
const GAUCHO_CODE = 'bra.camp.gaucho'
const COPA_CODE = 'bra.copa_do_brazil'
const COPA_DO_BRASIL_ID = '06260000-0000-4000-8000-000000002026'
const POINTS_CLASSIFIED = 3

const GAUCHO_BOARD = gauchoFixtureJson as unknown as EspnScoreboard
const COPA_BOARD = copaDoBrasilFixtureJson as unknown as EspnScoreboard

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  delete ESPN_PRIMARY_COMPETITIONS[GAUCHO_CODE]
})

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    JWT_SECRET,
    ADMIN_EMAIL,
    PILOT_EMAILS: PILOT_EMAIL,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com',
    FRONTEND_URL: 'https://palpitae.com',
    FOOTBALL_API_KEY: '',
    RESEND_API_KEY: 'test-resend-key',
  }
}

const fakeExecutionCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext

function buildScheduledBoard(board: EspnScoreboard, baseMs: number): EspnScoreboard {
  const clone = structuredClone(board)
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

function stubEspnBoards(boards: Record<string, EspnScoreboard>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      for (const [code, board] of Object.entries(boards)) {
        if (url.includes(`/sports/soccer/${code}/scoreboard`)) {
          return new Response(JSON.stringify(board), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }
      return new Response('Not found', { status: 404 })
    }),
  )
}

describe('Gaúcho classificatória first-round (risco classificado)', () => {
  it('não concede classified_points na first-round gaúcha e preserva FIRST_ROUND mata-mata + quartas', async () => {
    ESPN_PRIMARY_COMPETITIONS[GAUCHO_CODE] = {
      name: 'Campeonato Gaúcho',
      slugPrefix: 'campeonato-gaucho-teste-classificatoria',
      type: 'cup',
    }

    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    const env = makeEnv(db)

    sqlite.exec(`
      INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
        ('u-admin', '${ADMIN_EMAIL}', 'google', 'g-admin', 'Admin'),
        ('u-pilot', '${PILOT_EMAIL}', 'google', 'g-pilot', 'Piloto');
      INSERT INTO profiles (user_id, nickname) VALUES
        ('u-admin', 'Admin'),
        ('u-pilot', 'Piloto');
    `)

    const tokens = {
      admin: await signJwt({ sub: 'u-admin', email: ADMIN_EMAIL }, JWT_SECRET, 3600),
      pilot: await signJwt({ sub: 'u-pilot', email: PILOT_EMAIL }, JWT_SECRET, 3600),
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

    // --- Gaúcho: sync agendado com fixture real ---
    stubEspnBoards({
      [GAUCHO_CODE]: buildScheduledBoard(GAUCHO_BOARD, Date.parse('2099-01-10T20:00:00Z')),
    })

    const gauchoSyncRes = await request('/matches/sync', 'admin', {
      method: 'POST',
      body: JSON.stringify({
        competition: GAUCHO_CODE,
        season: 2026,
        dates: ['20990110'],
      }),
    })
    expect(gauchoSyncRes.status).toBe(200)
    const gauchoSync = (await gauchoSyncRes.json()) as {
      ok: boolean
      synced: { competitionId: string; matches: number }
    }
    expect(gauchoSync.ok).toBe(true)
    expect(gauchoSync.synced.matches).toBeGreaterThan(0)
    const gauchoCompetitionId = gauchoSync.synced.competitionId

    const gauchoMatchesRes = await request(
      `/matches?competition_id=${gauchoCompetitionId}`,
      'pilot',
    )
    expect(gauchoMatchesRes.status).toBe(200)
    const { matches: gauchoMatches } = (await gauchoMatchesRes.json()) as {
      matches: Array<{
        id: string
        phase: string
        round: string
        round_label: string
        tie_role?: string
        home_team_name: string
        away_team_name: string
      }>
    }

    const firstRoundRows = sqlite
      .prepare(
        `SELECT m.id, m.external_id, m.phase, m.round
           FROM matches m
          WHERE m.competition_id = ?
            AND m.external_id IN ('762011', '762039')
          ORDER BY m.external_id`,
      )
      .all(gauchoCompetitionId) as Array<{
      id: string
      external_id: string
      phase: string
      round: string
    }>
    expect(firstRoundRows).toHaveLength(2)
    for (const row of firstRoundRows) {
      expect(row.phase).toBe('GROUP_STAGE')
      expect(row.round).toBe('GROUP_STAGE')
    }

    const firstRoundMatch = gauchoMatches.find((m) =>
      firstRoundRows.some((r) => r.id === m.id && r.external_id === '762011'),
    )
    expect(firstRoundMatch).toMatchObject({
      phase: 'GROUP_STAGE',
      round: 'GROUP_STAGE',
      round_label: 'Fase de grupos',
    })
    expect(firstRoundMatch?.tie_role).toBeUndefined()

    const quarterMatch = gauchoMatches.find((m) => {
      const ext = sqlite
        .prepare(`SELECT external_id FROM matches WHERE id = ?`)
        .get(m.id) as { external_id: string } | undefined
      return ext?.external_id === '401858934'
    })
    expect(quarterMatch).toMatchObject({
      phase: 'QUARTER_FINALS',
      round_label: 'Quartas de final',
      tie_role: 'single',
    })

    const createGauchoGroupRes = await request('/groups', 'pilot', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bolão Gaúcho Classificatória',
        competition_id: gauchoCompetitionId,
        points_exact: 3,
        points_winner: 1,
        points_penalty: 1,
        points_classified: POINTS_CLASSIFIED,
        predictions_visibility: 'public',
      }),
    })
    expect(createGauchoGroupRes.status).toBe(201)
    const { group: gauchoGroup } = (await createGauchoGroupRes.json()) as {
      group: { id: string }
    }

    // Placar real da fixture: Avenida 0 x 4 Grêmio; Caxias 0 x 2 Ypiranga.
    expect(
      (
        await request('/predictions', 'pilot', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: gauchoGroup.id,
            match_id: firstRoundMatch!.id,
            predicted_home_score: 0,
            predicted_away_score: 4,
          }),
        })
      ).status,
    ).toBe(200)

    expect(
      (
        await request('/predictions', 'pilot', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: gauchoGroup.id,
            match_id: quarterMatch!.id,
            predicted_home_score: 0,
            predicted_away_score: 2,
          }),
        })
      ).status,
    ).toBe(200)

    stubEspnBoards({ [GAUCHO_CODE]: GAUCHO_BOARD })
    const gauchoResync = await request('/matches/sync', 'admin', {
      method: 'POST',
      body: JSON.stringify({
        competition: GAUCHO_CODE,
        season: 2026,
        dates: ['20260110', '20260125', '20260215'],
      }),
    })
    expect(gauchoResync.status).toBe(200)

    const gauchoPredsRes = await request(`/predictions?group_id=${gauchoGroup.id}`, 'pilot')
    expect(gauchoPredsRes.status).toBe(200)
    const { predictions: gauchoPreds } = (await gauchoPredsRes.json()) as {
      predictions: Array<{
        match_id: string
        points_awarded: number
        classified_points: number
        predicted_classified: 'home' | 'away' | null
      }>
    }

    const firstRoundPred = gauchoPreds.find((p) => p.match_id === firstRoundMatch!.id)
    expect(firstRoundPred).toMatchObject({
      points_awarded: 3,
      classified_points: 0,
      predicted_classified: null,
    })

    const quarterPred = gauchoPreds.find((p) => p.match_id === quarterMatch!.id)
    expect(quarterPred).toMatchObject({
      points_awarded: 3,
      classified_points: POINTS_CLASSIFIED,
      predicted_classified: 'away',
    })

    // --- Controle: mesmo slug first-round em Copa do Brasil continua mata-mata elegível ---
    stubEspnBoards({
      [COPA_CODE]: buildScheduledBoard(COPA_BOARD, Date.parse('2099-04-01T22:00:00Z')),
    })
    const copaSyncRes = await request('/matches/sync', 'admin', {
      method: 'POST',
      body: JSON.stringify({
        competition: COPA_CODE,
        season: 2026,
        dates: ['20990401'],
      }),
    })
    expect(copaSyncRes.status).toBe(200)

    const copaMatchesRes = await request(`/matches?competition_id=${COPA_DO_BRASIL_ID}`, 'pilot')
    expect(copaMatchesRes.status).toBe(200)
    const { matches: copaMatches } = (await copaMatchesRes.json()) as {
      matches: Array<{
        id: string
        phase: string
        round_label: string
        tie_role?: string
        home_team_name: string
        away_team_name: string
      }>
    }
    const copaFirstRound = copaMatches.find((m) => m.phase === 'FIRST_ROUND')
    expect(copaFirstRound).toMatchObject({
      phase: 'FIRST_ROUND',
      round_label: '1ª fase',
      tie_role: 'single',
    })

    const createCopaGroupRes = await request('/groups', 'pilot', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bolão Copa Controle',
        competition_id: COPA_DO_BRASIL_ID,
        points_exact: 3,
        points_winner: 1,
        points_penalty: 1,
        points_classified: POINTS_CLASSIFIED,
        predictions_visibility: 'public',
      }),
    })
    expect(createCopaGroupRes.status).toBe(201)
    const { group: copaGroup } = (await createCopaGroupRes.json()) as { group: { id: string } }

    // Fixture Copa: Sampaio Correa RJ 1x1 Ferroviaria, visitante vence nos pênaltis.
    expect(
      (
        await request('/predictions', 'pilot', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: copaGroup.id,
            match_id: copaFirstRound!.id,
            predicted_home_score: 1,
            predicted_away_score: 1,
            predicted_penalty_winner: 'away',
          }),
        })
      ).status,
    ).toBe(200)

    stubEspnBoards({ [COPA_CODE]: COPA_BOARD })
    const copaResync = await request('/matches/sync', 'admin', {
      method: 'POST',
      body: JSON.stringify({
        competition: COPA_CODE,
        season: 2026,
        dates: ['20260217', '20260310'],
      }),
    })
    expect(copaResync.status).toBe(200)

    const copaPredsRes = await request(`/predictions?group_id=${copaGroup.id}`, 'pilot')
    expect(copaPredsRes.status).toBe(200)
    const { predictions: copaPreds } = (await copaPredsRes.json()) as {
      predictions: Array<{
        match_id: string
        points_awarded: number
        penalty_points: number
        classified_points: number
        predicted_classified: 'home' | 'away' | null
      }>
    }
    const copaFirstPred = copaPreds.find((p) => p.match_id === copaFirstRound!.id)
    expect(copaFirstPred).toMatchObject({
      points_awarded: 3,
      penalty_points: 1,
      classified_points: POINTS_CLASSIFIED,
      predicted_classified: 'away',
    })
  })
})
