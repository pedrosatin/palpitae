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
  vi.unstubAllGlobals()
})

async function createFixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)

  // Relógio fixo: "agora" = 2026-06-15T12:00:00Z. Rodada 1 já passou; rodada 2
  // é a default_round (MAX(start_time) futuro mais cedo); rodada 3 é futura
  // demais e não entra na contagem da home.
  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
      ('alice', 'alice@example.com', 'google', 'g-alice', 'Alice'),
      ('bob', 'bob@example.com', 'google', 'g-bob', 'Bob'),
      ('carol', 'carol@example.com', 'google', 'g-carol', 'Carol');

    INSERT INTO profiles (user_id, nickname) VALUES
      ('alice', 'Alice'),
      ('bob', 'Bob'),
      ('carol', 'Carol');

    DELETE FROM competitions;

    INSERT INTO competitions (id, name, slug, season, status, type, penalty_phases, visibility) VALUES
      ('comp-a', 'Brasileirão 2026', 'brasileirao-2026', '2026', 'ongoing', 'league', '[]', 'public'),
      ('comp-pilot', 'Champions Pilot', 'cl-pilot', '2025', 'ongoing', 'cup', '["FINAL"]', 'pilot'),
      ('comp-empty', 'Sem Jogos', 'sem-jogos-2026', '2026', 'upcoming', 'league', '[]', 'public');

    INSERT INTO teams (id, name, short_name, slug) VALUES
      ('fla', 'Flamengo', 'FLA', 'flamengo'),
      ('pal', 'Palmeiras', 'PAL', 'palmeiras'),
      ('cor', 'Corinthians', 'COR', 'corinthians'),
      ('sao', 'São Paulo', 'SAO', 'sao-paulo');

    INSERT INTO matches (
      id, competition_id, external_id, provider,
      home_team_id, away_team_id, start_time, status, round, phase, postponed, locked_at
    ) VALUES
      -- Rodada 1: encerrada (não é default_round)
      ('m-r1-1', 'comp-a', 'fd-1', 'football-data', 'fla', 'pal', '2026-06-01T19:00:00Z', 'finished', '1', NULL, 0, '2026-06-01T19:00:00Z'),
      -- Rodada 2: default_round (MAX start futuro). 3 jogos abertos + 1 travado + 1 adiado aberto
      ('m-r2-open-1', 'comp-a', 'fd-2', 'football-data', 'fla', 'cor', '2026-06-20T19:00:00Z', 'scheduled', '2', NULL, 0, NULL),
      ('m-r2-open-2', 'comp-a', 'fd-3', 'football-data', 'pal', 'sao', '2026-06-21T19:00:00Z', 'scheduled', '2', NULL, 0, NULL),
      ('m-r2-open-3', 'comp-a', 'fd-4', 'football-data', 'cor', 'sao', '2026-06-22T19:00:00Z', 'scheduled', '2', NULL, 0, NULL),
      ('m-r2-locked', 'comp-a', 'fd-5', 'football-data', 'sao', 'fla', '2026-06-23T19:00:00Z', 'scheduled', '2', NULL, 0, '2026-06-15T10:00:00Z'),
      ('m-r2-postponed', 'comp-a', 'fd-6', 'football-data', 'pal', 'cor', '2026-06-10T19:00:00Z', 'scheduled', '2', NULL, 1, NULL),
      -- Rodada 3: futura, fora da default_round
      ('m-r3-1', 'comp-a', 'fd-7', 'football-data', 'fla', 'sao', '2026-07-01T19:00:00Z', 'scheduled', '3', NULL, 0, NULL),
      -- Pilot: não vaza para usuário comum
      ('m-pilot-1', 'comp-pilot', 'cl-1', 'football-data', 'fla', 'pal', '2026-06-25T19:00:00Z', 'scheduled', '1', 'QUARTER_FINALS', 0, NULL);

    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code) VALUES
      ('group-a', 'Bolão A', 'comp-a', 'alice', 'AAAA-BBBB'),
      ('group-b', 'Bolão B', 'comp-a', 'bob', 'CCCC-DDDD'),
      ('group-pilot', 'Pilot', 'comp-pilot', 'alice', 'EEEE-FFFF'),
      ('group-empty', 'Vazio', 'comp-empty', 'alice', 'GGGG-HHHH');

    INSERT INTO group_members (group_id, user_id, joined_at) VALUES
      ('group-a', 'alice', '2026-01-01T00:00:00Z'),
      ('group-a', 'bob', '2026-01-02T00:00:00Z'),
      ('group-b', 'bob', '2026-01-01T00:00:00Z'),
      ('group-pilot', 'alice', '2026-01-01T00:00:00Z'),
      ('group-empty', 'alice', '2026-01-01T00:00:00Z');
  `)

  const env: Env = {
    DB: db,
    JWT_SECRET: 'test-pending-secret',
    ADMIN_EMAIL: 'admin@palpitae.com.br',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    RESEND_API_KEY: 'test-resend',
  }

  const tokens = {
    alice: await signJwt(
      { sub: 'alice', email: 'alice@example.com', jti: 'jti-alice' },
      env.JWT_SECRET,
      3600,
    ),
    bob: await signJwt(
      { sub: 'bob', email: 'bob@example.com', jti: 'jti-bob' },
      env.JWT_SECRET,
      3600,
    ),
    carol: await signJwt(
      { sub: 'carol', email: 'carol@example.com', jti: 'jti-carol' },
      env.JWT_SECRET,
      3600,
    ),
  }

  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext

  function request(user: keyof typeof tokens) {
    return worker.fetch(
      new Request('https://api.palpitae.com.br/groups', {
        method: 'GET',
        headers: {
          Cookie: `session=${tokens[user]}`,
          'CF-Connecting-IP': '192.0.2.40',
        },
      }),
      env,
      ctx,
    )
  }

  return { sqlite, request, env }
}

type GroupsBody = {
  groups: Array<{ id: string; pending_predictions: number }>
}

describe('GET /groups pending_predictions (SQLite D1)', () => {
  it('counts only open matches in default_round for the authenticated user', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    try {
      const { request } = await createFixture()
      const res = await request('alice')
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, no-store')

      const body = (await res.json()) as GroupsBody
      const byId = Object.fromEntries(body.groups.map((g) => [g.id, g.pending_predictions]))

      // Alice no group-a: 3 abertos futuros + 1 adiado aberto na rodada 2 = 4.
      // Travado e rodada 3 não entram. Sem palpites ainda.
      expect(byId['group-a']).toBe(4)
      // Grupo sem jogos: 0, sem falso "concluído" no front (só some o hint).
      expect(byId['group-empty']).toBe(0)
      // Pilot some da lista para usuário sem acesso (alice não é admin/pilot).
      expect(byId['group-pilot']).toBeUndefined()
      expect(body.groups.some((g) => g.id === 'group-b')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats a saved 0x0 as filled and isolates predictions per user and group', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    try {
      const { sqlite, request } = await createFixture()

      sqlite.exec(`
        INSERT INTO group_members (group_id, user_id, joined_at) VALUES
          ('group-b', 'alice', '2026-01-03T00:00:00Z');

        INSERT INTO predictions (
          id, group_id, user_id, match_id,
          predicted_home_score, predicted_away_score, created_at, updated_at
        ) VALUES
          ('p-alice-1', 'group-a', 'alice', 'm-r2-open-1', 0, 0, '2026-06-14T00:00:00Z', '2026-06-14T00:00:00Z'),
          ('p-alice-2', 'group-a', 'alice', 'm-r2-open-2', 1, 2, '2026-06-14T00:00:00Z', '2026-06-14T00:00:00Z'),
          -- Palpite do Bob no mesmo grupo não reduz a contagem da Alice
          ('p-bob-1', 'group-a', 'bob', 'm-r2-open-3', 3, 0, '2026-06-14T00:00:00Z', '2026-06-14T00:00:00Z'),
          -- Palpite da Alice noutro grupo não preenche group-a
          ('p-alice-b', 'group-b', 'alice', 'm-r2-open-3', 2, 2, '2026-06-14T00:00:00Z', '2026-06-14T00:00:00Z');
      `)

      const aliceRes = await request('alice')
      const aliceBody = (await aliceRes.json()) as GroupsBody
      const aliceA = aliceBody.groups.find((g) => g.id === 'group-a')
      // Restam open-3 + postponed (0x0 e 1x2 já preenchidos).
      expect(aliceA?.pending_predictions).toBe(2)

      const bobRes = await request('bob')
      const bobBody = (await bobRes.json()) as GroupsBody
      const bobA = bobBody.groups.find((g) => g.id === 'group-a')
      const bobB = bobBody.groups.find((g) => g.id === 'group-b')
      // Bob preencheu só open-3 em group-a → open-1, open-2 e postponed = 3.
      expect(bobA?.pending_predictions).toBe(3)
      // group-b: mesmos jogos da competição, Bob sem palpites → 4.
      expect(bobB?.pending_predictions).toBe(4)

      // Carol sem membership → lista vazia (não vaza grupos).
      const carolRes = await request('carol')
      const carolBody = (await carolRes.json()) as GroupsBody
      expect(carolBody.groups).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns 0 when the only remaining matches in default_round are locked', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    try {
      const { sqlite, request } = await createFixture()
      // Trava todos os abertos da rodada 2 (inclui o adiado).
      sqlite.exec(`
        UPDATE matches
        SET locked_at = '2026-06-15T11:00:00Z'
        WHERE id IN ('m-r2-open-1', 'm-r2-open-2', 'm-r2-open-3', 'm-r2-postponed');
      `)

      const res = await request('alice')
      const body = (await res.json()) as GroupsBody
      expect(body.groups.find((g) => g.id === 'group-a')?.pending_predictions).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
