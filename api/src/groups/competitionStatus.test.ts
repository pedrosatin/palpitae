/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

async function createFixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)

  // comp-done: todos os jogos encerrados, mas a coluna status continua 'upcoming'
  // (é assim em produção). comp-live: ainda tem jogo pendente.
  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
      ('alice', 'alice@example.com', 'google', 'g-alice', 'Alice');

    DELETE FROM competitions;

    INSERT INTO competitions (id, name, slug, season, status, type, penalty_phases, visibility) VALUES
      ('comp-done', 'Copa Encerrada', 'copa-encerrada', '2026', 'upcoming', 'cup', '[]', 'public'),
      ('comp-live', 'Liga Em Andamento', 'liga-andamento', '2026', 'ongoing', 'league', '[]', 'public');

    INSERT INTO teams (id, name, short_name, slug) VALUES
      ('fla', 'Flamengo', 'FLA', 'flamengo'),
      ('pal', 'Palmeiras', 'PAL', 'palmeiras');

    INSERT INTO matches (
      id, competition_id, external_id, provider,
      home_team_id, away_team_id, start_time, status, round, phase, postponed, locked_at
    ) VALUES
      ('m-done-1', 'comp-done', 'x-1', 'football-data', 'fla', 'pal', '2026-06-01T19:00:00Z', 'finished', '1', 'FINAL', 0, NULL),
      ('m-live-1', 'comp-live', 'x-2', 'football-data', 'fla', 'pal', '2026-06-01T19:00:00Z', 'finished', '1', NULL, 0, NULL),
      ('m-live-2', 'comp-live', 'x-3', 'football-data', 'pal', 'fla', '2099-06-01T19:00:00Z', 'scheduled', '2', NULL, 0, NULL);

    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code) VALUES
      ('group-done', 'Bolão Encerrado', 'comp-done', 'alice', 'AAAA-BBBB'),
      ('group-live', 'Bolão Ativo', 'comp-live', 'alice', 'CCCC-DDDD');

    INSERT INTO group_members (group_id, user_id, joined_at) VALUES
      ('group-done', 'alice', '2026-01-01T00:00:00Z'),
      ('group-live', 'alice', '2026-01-01T00:00:00Z');
  `)

  const env: Env = {
    DB: db,
    JWT_SECRET: 'test-competition-status-secret',
    ADMIN_EMAIL: 'admin@palpitae.com.br',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    RESEND_API_KEY: 'test-resend',
  }

  const token = await signJwt(
    { sub: 'alice', email: 'alice@example.com', jti: 'jti-alice' },
    env.JWT_SECRET,
    3600,
  )

  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext

  function request(path: string) {
    return worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        method: 'GET',
        headers: { Cookie: `session=${token}`, 'CF-Connecting-IP': '192.0.2.41' },
      }),
      env,
      ctx,
    )
  }

  return { request }
}

type Status = { competition_status: string | null }

describe('competition_status dos grupos', () => {
  it('GET /groups/:id marca como encerrado o grupo cuja competição não tem jogo pendente', async () => {
    const { request } = await createFixture()

    const done = await request('/groups/group-done')
    expect(done.status).toBe(200)
    expect(((await done.json()) as { group: Status }).group.competition_status).toBe('finished')

    const live = await request('/groups/group-live')
    expect(((await live.json()) as { group: Status }).group.competition_status).toBe('ongoing')
  })

  it('GET /groups e GET /groups/:id concordam no status', async () => {
    const { request } = await createFixture()

    const list = (await (await request('/groups')).json()) as {
      groups: Array<Status & { id: string }>
    }
    const byId = Object.fromEntries(list.groups.map((g) => [g.id, g.competition_status]))
    expect(byId).toEqual({ 'group-done': 'finished', 'group-live': 'ongoing' })
  })
})
