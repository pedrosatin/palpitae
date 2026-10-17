/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

const JWT_SECRET = 'test-tie-classified-secret'
const COMP_ID = 'comp-knockout-2026'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    JWT_SECRET,
    ADMIN_EMAIL: 'admin@palpitae.com',
    PILOT_EMAILS: 'admin@palpitae.com',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com',
    FRONTEND_URL: 'https://palpitae.com',
    FOOTBALL_API_KEY: 'test-football-key',
    RESEND_API_KEY: 'test-resend-key',
  }
}

const fakeExecutionCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext

async function apiRequest(
  db: D1Database,
  user: { id: string; email: string },
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await signJwt({ sub: user.id, email: user.email }, JWT_SECRET, 3600)
  const headers = new Headers(init.headers)
  headers.set('Cookie', `session=${token}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return worker.fetch(
    new Request(`https://api.palpitae.com${path}`, { ...init, headers }),
    makeEnv(db),
    fakeExecutionCtx,
  )
}

function seedKnockoutFixtures(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
      ('u-ana', 'ana@palpitae.com', 'google', 'g-ana', 'Ana'),
      ('u-beto', 'beto@palpitae.com', 'google', 'g-beto', 'Beto'),
      ('u-caio', 'caio@palpitae.com', 'google', 'g-caio', 'Caio');

    INSERT INTO competitions (id, name, slug, external_id, provider, season, status, type, visibility, penalty_phases)
    VALUES (
      '${COMP_ID}',
      'Copa Teste 2026',
      'copa-teste-2026',
      '9901',
      'football-data',
      '2026',
      'ongoing',
      'cup',
      'public',
      '["LAST_16","QUARTER_FINALS","SEMI_FINALS","FINAL"]'
    );

    INSERT INTO teams (id, name, short_name, slug, external_id, provider) VALUES
      ('t-fla', 'Flamengo', 'FLA', 'flamengo', '101', 'football-data'),
      ('t-pal', 'Palmeiras', 'PAL', 'palmeiras', '102', 'football-data'),
      ('t-bot', 'Botafogo', 'BOT', 'botafogo', '103', 'football-data'),
      ('t-flu', 'Fluminense', 'FLU', 'fluminense', '104', 'football-data');

    INSERT INTO matches (
      id, competition_id, external_id, provider,
      home_team_id, away_team_id, start_time, status, phase, round, leg
    ) VALUES
      ('m-r16-leg1', '${COMP_ID}', 'ext-r16-1', 'football-data', 't-fla', 't-pal', '2099-08-10T22:00:00Z', 'scheduled', 'LAST_16', 'LAST_16', 1),
      ('m-r16-leg2', '${COMP_ID}', 'ext-r16-2', 'football-data', 't-pal', 't-fla', '2099-08-17T22:00:00Z', 'scheduled', 'LAST_16', 'LAST_16', 2),
      ('m-qf-leg1', '${COMP_ID}', 'ext-qf-1', 'football-data', 't-bot', 't-flu', '2099-09-01T22:00:00Z', 'scheduled', 'QUARTER_FINALS', 'QUARTER_FINALS', 1),
      ('m-qf-leg2', '${COMP_ID}', 'ext-qf-2', 'football-data', 't-flu', 't-bot', '2099-09-08T22:00:00Z', 'scheduled', 'QUARTER_FINALS', 'QUARTER_FINALS', 2),
      ('m-semi-single', '${COMP_ID}', 'ext-semi-1', 'football-data', 't-fla', 't-bot', '2099-10-01T22:00:00Z', 'scheduled', 'SEMI_FINALS', 'SEMI_FINALS', NULL),
      ('m-final-single', '${COMP_ID}', 'ext-final-1', 'football-data', 't-fla', 't-flu', '2099-11-01T22:00:00Z', 'scheduled', 'FINAL', 'FINAL', NULL);
  `)
}

async function createConfiguredGroup(
  db: D1Database,
  pointsClassified = 2,
): Promise<{ id: string; invite_code: string }> {
  const ana = { id: 'u-ana', email: 'ana@palpitae.com' }
  const beto = { id: 'u-beto', email: 'beto@palpitae.com' }
  const caio = { id: 'u-caio', email: 'caio@palpitae.com' }

  const res = await apiRequest(db, ana, '/groups', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Bolão Mata-Mata',
      competition_id: COMP_ID,
      points_exact: 3,
      points_winner: 1,
      points_penalty: 1,
      points_classified: pointsClassified,
      predictions_visibility: 'public',
    }),
  })
  expect(res.status).toBe(201)
  const { group } = (await res.json()) as { group: { id: string; invite_code: string } }

  for (const user of [beto, caio]) {
    const joinRes = await apiRequest(db, user, '/groups/join', {
      method: 'POST',
      body: JSON.stringify({ invite_code: group.invite_code }),
    })
    expect(joinRes.status).toBe(200)
  }

  return group
}

const ANA = { id: 'u-ana', email: 'ana@palpitae.com' }
const BETO = { id: 'u-beto', email: 'beto@palpitae.com' }

async function putPrediction(
  db: D1Database,
  user: { id: string; email: string },
  groupId: string,
  matchId: string,
  home: number,
  away: number,
  penaltyWinner?: string,
): Promise<Response> {
  return apiRequest(db, user, '/predictions', {
    method: 'PUT',
    body: JSON.stringify({
      group_id: groupId,
      match_id: matchId,
      predicted_home_score: home,
      predicted_away_score: away,
      ...(penaltyWinner === undefined ? {} : { predicted_penalty_winner: penaltyWinner }),
    }),
  })
}

function finishMatch(
  sqlite: DatabaseSync,
  matchId: string,
  home: number,
  away: number,
  penaltyWinner: 'home' | 'away' | null = null,
  competitionId = COMP_ID,
) {
  sqlite
    .prepare(
      `UPDATE matches
       SET status = 'finished', home_score = ?, away_score = ?, penalty_winner = ?,
           locked_at = COALESCE(locked_at, start_time)
       WHERE id = ? AND competition_id = ?`,
    )
    .run(home, away, penaltyWinner, matchId, competitionId)
}

async function ownPrediction(
  db: D1Database,
  user: { id: string; email: string },
  groupId: string,
  matchId: string,
) {
  const res = await apiRequest(db, user, `/predictions?group_id=${groupId}&match_id=${matchId}`)
  expect(res.status).toBe(200)
  const { predictions } = (await res.json()) as { predictions: Array<Record<string, unknown>> }
  return predictions[0]
}

async function totalPoints(db: D1Database, groupId: string, userId: string) {
  const res = await apiRequest(db, ANA, `/groups/${groupId}/members`)
  const { members } = (await res.json()) as {
    members: Array<{ user_id: string; total_points: number }>
  }
  return members.find((m) => m.user_id === userId)?.total_points
}

function storedPick(sqlite: DatabaseSync, userId: string, matchId: string) {
  const row = sqlite
    .prepare(`SELECT predicted_penalty_winner FROM predictions WHERE user_id = ? AND match_id = ?`)
    .get(userId, matchId) as { predicted_penalty_winner: string | null } | undefined
  return row ? row.predicted_penalty_winner : undefined
}

describe('confrontos de mata-mata, agregado e pontos de classificado pela API', () => {
  it('configura points_classified no grupo, expõe leg em GET /matches e valida limites', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedKnockoutFixtures(sqlite)

    const ana = { id: 'u-ana', email: 'ana@palpitae.com' }

    const badRes = await apiRequest(db, ana, '/groups', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Grupo Inválido',
        competition_id: COMP_ID,
        points_classified: 11,
      }),
    })
    expect(badRes.status).toBe(400)

    const group = await createConfiguredGroup(db, 4)

    const detailRes = await apiRequest(db, ana, `/groups/${group.id}`)
    expect(detailRes.status).toBe(200)
    const detailBody = (await detailRes.json()) as {
      group: { points_classified: number; points_penalty: number }
    }
    expect(detailBody.group.points_classified).toBe(4)

    const matchesRes = await apiRequest(db, ana, `/matches?competition_id=${COMP_ID}`)
    expect(matchesRes.status).toBe(200)
    const { matches } = (await matchesRes.json()) as {
      matches: Array<{ id: string; leg: number | null }>
    }
    expect(matches.find((m) => m.id === 'm-r16-leg1')?.leg).toBe(1)
    expect(matches.find((m) => m.id === 'm-r16-leg2')?.leg).toBe(2)
    expect(matches.find((m) => m.id === 'm-final-single')?.leg).toBeNull()
  })

  it('deriva o classificado previsto de ida e volta e só soma pontos de classificado após o jogo decisivo', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedKnockoutFixtures(sqlite)

    const group = await createConfiguredGroup(db, 2)
    const ana = { id: 'u-ana', email: 'ana@palpitae.com' }
    const beto = { id: 'u-beto', email: 'beto@palpitae.com' }

    // Ana prevê Flamengo 2x0 na ida e Palmeiras 1x0 na volta, com agregado de 2x1 para o Flamengo como visitante na volta
    expect(
      (
        await apiRequest(db, ana, '/predictions', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: 'm-r16-leg1',
            predicted_home_score: 2,
            predicted_away_score: 0,
          }),
        })
      ).status,
    ).toBe(200)

    expect(
      (
        await apiRequest(db, ana, '/predictions', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: 'm-r16-leg2',
            predicted_home_score: 1,
            predicted_away_score: 0,
          }),
        })
      ).status,
    ).toBe(200)

    // Beto prevê empate 1x1 na ida e vitória do Palmeiras por 2x0 na volta, com agregado de 3x1 para o Palmeiras como mandante na volta
    expect(
      (
        await apiRequest(db, beto, '/predictions/bulk', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            predictions: [
              {
                match_id: 'm-r16-leg1',
                predicted_home_score: 1,
                predicted_away_score: 1,
                predicted_penalty_winner: 'home',
              },
              {
                match_id: 'm-r16-leg2',
                predicted_home_score: 2,
                predicted_away_score: 0,
              },
            ],
          }),
        })
      ).status,
    ).toBe(200)

    // Jogo de ida termina Flamengo 2x0 Palmeiras enquanto o jogo de volta ainda não aconteceu
    sqlite
      .prepare(
        `UPDATE matches
         SET status = 'finished', home_score = 2, away_score = 0, locked_at = '2026-08-10T22:00:00Z'
         WHERE id = 'm-r16-leg1'`,
      )
      .run()
    await scoreUnprocessedMatches(COMP_ID, db)

    // Antes do jogo decisivo, o ranking tem apenas os 3 pontos do placar exato da partida de ida para Ana
    const membersAfterLeg1 = await apiRequest(db, ana, `/groups/${group.id}/members`)
    const { members: rankingLeg1 } = (await membersAfterLeg1.json()) as {
      members: Array<{ user_id: string; total_points: number }>
    }
    expect(rankingLeg1.find((m) => m.user_id === 'u-ana')?.total_points).toBe(3)
    expect(rankingLeg1.find((m) => m.user_id === 'u-beto')?.total_points).toBe(0)

    // Jogo de volta termina Palmeiras 1x0 Flamengo e fecha o agregado em 2x1 para o Flamengo
    sqlite
      .prepare(
        `UPDATE matches
         SET status = 'finished', home_score = 1, away_score = 0, locked_at = '2026-08-17T22:00:00Z'
         WHERE id = 'm-r16-leg2'`,
      )
      .run()
    await scoreUnprocessedMatches(COMP_ID, db)

    // Ana soma 3 da ida, 3 do placar exato da volta e 2 de classificado, totalizando 8 pontos
    // Beto soma 0 da ida, 1 do vencedor da volta e 0 de classificado, totalizando 1 ponto
    const membersAfterLeg2 = await apiRequest(db, ana, `/groups/${group.id}/members`)
    const { members: rankingLeg2 } = (await membersAfterLeg2.json()) as {
      members: Array<{ user_id: string; total_points: number }>
    }
    expect(rankingLeg2.find((m) => m.user_id === 'u-ana')?.total_points).toBe(8)
    expect(rankingLeg2.find((m) => m.user_id === 'u-beto')?.total_points).toBe(1)

    // Confere que predicted_classified e classified_points aparecem nas três rotas de listagem de palpites
    const ownPredsRes = await apiRequest(db, ana, `/predictions?group_id=${group.id}`)
    const { predictions: ownPreds } = (await ownPredsRes.json()) as {
      predictions: Array<{
        match_id: string
        classified_points: number
        predicted_classified: 'home' | 'away' | null
      }>
    }
    expect(ownPreds.find((p) => p.match_id === 'm-r16-leg1')).toMatchObject({
      classified_points: 0,
      predicted_classified: null,
    })
    expect(ownPreds.find((p) => p.match_id === 'm-r16-leg2')).toMatchObject({
      classified_points: 2,
      predicted_classified: 'away',
    })

    const userPredsRes = await apiRequest(
      db,
      beto,
      `/predictions/user?group_id=${group.id}&user_id=u-ana`,
    )
    const { predictions: userPreds } = (await userPredsRes.json()) as {
      predictions: Array<{
        match_id: string
        classified_points: number | null
        predicted_classified: 'home' | 'away' | null
      }>
    }
    expect(userPreds.find((p) => p.match_id === 'm-r16-leg2')).toMatchObject({
      classified_points: 2,
      predicted_classified: 'away',
    })

    const groupPredsRes = await apiRequest(db, ana, `/predictions/group?group_id=${group.id}`)
    const { predictions: groupPreds } = (await groupPredsRes.json()) as {
      predictions: Array<{
        match_id: string
        user_id: string
        classified_points: number
        predicted_classified: 'home' | 'away' | null
      }>
    }
    expect(
      groupPreds.find((p) => p.match_id === 'm-r16-leg2' && p.user_id === 'u-ana'),
    ).toMatchObject({
      classified_points: 2,
      predicted_classified: 'away',
    })
    expect(
      groupPreds.find((p) => p.match_id === 'm-r16-leg2' && p.user_id === 'u-beto'),
    ).toMatchObject({
      classified_points: 0,
      predicted_classified: 'home',
    })
  })

  it('usa o vencedor de pênaltis previsto no jogo decisivo quando o agregado empata, inclusive sem empate no tempo normal da volta', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedKnockoutFixtures(sqlite)

    const group = await createConfiguredGroup(db, 3)
    const ana = { id: 'u-ana', email: 'ana@palpitae.com' }
    const beto = { id: 'u-beto', email: 'beto@palpitae.com' }

    // Na ida, Ana palpita Botafogo 2x0 Fluminense
    expect(
      (
        await apiRequest(db, ana, '/predictions', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: 'm-qf-leg1',
            predicted_home_score: 2,
            predicted_away_score: 0,
          }),
        })
      ).status,
    ).toBe(200)

    // Na volta entre Fluminense e Botafogo, palpitar 2x0 para o Fluminense empata o agregado em 2x2.
    // Sem predicted_penalty_winner a API aceita e grava o pick nulo: o palpite só não pontua o classificado.
    expect(
      (
        await apiRequest(db, ana, '/predictions', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: 'm-qf-leg2',
            predicted_home_score: 2,
            predicted_away_score: 0,
          }),
        })
      ).status,
    ).toBe(200)
    expect(storedPick(sqlite, 'u-ana', 'm-qf-leg2')).toBeNull()

    // Com predicted_penalty_winner definido como home para o Fluminense avançar nos pênaltis, o palpite é aceito
    expect(
      (
        await apiRequest(db, ana, '/predictions', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            match_id: 'm-qf-leg2',
            predicted_home_score: 2,
            predicted_away_score: 0,
            predicted_penalty_winner: 'home',
          }),
        })
      ).status,
    ).toBe(200)

    // Beto também prevê empate no agregado de 2x2 mas escolhe away nos pênaltis
    expect(
      (
        await apiRequest(db, beto, '/predictions/bulk', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            predictions: [
              { match_id: 'm-qf-leg1', predicted_home_score: 1, predicted_away_score: 0 },
              {
                match_id: 'm-qf-leg2',
                predicted_home_score: 2,
                predicted_away_score: 1,
                predicted_penalty_winner: 'away',
              },
            ],
          }),
        })
      ).status,
    ).toBe(200)

    // Resultados reais com Botafogo 2x0 na ida, Fluminense 2x0 na volta e vitória do Fluminense nos pênaltis
    sqlite
      .prepare(
        `UPDATE matches
         SET status = 'finished', home_score = 2, away_score = 0, locked_at = '2026-09-01T22:00:00Z'
         WHERE id = 'm-qf-leg1'`,
      )
      .run()
    sqlite
      .prepare(
        `UPDATE matches
         SET status = 'finished', home_score = 2, away_score = 0, penalty_winner = 'home', locked_at = '2026-09-08T22:00:00Z'
         WHERE id = 'm-qf-leg2'`,
      )
      .run()

    await scoreUnprocessedMatches(COMP_ID, db)

    const anaPredsRes = await apiRequest(db, ana, `/predictions?group_id=${group.id}`)
    const { predictions: anaPreds } = (await anaPredsRes.json()) as {
      predictions: Array<{
        match_id: string
        classified_points: number
        predicted_classified: 'home' | 'away' | null
      }>
    }
    expect(anaPreds.find((p) => p.match_id === 'm-qf-leg2')).toMatchObject({
      classified_points: 3,
      predicted_classified: 'home',
    })

    const betoPredsRes = await apiRequest(db, beto, `/predictions?group_id=${group.id}`)
    const { predictions: betoPreds } = (await betoPredsRes.json()) as {
      predictions: Array<{
        match_id: string
        classified_points: number
        predicted_classified: 'home' | 'away' | null
      }>
    }
    expect(betoPreds.find((p) => p.match_id === 'm-qf-leg2')).toMatchObject({
      classified_points: 0,
      predicted_classified: 'away',
    })
  })

  it('aplica a mesma regra de classificado em jogo único e final tanto no tempo normal quanto nos pênaltis', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedKnockoutFixtures(sqlite)

    const group = await createConfiguredGroup(db, 2)
    const ana = { id: 'u-ana', email: 'ana@palpitae.com' }
    const beto = { id: 'u-beto', email: 'beto@palpitae.com' }

    // Semifinal em jogo único entre Flamengo e Botafogo e Final em jogo único entre Flamengo e Fluminense
    expect(
      (
        await apiRequest(db, ana, '/predictions/bulk', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            predictions: [
              { match_id: 'm-semi-single', predicted_home_score: 2, predicted_away_score: 1 },
              {
                match_id: 'm-final-single',
                predicted_home_score: 1,
                predicted_away_score: 1,
                predicted_penalty_winner: 'away',
              },
            ],
          }),
        })
      ).status,
    ).toBe(200)

    expect(
      (
        await apiRequest(db, beto, '/predictions/bulk', {
          method: 'PUT',
          body: JSON.stringify({
            group_id: group.id,
            predictions: [
              { match_id: 'm-semi-single', predicted_home_score: 0, predicted_away_score: 1 },
              {
                match_id: 'm-final-single',
                predicted_home_score: 0,
                predicted_away_score: 0,
                predicted_penalty_winner: 'home',
              },
            ],
          }),
        })
      ).status,
    ).toBe(200)

    // Semifinal termina 1x0 para o mandante e Final termina 1x1 com visitante campeão nos pênaltis
    sqlite
      .prepare(
        `UPDATE matches
         SET status = 'finished', home_score = 1, away_score = 0, locked_at = '2099-10-01T22:00:00Z'
         WHERE id = 'm-semi-single'`,
      )
      .run()
    sqlite
      .prepare(
        `UPDATE matches
         SET status = 'finished', home_score = 1, away_score = 1, penalty_winner = 'away', locked_at = '2099-11-01T22:00:00Z'
         WHERE id = 'm-final-single'`,
      )
      .run()

    await scoreUnprocessedMatches(COMP_ID, db)

    const anaPredsRes = await apiRequest(db, ana, `/predictions?group_id=${group.id}`)
    const { predictions: anaPreds } = (await anaPredsRes.json()) as {
      predictions: Array<{
        match_id: string
        points_awarded: number
        penalty_points: number
        classified_points: number
        predicted_classified: 'home' | 'away' | null
      }>
    }
    expect(anaPreds.find((p) => p.match_id === 'm-semi-single')).toMatchObject({
      points_awarded: 1,
      penalty_points: 0,
      classified_points: 2,
      predicted_classified: 'home',
    })
    expect(anaPreds.find((p) => p.match_id === 'm-final-single')).toMatchObject({
      points_awarded: 3,
      penalty_points: 1,
      classified_points: 2,
      predicted_classified: 'away',
    })

    const betoPredsRes = await apiRequest(db, beto, `/predictions?group_id=${group.id}`)
    const { predictions: betoPreds } = (await betoPredsRes.json()) as {
      predictions: Array<{ match_id: string; classified_points: number }>
    }
    expect(betoPreds.find((p) => p.match_id === 'm-semi-single')?.classified_points).toBe(0)
    expect(betoPreds.find((p) => p.match_id === 'm-final-single')?.classified_points).toBe(0)
  })

  it('não concede ponto de classificado quando falta palpite em um dos jogos do confronto', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedKnockoutFixtures(sqlite)

    const group = await createConfiguredGroup(db, 3)
    const ana = { id: 'u-ana', email: 'ana@palpitae.com' }
    const beto = { id: 'u-beto', email: 'beto@palpitae.com' }
    const caio = { id: 'u-caio', email: 'caio@palpitae.com' }

    // Ana palpita apenas no jogo de ida
    await apiRequest(db, ana, '/predictions', {
      method: 'PUT',
      body: JSON.stringify({
        group_id: group.id,
        match_id: 'm-r16-leg1',
        predicted_home_score: 3,
        predicted_away_score: 0,
      }),
    })

    // Beto palpita apenas no jogo de volta
    await apiRequest(db, beto, '/predictions', {
      method: 'PUT',
      body: JSON.stringify({
        group_id: group.id,
        match_id: 'm-r16-leg2',
        predicted_home_score: 0,
        predicted_away_score: 2,
      }),
    })

    // Caio palpita nos dois jogos do confronto
    await apiRequest(db, caio, '/predictions/bulk', {
      method: 'PUT',
      body: JSON.stringify({
        group_id: group.id,
        predictions: [
          { match_id: 'm-r16-leg1', predicted_home_score: 1, predicted_away_score: 0 },
          { match_id: 'm-r16-leg2', predicted_home_score: 0, predicted_away_score: 1 },
        ],
      }),
    })

    sqlite
      .prepare(
        `UPDATE matches
         SET status = 'finished', home_score = 1, away_score = 0, locked_at = '2026-08-10T22:00:00Z'
         WHERE id = 'm-r16-leg1'`,
      )
      .run()
    sqlite
      .prepare(
        `UPDATE matches
         SET status = 'finished', home_score = 0, away_score = 1, locked_at = '2026-08-17T22:00:00Z'
         WHERE id = 'm-r16-leg2'`,
      )
      .run()

    await scoreUnprocessedMatches(COMP_ID, db)

    const betoPredsRes = await apiRequest(db, beto, `/predictions?group_id=${group.id}`)
    const { predictions: betoPreds } = (await betoPredsRes.json()) as {
      predictions: Array<{
        match_id: string
        points_awarded: number
        classified_points: number
        predicted_classified: 'home' | 'away' | null
      }>
    }
    // Beto acertou o vencedor da volta mas não tem palpite na ida, ficando com predicted_classified nulo e zero pontos de classificado
    expect(betoPreds.find((p) => p.match_id === 'm-r16-leg2')).toMatchObject({
      points_awarded: 1,
      classified_points: 0,
      predicted_classified: null,
    })

    const caioPredsRes = await apiRequest(db, caio, `/predictions?group_id=${group.id}`)
    const { predictions: caioPreds } = (await caioPredsRes.json()) as {
      predictions: Array<{
        match_id: string
        classified_points: number
        predicted_classified: 'home' | 'away' | null
      }>
    }
    expect(caioPreds.find((p) => p.match_id === 'm-r16-leg2')).toMatchObject({
      classified_points: 3,
      predicted_classified: 'away',
    })

    const membersRes = await apiRequest(db, ana, `/groups/${group.id}/members`)
    const { members } = (await membersRes.json()) as {
      members: Array<{ user_id: string; total_points: number }>
    }
    expect(members.find((m) => m.user_id === 'u-ana')?.total_points).toBe(1)
    expect(members.find((m) => m.user_id === 'u-beto')?.total_points).toBe(1)
    expect(members.find((m) => m.user_id === 'u-caio')?.total_points).toBe(9)
  })

  it('não deriva leg do matchday no sync da football-data, nem em ida e volta nem em jogo único', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)

    const fdMatch = (
      id: number,
      utcDate: string,
      stage: string,
      homeId: number,
      awayId: number,
    ) => ({
      id,
      utcDate,
      status: 'SCHEDULED',
      matchday: 1,
      stage,
      group: null,
      homeTeam: {
        id: homeId,
        name: `Time ${homeId}`,
        shortName: `T${homeId}`,
        tla: `T${homeId}`,
        crest: '',
      },
      awayTeam: {
        id: awayId,
        name: `Time ${awayId}`,
        shortName: `T${awayId}`,
        tla: `T${awayId}`,
        crest: '',
      },
      score: {
        winner: null,
        duration: 'REGULAR',
        fullTime: { home: null, away: null },
        halfTime: { home: null, away: null },
      },
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            competition: { id: 2001, name: 'UEFA Champions League', code: 'CL' },
            matches: [
              // Ida e volta das quartas: a football-data manda matchday 1 e 2, mas o leg não vem do matchday.
              { ...fdMatch(9001, '2026-04-08T19:00:00Z', 'QUARTER_FINALS', 1, 2), matchday: 1 },
              { ...fdMatch(9002, '2026-04-15T19:00:00Z', 'QUARTER_FINALS', 2, 1), matchday: 2 },
              // Jogo único de mata-mata com matchday 1, como a rodada de 32 da Copa do Mundo.
              fdMatch(9003, '2026-06-28T19:00:00Z', 'LAST_32', 3, 4),
              fdMatch(9004, '2026-05-30T19:00:00Z', 'FINAL', 1, 2),
            ],
          }
        },
        async text() {
          return ''
        },
      })),
    )

    await syncFixtures({ competitionCode: 'CL', season: 2026, apiKey: 'k', db })

    const rows = sqlite
      .prepare('SELECT external_id, phase, leg FROM matches ORDER BY external_id ASC')
      .all() as Array<{ external_id: string; phase: string; leg: number | null }>

    expect(rows).toEqual([
      { external_id: '9001', phase: 'QUARTER_FINALS', leg: null },
      { external_id: '9002', phase: 'QUARTER_FINALS', leg: null },
      { external_id: '9003', phase: 'LAST_32', leg: null },
      { external_id: '9004', phase: 'FINAL', leg: null },
    ])
  })

  it('mapeia leg a partir de comp.leg.value no sync da ESPN', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)

    const espnEvent = (
      id: string,
      date: string,
      leg: number | null,
      homeId: string,
      awayId: string,
    ) => ({
      id,
      date,
      season: { year: 2026, slug: 'round-of-16' },
      competitions: [
        {
          date,
          ...(leg === null ? {} : { leg: { value: leg } }),
          status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
          competitors: [
            { homeAway: 'home', score: '0', team: { id: homeId, displayName: `Time ${homeId}` } },
            { homeAway: 'away', score: '0', team: { id: awayId, displayName: `Time ${awayId}` } },
          ],
        },
      ],
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes('/conmebol.libertadores/scoreboard')) {
          return new Response(
            JSON.stringify({
              events: [
                espnEvent('ev-ida', '2099-08-12T22:00Z', 1, 'e1', 'e2'),
                espnEvent('ev-volta', '2099-08-19T22:00Z', 2, 'e2', 'e1'),
                espnEvent('ev-sem-leg', '2099-08-20T22:00Z', null, 'e3', 'e4'),
                espnEvent('ev-leg-invalido', '2099-08-21T22:00Z', 3, 'e5', 'e6'),
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('Not found', { status: 404 })
      }),
    )

    await syncFixtures({ competitionCode: 'conmebol.libertadores', season: 2026, apiKey: '', db })

    const rows = sqlite
      .prepare(`SELECT external_id, leg FROM matches WHERE provider = 'espn' ORDER BY external_id`)
      .all()
    expect(rows).toEqual([
      { external_id: 'ev-ida', leg: 1 },
      { external_id: 'ev-leg-invalido', leg: null },
      { external_id: 'ev-sem-leg', leg: null },
      { external_id: 'ev-volta', leg: 2 },
    ])
  })
})

describe('regras do vencedor de pênaltis no palpite de mata-mata', () => {
  it('aceita a volta com agregado empatado sem pick, não exige pick na ida e exige no jogo único empatado', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedKnockoutFixtures(sqlite)
    const group = await createConfiguredGroup(db, 2)

    // Ida empatada em fase com pênaltis: aceita sem pick e grava null mesmo se vier um pick.
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg1', 1, 1)).status).toBe(200)
    expect(storedPick(sqlite, 'u-ana', 'm-r16-leg1')).toBeNull()
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg1', 1, 1, 'home')).status).toBe(200)
    expect(storedPick(sqlite, 'u-ana', 'm-r16-leg1')).toBeNull()

    // A ida passa a Flamengo 1x0. Volta empatada numa fase com pênaltis continua exigindo o pick.
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg1', 1, 0)).status).toBe(200)
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg2', 2, 2)).status).toBe(400)
    // Volta 2x0 não empata o agregado (2x1): pick enviado é descartado.
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg2', 2, 0, 'home')).status).toBe(200)
    expect(storedPick(sqlite, 'u-ana', 'm-r16-leg2')).toBeNull()

    // Volta 1x0 empata o agregado em 1x1 sem empatar o jogo: sem pick a API aceita e grava null,
    // pick válido é gravado e valor inválido vira null.
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg2', 1, 0)).status).toBe(200)
    expect(storedPick(sqlite, 'u-ana', 'm-r16-leg2')).toBeNull()
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg2', 1, 0, 'away')).status).toBe(200)
    expect(storedPick(sqlite, 'u-ana', 'm-r16-leg2')).toBe('away')
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg2', 1, 0, 'foo')).status).toBe(200)
    expect(storedPick(sqlite, 'u-ana', 'm-r16-leg2')).toBeNull()

    // Jogo único empatado numa fase decidida nos pênaltis continua exigindo o pick.
    expect((await putPrediction(db, ANA, group.id, 'm-final-single', 0, 0)).status).toBe(400)
    expect((await putPrediction(db, ANA, group.id, 'm-final-single', 0, 0, 'foo')).status).toBe(400)
    const bulkRes = await apiRequest(db, BETO, '/predictions/bulk', {
      method: 'PUT',
      body: JSON.stringify({
        group_id: group.id,
        predictions: [
          { match_id: 'm-r16-leg1', predicted_home_score: 0, predicted_away_score: 0 },
          { match_id: 'm-r16-leg2', predicted_home_score: 1, predicted_away_score: 1 },
          { match_id: 'm-final-single', predicted_home_score: 1, predicted_away_score: 1 },
        ],
      }),
    })
    expect(bulkRes.status).toBe(400)
    const bulkBody = (await bulkRes.json()) as { invalid_penalty: string[] }
    expect(bulkBody.invalid_penalty.sort()).toEqual(['m-final-single', 'm-r16-leg2'])
  })

  it('na volta do bulk ignora a ida travada do payload e usa a ida gravada no banco', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedKnockoutFixtures(sqlite)
    const group = await createConfiguredGroup(db, 2)

    // Ida gravada: Flamengo 2x0. Depois a ida trava.
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg1', 2, 0)).status).toBe(200)
    sqlite
      .prepare(`UPDATE matches SET locked_at = '2026-08-10T22:00:00Z' WHERE id = 'm-r16-leg1'`)
      .run()

    // Com a ida do payload (1x0) a volta 1x0 empataria o agregado; com a ida gravada (2x0) não empata.
    const res = await apiRequest(db, ANA, '/predictions/bulk', {
      method: 'PUT',
      body: JSON.stringify({
        group_id: group.id,
        predictions: [
          { match_id: 'm-r16-leg1', predicted_home_score: 1, predicted_away_score: 0 },
          {
            match_id: 'm-r16-leg2',
            predicted_home_score: 1,
            predicted_away_score: 0,
            predicted_penalty_winner: 'home',
          },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { saved: string[]; locked: string[] }
    expect(body.locked).toEqual(['m-r16-leg1'])
    expect(body.saved).toEqual(['m-r16-leg2'])
    expect(storedPick(sqlite, 'u-ana', 'm-r16-leg2')).toBeNull()

    // Ida destravada no mesmo payload vale como base: o agregado empata e o pick é gravado.
    sqlite.prepare(`UPDATE matches SET locked_at = NULL WHERE id = 'm-r16-leg1'`).run()
    const unlockedRes = await apiRequest(db, ANA, '/predictions/bulk', {
      method: 'PUT',
      body: JSON.stringify({
        group_id: group.id,
        predictions: [
          { match_id: 'm-r16-leg1', predicted_home_score: 1, predicted_away_score: 0 },
          {
            match_id: 'm-r16-leg2',
            predicted_home_score: 1,
            predicted_away_score: 0,
            predicted_penalty_winner: 'home',
          },
        ],
      }),
    })
    expect(unlockedRes.status).toBe(200)
    expect(storedPick(sqlite, 'u-ana', 'm-r16-leg2')).toBe('home')
  })
})

describe('pontuação de classificado com ordem de palpites, leg nulo e correções', () => {
  it('volta salva antes da ida sem pick, com agregado empatado, não pontua o classificado', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedKnockoutFixtures(sqlite)
    const group = await createConfiguredGroup(db, 2)

    // Volta primeiro (sem ida, nada a validar), depois a ida que deixa o agregado em 1x1.
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg2', 1, 0)).status).toBe(200)
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg1', 1, 0)).status).toBe(200)

    finishMatch(sqlite, 'm-r16-leg1', 1, 0)
    finishMatch(sqlite, 'm-r16-leg2', 1, 0, 'home')
    await scoreUnprocessedMatches(COMP_ID, db)

    expect(await ownPrediction(db, ANA, group.id, 'm-r16-leg2')).toMatchObject({
      points_awarded: 3,
      classified_points: 0,
      predicted_classified: null,
    })
  })

  it('ida editada depois da volta muda o agregado e a pontuação usa os valores atuais', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedKnockoutFixtures(sqlite)
    const group = await createConfiguredGroup(db, 2)

    // Primeiro a ida 0x2 e a volta 1x0: agregado 3x0 para o Palmeiras (mandante da volta).
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg1', 0, 2)).status).toBe(200)
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg2', 1, 0)).status).toBe(200)
    // A ida passa a 3x0: agregado 3x1 para o Flamengo (visitante da volta).
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg1', 3, 0)).status).toBe(200)

    finishMatch(sqlite, 'm-r16-leg1', 2, 0)
    finishMatch(sqlite, 'm-r16-leg2', 1, 0)
    await scoreUnprocessedMatches(COMP_ID, db)

    expect(await ownPrediction(db, ANA, group.id, 'm-r16-leg2')).toMatchObject({
      classified_points: 2,
      predicted_classified: 'away',
    })
  })

  it('trata como ida e volta um par com leg nulo nos dois jogos e como jogo único o mata-mata sem par', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedKnockoutFixtures(sqlite)
    sqlite.exec(`UPDATE matches SET leg = NULL`)
    const group = await createConfiguredGroup(db, 2)

    // Par das oitavas sem leg: a ida é o jogo de start_time anterior.
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg1', 2, 0)).status).toBe(200)
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg2', 1, 0)).status).toBe(200)
    // Ida empatada sem pick é aceita: o par sem leg já identifica a ida.
    expect((await putPrediction(db, BETO, group.id, 'm-r16-leg1', 1, 1)).status).toBe(200)
    // Semifinal de jogo único, sem par: pontua pelo próprio placar.
    expect((await putPrediction(db, ANA, group.id, 'm-semi-single', 0, 1)).status).toBe(200)

    finishMatch(sqlite, 'm-r16-leg1', 2, 0)
    finishMatch(sqlite, 'm-r16-leg2', 1, 0)
    finishMatch(sqlite, 'm-semi-single', 0, 2)
    await scoreUnprocessedMatches(COMP_ID, db)

    expect(await ownPrediction(db, ANA, group.id, 'm-r16-leg1')).toMatchObject({
      classified_points: 0,
      predicted_classified: null,
    })
    expect(await ownPrediction(db, ANA, group.id, 'm-r16-leg2')).toMatchObject({
      classified_points: 2,
      predicted_classified: 'away',
    })
    expect(await ownPrediction(db, ANA, group.id, 'm-semi-single')).toMatchObject({
      points_awarded: 1,
      classified_points: 2,
      predicted_classified: 'away',
    })
  })

  it('credita classificado em ida e volta da Liga dos Campeões, cuja única fase de pênaltis é a final', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    const CL_ID = '20010000-0000-4000-8000-000000002026'
    sqlite.exec(`
      INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
        ('u-ana', 'ana@palpitae.com', 'google', 'g-ana', 'Ana');
      INSERT INTO teams (id, name, short_name, slug, external_id, provider) VALUES
        ('t-ars', 'Arsenal', 'ARS', 'arsenal', '57', 'football-data'),
        ('t-bay', 'Bayern', 'BAY', 'bayern', '5', 'football-data');
      INSERT INTO matches (
        id, competition_id, external_id, provider,
        home_team_id, away_team_id, start_time, status, phase, round, leg
      ) VALUES
        ('m-cl-1', '${CL_ID}', 'cl-1', 'football-data', 't-ars', 't-bay', '2099-03-10T20:00:00Z', 'scheduled', 'LAST_16', 'LAST_16', NULL),
        ('m-cl-2', '${CL_ID}', 'cl-2', 'football-data', 't-bay', 't-ars', '2099-03-17T20:00:00Z', 'scheduled', 'LAST_16', 'LAST_16', NULL);
    `)
    expect(
      sqlite.prepare(`SELECT penalty_phases FROM competitions WHERE id = ?`).get(CL_ID),
    ).toEqual({ penalty_phases: '["FINAL"]' })

    const createRes = await apiRequest(db, ANA, '/groups', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bolão Champions',
        competition_id: CL_ID,
        points_classified: 3,
      }),
    })
    expect(createRes.status).toBe(201)
    const { group } = (await createRes.json()) as { group: { id: string } }

    // Agregado previsto 2x2 decidido pelo pick do Arsenal (visitante da volta), fora de penalty_phases.
    expect((await putPrediction(db, ANA, group.id, 'm-cl-1', 1, 1)).status).toBe(200)
    expect((await putPrediction(db, ANA, group.id, 'm-cl-2', 1, 1, 'away')).status).toBe(200)
    expect(storedPick(sqlite, 'u-ana', 'm-cl-2')).toBe('away')

    finishMatch(sqlite, 'm-cl-1', 1, 1, null, CL_ID)
    finishMatch(sqlite, 'm-cl-2', 1, 1, 'away', CL_ID)
    await scoreUnprocessedMatches(CL_ID, db)

    expect(await ownPrediction(db, ANA, group.id, 'm-cl-2')).toMatchObject({
      points_awarded: 3,
      penalty_points: 0,
      classified_points: 3,
      predicted_classified: 'away',
    })
  })

  it('repontua a volta quando o placar da ida é corrigido, sem duplicar pontos no ranking', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedKnockoutFixtures(sqlite)
    const group = await createConfiguredGroup(db, 2)

    // Ana prevê 2x0 na ida e 1x0 na volta: Flamengo (visitante da volta) avança por 2x1.
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg1', 2, 0)).status).toBe(200)
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg2', 1, 0)).status).toBe(200)

    // Placar errado da ida (0x0) faz o Palmeiras avançar no agregado.
    finishMatch(sqlite, 'm-r16-leg1', 0, 0)
    finishMatch(sqlite, 'm-r16-leg2', 1, 0)
    await scoreUnprocessedMatches(COMP_ID, db)
    expect(await ownPrediction(db, ANA, group.id, 'm-r16-leg2')).toMatchObject({
      classified_points: 0,
    })
    expect(await totalPoints(db, group.id, 'u-ana')).toBe(3)

    // O provider corrige a ida para 2x0; o upsert do sync zera o scored_at só da ida.
    sqlite
      .prepare(
        `UPDATE matches SET home_score = 2, away_score = 0, scored_at = NULL WHERE id = 'm-r16-leg1'`,
      )
      .run()
    await scoreUnprocessedMatches(COMP_ID, db)

    expect(await ownPrediction(db, ANA, group.id, 'm-r16-leg2')).toMatchObject({
      points_awarded: 3,
      classified_points: 2,
    })
    // 3 da ida exata + 3 da volta exata + 2 de classificado.
    expect(await totalPoints(db, group.id, 'u-ana')).toBe(8)

    // Rodar de novo não muda nada.
    await scoreUnprocessedMatches(COMP_ID, db)
    expect(await totalPoints(db, group.id, 'u-ana')).toBe(8)
  })

  it('em /predictions/user só usa a ida de outro usuário quando ela já travou', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedKnockoutFixtures(sqlite)
    const group = await createConfiguredGroup(db, 2)

    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg1', 2, 0)).status).toBe(200)
    expect((await putPrediction(db, ANA, group.id, 'm-r16-leg2', 1, 0)).status).toBe(200)

    // Só a volta travou (dado atípico, mas possível com adiamento da ida).
    sqlite
      .prepare(`UPDATE matches SET locked_at = '2026-08-17T22:00:00Z' WHERE id = 'm-r16-leg2'`)
      .run()

    const asBeto = await apiRequest(
      db,
      BETO,
      `/predictions/user?group_id=${group.id}&user_id=u-ana`,
    )
    const { predictions: seenByBeto } = (await asBeto.json()) as {
      predictions: Array<{
        match_id: string
        predicted_home_score: number | null
        predicted_classified: string | null
      }>
    }
    expect(seenByBeto.find((p) => p.match_id === 'm-r16-leg1')?.predicted_home_score).toBeNull()
    expect(seenByBeto.find((p) => p.match_id === 'm-r16-leg2')).toMatchObject({
      predicted_home_score: 1,
      predicted_classified: null,
    })

    expect(await ownPrediction(db, ANA, group.id, 'm-r16-leg2')).toMatchObject({
      predicted_classified: 'away',
    })
  })
})
