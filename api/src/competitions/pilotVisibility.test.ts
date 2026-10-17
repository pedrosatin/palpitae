/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { scoreUnprocessedMatches } from '../matches/scoring'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

async function createPilotFixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)

  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
      ('admin', 'admin@palpitae.com.br', 'google', 'g-admin', 'Admin'),
      ('guest', 'convidado@example.com', 'google', 'g-guest', 'Convidado'),
      ('ordinary', 'comum@example.com', 'google', 'g-ordinary', 'Comum');

    INSERT INTO profiles (user_id, nickname) VALUES
      ('admin', 'Admin'),
      ('guest', 'Convidado'),
      ('ordinary', 'Comum');

    INSERT INTO competitions (id, name, slug, season, status, penalty_phases, visibility) VALUES
      ('comp-public', 'Brasileirão Série A 2026', 'brasileirao-2026', '2026', 'ongoing', '[]', 'public'),
      ('comp-pilot', 'UEFA Champions League 2025/26', 'champions-league-2025-26', '2025', 'ongoing', '["FINAL"]', 'pilot');

    INSERT INTO teams (id, name, short_name, slug) VALUES
      ('real', 'Real Madrid', 'RMA', 'real-madrid'),
      ('arsenal', 'Arsenal', 'ARS', 'arsenal');

    INSERT INTO matches (
      id, competition_id, external_id, provider,
      home_team_id, away_team_id, start_time, status, round, phase
    ) VALUES
      ('m-pilot-1', 'comp-pilot', 'cl-1', 'football-data', 'real', 'arsenal', '2099-05-01T19:00:00Z', 'scheduled', '1', 'QUARTER_FINALS'),
      ('m-pilot-2', 'comp-pilot', 'cl-2', 'football-data', 'arsenal', 'real', '2099-05-08T19:00:00Z', 'scheduled', '2', 'QUARTER_FINALS');
  `)

  const env: Env = {
    DB: db,
    JWT_SECRET: 'test-pilot-secret',
    ADMIN_EMAIL: 'admin@palpitae.com.br',
    PILOT_EMAILS: 'convidado@example.com, outro@example.com',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    RESEND_API_KEY: 'test-resend',
  }

  const tokens = {
    admin: await signJwt(
      { sub: 'admin', email: 'admin@palpitae.com.br', jti: 'jti-admin' },
      env.JWT_SECRET,
      3600,
    ),
    guest: await signJwt(
      { sub: 'guest', email: 'convidado@example.com', jti: 'jti-guest' },
      env.JWT_SECRET,
      3600,
    ),
    ordinary: await signJwt(
      { sub: 'ordinary', email: 'comum@example.com', jti: 'jti-ordinary' },
      env.JWT_SECRET,
      3600,
    ),
  }

  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext

  function request(path: string, user: keyof typeof tokens, method = 'GET', body?: unknown) {
    return worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        method,
        headers: {
          Cookie: `session=${tokens[user]}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.10',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      ctx,
    )
  }

  function anonymousRequest(path: string) {
    return worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '192.0.2.10' },
      }),
      env,
      ctx,
    )
  }

  return { sqlite, db, env, request, anonymousRequest }
}

