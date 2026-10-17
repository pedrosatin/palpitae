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

    // Na volta entre Fluminense e Botafogo, palpitar 2x0 para o Fluminense empata o agregado em 2x2
    // Sem predicted_penalty_winner, a API deve rejeitar com 400 mesmo que 2x0 não seja empate isolado
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
    ).toBe(400)

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

  it('mapeia leg 1 e 2 no sync da football-data em mata-mata de ida e volta e mantém null na final', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            competition: { id: 2001, name: 'UEFA Champions League', code: 'CL' },
            matches: [
              {
                id: 9001,
                utcDate: '2026-04-08T19:00:00Z',
                status: 'SCHEDULED',
                matchday: 1,
                stage: 'QUARTER_FINALS',
                group: null,
                homeTeam: { id: 1, name: 'Arsenal FC', shortName: 'Arsenal', tla: 'ARS', crest: '' },
                awayTeam: { id: 2, name: 'FC Bayern München', shortName: 'Bayern', tla: 'BAY', crest: '' },
                score: { winner: null, duration: 'REGULAR', fullTime: { home: null, away: null }, halfTime: { home: null, away: null } },
              },
              {
                id: 9002,
                utcDate: '2026-04-15T19:00:00Z',
                status: 'SCHEDULED',
                matchday: 2,
                stage: 'QUARTER_FINALS',
                group: null,
                homeTeam: { id: 2, name: 'FC Bayern München', shortName: 'Bayern', tla: 'BAY', crest: '' },
                awayTeam: { id: 1, name: 'Arsenal FC', shortName: 'Arsenal', tla: 'ARS', crest: '' },
                score: { winner: null, duration: 'REGULAR', fullTime: { home: null, away: null }, halfTime: { home: null, away: null } },
              },
              {
                id: 9003,
                utcDate: '2026-05-30T19:00:00Z',
                status: 'SCHEDULED',
                matchday: 1,
                stage: 'FINAL',
                group: null,
                homeTeam: { id: 1, name: 'Arsenal FC', shortName: 'Arsenal', tla: 'ARS', crest: '' },
                awayTeam: { id: 2, name: 'FC Bayern München', shortName: 'Bayern', tla: 'BAY', crest: '' },
                score: { winner: null, duration: 'REGULAR', fullTime: { home: null, away: null }, halfTime: { home: null, away: null } },
              },
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
      { external_id: '9001', phase: 'QUARTER_FINALS', leg: 1 },
      { external_id: '9002', phase: 'QUARTER_FINALS', leg: 2 },
      { external_id: '9003', phase: 'FINAL', leg: null },
    ])
  })
})