describe('visibilidade de piloto no grupo fechado', () => {
  it('mantém competição em pilot invisível e inacessível para usuário comum inclusive por link direto', async () => {
    const { sqlite, request, anonymousRequest } = await createPilotFixture()

    // Admin cria um grupo na competição em modo piloto para gerar código de convite real
    const createdRes = await request('/groups', 'admin', 'POST', {
      name: 'Bolão Piloto',
      competition_id: 'comp-pilot',
    })
    expect(createdRes.status).toBe(201)
    const { group: pilotGroup } = (await createdRes.json()) as {
      group: { id: string; invite_code: string }
    }

    // 1. GET /competitions não lista a competição em pilot para usuário comum
    const compRes = await request('/competitions', 'ordinary')
    expect(compRes.status).toBe(200)
    const compBody = (await compRes.json()) as {
      competitions: Array<{ id: string }>
    }
    expect(compBody.competitions.map((c) => c.id)).toEqual(['comp-public'])

    // 2. POST /groups com competition_id em pilot falha com 404 para usuário comum
    const createAttempt = await request('/groups', 'ordinary', 'POST', {
      name: 'Tentativa Comum',
      competition_id: 'comp-pilot',
    })
    expect(createAttempt.status).toBe(404)

    // 3. GET /public/invites/:code oculta o preview do link direto enquanto a competição está em pilot
    const previewRes = await anonymousRequest(`/public/invites/${pilotGroup.invite_code}`)
    expect(previewRes.status).toBe(404)

    // 4. POST /groups/join recusa entrada por código de convite direto para usuário comum
    const joinAttempt = await request('/groups/join', 'ordinary', 'POST', {
      invite_code: pilotGroup.invite_code,
    })
    expect(joinAttempt.status).toBe(404)

    // 5. GET /matches?competition_id=comp-pilot retorna 404 para usuário comum
    const matchesAttempt = await request('/matches?competition_id=comp-pilot', 'ordinary')
    expect(matchesAttempt.status).toBe(404)

    // Mesmo se o usuário comum tivesse vínculo prévio no banco, as rotas de grupo e palpites continuam bloqueadas
    sqlite
      .prepare(
        "INSERT INTO group_members (id, group_id, user_id, role) VALUES ('gm-ord', ?, 'ordinary', 'member')",
      )
      .run(pilotGroup.id)

    const listGroupsRes = await request('/groups', 'ordinary')
    const listGroupsBody = (await listGroupsRes.json()) as { groups: Array<{ id: string }> }
    expect(listGroupsBody.groups).toEqual([])

    expect((await request(`/groups/${pilotGroup.id}`, 'ordinary')).status).toBe(404)
    expect((await request(`/groups/${pilotGroup.id}/members`, 'ordinary')).status).toBe(404)
    expect((await request(`/predictions?group_id=${pilotGroup.id}`, 'ordinary')).status).toBe(404)
    expect(
      (
        await request('/predictions', 'ordinary', 'PUT', {
          group_id: pilotGroup.id,
          match_id: 'm-pilot-1',
          predicted_home_score: 2,
          predicted_away_score: 1,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request('/predictions/bulk', 'ordinary', 'PUT', {
          group_id: pilotGroup.id,
          predictions: [
            { match_id: 'm-pilot-1', predicted_home_score: 2, predicted_away_score: 1 },
          ],
        })
      ).status,
    ).toBe(404)
  })

  it('permite que admin e convidado vejam a competição em pilot, criem grupo, entrem, palpitem e pontuem', async () => {
    const { sqlite, db, request } = await createPilotFixture()

    // Admin e convidado enxergam a competição em pilot na listagem
    for (const user of ['admin', 'guest'] as const) {
      const res = await request('/competitions', user)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { competitions: Array<{ id: string }> }
      expect(body.competitions.map((c) => c.id)).toContain('comp-pilot')
    }

    // Admin cria o grupo na competição em pilot
    const createRes = await request('/groups', 'admin', 'POST', {
      name: 'Grupo Fechado',
      competition_id: 'comp-pilot',
    })
    expect(createRes.status).toBe(201)
    const { group } = (await createRes.json()) as {
      group: { id: string; invite_code: string }
    }

    // Convidado entra pelo código de convite
    const joinRes = await request('/groups/join', 'guest', 'POST', {
      invite_code: group.invite_code,
    })
    expect(joinRes.status).toBe(200)

    // Convidado lista as partidas da competição em pilot com Cache-Control privado
    const matchesRes = await request('/matches?competition_id=comp-pilot', 'guest')
    expect(matchesRes.status).toBe(200)
    expect(matchesRes.headers.get('Cache-Control')).toBe('private, no-store')
    const matchesBody = (await matchesRes.json()) as { matches: Array<{ id: string }> }
    expect(matchesBody.matches.map((m) => m.id)).toEqual(['m-pilot-1', 'm-pilot-2'])

    // Admin envia palpite individual e convidado envia palpite em lote
    const adminPickRes = await request('/predictions', 'admin', 'PUT', {
      group_id: group.id,
      match_id: 'm-pilot-1',
      predicted_home_score: 2,
      predicted_away_score: 1,
    })
    expect(adminPickRes.status).toBe(200)

    const guestBulkRes = await request('/predictions/bulk', 'guest', 'PUT', {
      group_id: group.id,
      predictions: [
        { match_id: 'm-pilot-1', predicted_home_score: 2, predicted_away_score: 0 },
        { match_id: 'm-pilot-2', predicted_home_score: 1, predicted_away_score: 1 },
      ],
    })
    expect(guestBulkRes.status).toBe(200)

    // Encerra a partida m-pilot-1 por 2x1 e processa a pontuação
    sqlite
      .prepare(
        "UPDATE matches SET status = 'finished', home_score = 2, away_score = 1 WHERE id = 'm-pilot-1'",
      )
      .run()
    await scoreUnprocessedMatches('comp-pilot', db)

    // Verifica o ranking do grupo fechado
    const membersRes = await request(`/groups/${group.id}/members`, 'guest')
    expect(membersRes.status).toBe(200)
    const { members } = (await membersRes.json()) as {
      members: Array<{ user_id: string; total_points: number; exact_hits: number }>
    }
    expect(members).toEqual([
      expect.objectContaining({ user_id: 'admin', total_points: 3, exact_hits: 1 }),
      expect.objectContaining({ user_id: 'guest', total_points: 1, exact_hits: 0 }),
    ])
  })

  it('promove a competição manualmente de pilot para public e libera acesso ao usuário comum', async () => {
    const { request, anonymousRequest } = await createPilotFixture()

    const createRes = await request('/groups', 'admin', 'POST', {
      name: 'Bolão Champions',
      competition_id: 'comp-pilot',
    })
    const { group } = (await createRes.json()) as {
      group: { id: string; invite_code: string }
    }

    // Convidado e usuário comum não podem promover
    expect((await request('/competitions/comp-pilot/promote', 'guest', 'POST')).status).toBe(403)
    expect((await request('/competitions/comp-pilot/promote', 'ordinary', 'POST')).status).toBe(403)

    // Admin promove a competição para public
    const promoteRes = await request('/competitions/comp-pilot/promote', 'admin', 'POST')
    expect(promoteRes.status).toBe(200)
    expect(await promoteRes.json()).toEqual({
      ok: true,
      competition: {
        id: 'comp-pilot',
        slug: 'champions-league-2025-26',
        visibility: 'public',
      },
    })

    // Após a promoção, usuário comum vê a competição, visualiza o preview do convite, entra no grupo e palpita
    const compRes = await request('/competitions', 'ordinary')
    const compBody = (await compRes.json()) as { competitions: Array<{ id: string }> }
    expect(compBody.competitions.map((c) => c.id)).toContain('comp-pilot')

    const previewRes = await anonymousRequest(`/public/invites/${group.invite_code}`)
    expect(previewRes.status).toBe(200)

    const joinRes = await request('/groups/join', 'ordinary', 'POST', {
      invite_code: group.invite_code,
    })
    expect(joinRes.status).toBe(200)

    const matchesRes = await request('/matches?competition_id=comp-pilot', 'ordinary')
    expect(matchesRes.status).toBe(200)

    const pickRes = await request('/predictions', 'ordinary', 'PUT', {
      group_id: group.id,
      match_id: 'm-pilot-1',
      predicted_home_score: 1,
      predicted_away_score: 0,
    })
    expect(pickRes.status).toBe(200)
  })
})
