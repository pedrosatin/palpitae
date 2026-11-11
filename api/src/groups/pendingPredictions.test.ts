/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { parsePendingSummary, pendingSummarySql } from './pendingPredictions'
import { lockedSql } from '../matches/locking'
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

    -- Seed distinto para regressão de bind: se now/userId trocarem de lugar,
    -- user_points/user_position divergem mesmo com pending_predictions plausível.
    INSERT INTO leaderboard (group_id, user_id, total_points, exact_hits, last_updated) VALUES
      ('group-a', 'alice', 30, 4, '2026-06-14T00:00:00Z'),
      ('group-a', 'bob', 10, 1, '2026-06-14T00:00:00Z'),
      ('group-b', 'bob', 7, 0, '2026-06-14T00:00:00Z');
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
  groups: Array<{
    id: string
    pending_predictions: number
    user_points: number
    user_position: number
    next_deadline: {
      match_id: string
      start_time: string
      round: string
      round_label: string
      home_team: string
      away_team: string
    } | null
    next_match_at: string | null
    current_round_label: string | null
    round_ends_at: string | null
    live_matches: number
  }>
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
      const aliceA = body.groups.find((g) => g.id === 'group-a')
      const aliceEmpty = body.groups.find((g) => g.id === 'group-empty')

      // Alice no group-a: 3 abertos futuros + 1 adiado aberto na rodada 2 = 4.
      // Travado e rodada 3 não entram. Sem palpites ainda.
      expect(aliceA?.pending_predictions).toBe(4)
      expect(aliceA?.user_points).toBe(30)
      expect(aliceA?.user_position).toBe(1)
      // Grupo sem jogos: 0, sem falso "concluído" no front (só some o hint).
      expect(aliceEmpty?.pending_predictions).toBe(0)
      expect(aliceEmpty?.user_points).toBe(0)
      // Sem linha no leaderboard não há posição.
      expect(aliceEmpty?.user_position).toBeNull()
      // Pilot some da lista para usuário sem acesso (alice não é admin/pilot).
      expect(body.groups.some((g) => g.id === 'group-pilot')).toBe(false)
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
      expect(aliceA?.user_points).toBe(30)
      expect(aliceA?.user_position).toBe(1)

      const bobRes = await request('bob')
      const bobBody = (await bobRes.json()) as GroupsBody
      const bobA = bobBody.groups.find((g) => g.id === 'group-a')
      const bobB = bobBody.groups.find((g) => g.id === 'group-b')
      // Bob preencheu só open-3 em group-a → open-1, open-2 e postponed = 3.
      expect(bobA?.pending_predictions).toBe(3)
      expect(bobA?.user_points).toBe(10)
      expect(bobA?.user_position).toBe(2)
      // group-b: mesmos jogos da competição, Bob sem palpites → 4.
      expect(bobB?.pending_predictions).toBe(4)
      expect(bobB?.user_points).toBe(7)
      expect(bobB?.user_position).toBe(1)

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

describe('GET /groups resumo da rodada para o painel (SQLite D1)', () => {
  async function groupsFor(
    setup: (sqlite: DatabaseSync, env: Env) => void = () => {},
  ): Promise<GroupsBody['groups']> {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    try {
      const { sqlite, request, env } = await createFixture()
      setup(sqlite, env)
      const res = await request('alice')
      expect(res.status).toBe(200)
      return ((await res.json()) as GroupsBody).groups
    } finally {
      vi.useRealTimers()
    }
  }

  function predict(sqlite: DatabaseSync, ...matchIds: string[]) {
    for (const matchId of matchIds) {
      sqlite.exec(`
        INSERT INTO predictions (
          id, group_id, user_id, match_id,
          predicted_home_score, predicted_away_score, created_at, updated_at
        ) VALUES (
          'p-${matchId}', 'group-a', 'alice', '${matchId}', 1, 0,
          '2026-06-14T00:00:00Z', '2026-06-14T00:00:00Z'
        );
      `)
    }
  }

  it('aponta o jogo sem palpite que fecha primeiro, com rodada e times', async () => {
    const groups = await groupsFor()
    const groupA = groups.find((g) => g.id === 'group-a')

    expect(groupA?.next_deadline).toEqual({
      match_id: 'm-r2-open-1',
      start_time: '2026-06-20T19:00:00Z',
      round: '2',
      round_label: 'Rodada 2',
      home_team: 'Flamengo',
      away_team: 'Corinthians',
    })
    expect(groupA?.next_match_at).toBe('2026-06-20T19:00:00Z')
    expect(groupA?.current_round_label).toBe('Rodada 2')
    // O jogo travado de 23/06 não conta. A rodada fecha no último jogo aberto.
    expect(groupA?.round_ends_at).toBe('2026-06-22T19:00:00Z')
    expect(groupA?.live_matches).toBe(0)
  })

  it('passa o prazo para o jogo seguinte e mantém o próximo jogo já palpitado', async () => {
    const groups = await groupsFor((sqlite) => predict(sqlite, 'm-r2-open-1'))
    const groupA = groups.find((g) => g.id === 'group-a')

    expect(groupA?.pending_predictions).toBe(3)
    expect(groupA?.next_deadline?.match_id).toBe('m-r2-open-2')
    expect(groupA?.next_deadline?.start_time).toBe('2026-06-21T19:00:00Z')
    expect(groupA?.next_match_at).toBe('2026-06-20T19:00:00Z')
  })

  it('aponta o remarcado de rodada que ficou para trás quando ele fecha antes', async () => {
    const groups = await groupsFor((sqlite) =>
      sqlite.exec(`
        INSERT INTO matches (
          id, competition_id, external_id, provider,
          home_team_id, away_team_id, start_time, status, round, phase, postponed, locked_at
        ) VALUES
          ('m-r1-2', 'comp-a', 'fd-r1-2', 'football-data', 'cor', 'sao', '2026-06-02T19:00:00Z', 'finished', '1', NULL, 0, '2026-06-02T19:00:00Z'),
          ('m-r1-remarcado', 'comp-a', 'fd-r1-3', 'football-data', 'sao', 'pal', '2026-06-18T19:00:00Z', 'scheduled', '1', NULL, 0, NULL);
      `),
    )
    const groupA = groups.find((g) => g.id === 'group-a')

    // A rodada 1 ficou para trás e segue fora da rodada padrão. O remarcado conta
    // como pendente e vira o prazo, com a rodada dele para o link do painel.
    expect(groupA?.pending_predictions).toBe(5)
    expect(groupA?.current_round_label).toBe('Rodada 2')
    expect(groupA?.next_deadline).toMatchObject({
      match_id: 'm-r1-remarcado',
      round: '1',
      round_label: 'Rodada 1',
      home_team: 'São Paulo',
      away_team: 'Palmeiras',
    })
    expect(groupA?.round_ends_at).toBe('2026-06-22T19:00:00Z')
  })

  it('conta o adiado sem data como pendente, mas sem prazo', async () => {
    const groups = await groupsFor((sqlite) =>
      predict(sqlite, 'm-r2-open-1', 'm-r2-open-2', 'm-r2-open-3'),
    )
    const groupA = groups.find((g) => g.id === 'group-a')

    expect(groupA?.pending_predictions).toBe(1)
    expect(groupA?.next_deadline).toBeNull()
    expect(groupA?.next_match_at).toBe('2026-06-20T19:00:00Z')
  })

  it('deixa o adiado de horário futuro fora do prazo e do próximo jogo', async () => {
    // Adiado antes do apito: o sync guarda o horário original, 18/06, ainda futuro.
    const groups = await groupsFor((sqlite) =>
      sqlite.exec(`
        UPDATE matches SET start_time = '2026-06-18T19:00:00Z' WHERE id = 'm-r2-postponed';
      `),
    )
    const groupA = groups.find((g) => g.id === 'group-a')

    expect(groupA?.pending_predictions).toBe(4)
    expect(groupA?.next_deadline?.match_id).toBe('m-r2-open-1')
    expect(groupA?.next_deadline?.start_time).toBe('2026-06-20T19:00:00Z')
    expect(groupA?.next_match_at).toBe('2026-06-20T19:00:00Z')
  })

  it('no empate de horário prefere o jogo da rodada padrão ao remarcado', async () => {
    // O remarcado da rodada 1 tem o id menor e o mesmo horário do primeiro jogo da 2.
    const groups = await groupsFor((sqlite) =>
      sqlite.exec(`
        INSERT INTO matches (
          id, competition_id, external_id, provider,
          home_team_id, away_team_id, start_time, status, round, phase, postponed, locked_at
        ) VALUES
          ('m-r1-2', 'comp-a', 'fd-r1-2', 'football-data', 'cor', 'sao', '2026-06-02T19:00:00Z', 'finished', '1', NULL, 0, '2026-06-02T19:00:00Z'),
          ('m-r1-remarcado', 'comp-a', 'fd-r1-3', 'football-data', 'sao', 'pal', '2026-06-20T19:00:00Z', 'scheduled', '1', NULL, 0, NULL);
      `),
    )
    const groupA = groups.find((g) => g.id === 'group-a')

    expect(groupA?.pending_predictions).toBe(5)
    expect(groupA?.next_deadline).toMatchObject({ match_id: 'm-r2-open-1', round: '2' })
  })

  it.each([
    [
      'dos jogos ao vivo',
      'AS live_matches',
      { live_matches: 0, next_deadline: { match_id: 'm-r2-open-1' } },
    ],
    ['do jogo de prazo', 'AS home_team', { live_matches: 1, next_deadline: null }],
  ])('lista os grupos quando a consulta %s falha', async (_query, marker, expected) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const groups = await groupsFor((sqlite, env) => {
        sqlite.exec(`
          INSERT INTO matches (
            id, competition_id, external_id, provider,
            home_team_id, away_team_id, start_time, status, round, phase, postponed, locked_at
          ) VALUES
            ('m-live', 'comp-a', 'fd-l1', 'football-data', 'pal', 'fla', '2026-06-15T11:00:00Z', 'scheduled', '1', NULL, 0, NULL);
        `)
        const prepare = env.DB.prepare.bind(env.DB)
        vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
          if (sql.includes(marker)) throw new Error('D1 indisponível')
          return prepare(sql)
        })
      })
      const groupA = groups.find((g) => g.id === 'group-a')

      expect(groupA).toMatchObject({ pending_predictions: 4, ...expected })
      expect(error).toHaveBeenCalledOnce()
    } finally {
      error.mockRestore()
    }
  })

  it('rodada toda palpitada fica sem prazo e mantém o próximo jogo', async () => {
    const groups = await groupsFor((sqlite) =>
      predict(sqlite, 'm-r2-open-1', 'm-r2-open-2', 'm-r2-open-3', 'm-r2-postponed'),
    )
    const groupA = groups.find((g) => g.id === 'group-a')

    expect(groupA?.pending_predictions).toBe(0)
    expect(groupA?.next_deadline).toBeNull()
    expect(groupA?.next_match_at).toBe('2026-06-20T19:00:00Z')
    expect(groupA?.current_round_label).toBe('Rodada 2')
    expect(groupA?.round_ends_at).toBe('2026-06-22T19:00:00Z')
  })

  it('conta só os jogos começados e sem resultado da competição do grupo', async () => {
    const groups = await groupsFor((sqlite) =>
      sqlite.exec(`
        INSERT INTO matches (
          id, competition_id, external_id, provider,
          home_team_id, away_team_id, start_time, status, round, phase, postponed, locked_at
        ) VALUES
          -- Começou há 1 h e segue sem resultado, então está ao vivo
          ('m-live-1', 'comp-a', 'fd-l1', 'football-data', 'pal', 'fla', '2026-06-15T11:00:00Z', 'scheduled', '1', NULL, 0, NULL),
          ('m-live-2', 'comp-a', 'fd-l2', 'football-data', 'cor', 'sao', '2026-06-15T10:30:00Z', 'scheduled', '1', NULL, 0, '2026-06-15T10:30:00Z'),
          -- Encerrado na janela
          ('m-done', 'comp-a', 'fd-l3', 'football-data', 'sao', 'pal', '2026-06-15T10:00:00Z', 'finished', '1', NULL, 0, '2026-06-15T10:00:00Z'),
          -- Adiado com horário na janela
          ('m-adiado', 'comp-a', 'fd-l4', 'football-data', 'fla', 'sao', '2026-06-15T11:30:00Z', 'scheduled', '1', NULL, 1, NULL),
          -- Começou há 4 h e segue sem resultado, fora da janela do poller
          ('m-velho', 'comp-a', 'fd-l5', 'football-data', 'cor', 'fla', '2026-06-15T08:00:00Z', 'scheduled', '1', NULL, 0, NULL),
          -- Outra competição
          ('m-outra', 'comp-empty', 'fd-l6', 'football-data', 'pal', 'cor', '2026-06-15T11:00:00Z', 'scheduled', '1', NULL, 0, NULL);
      `),
    )

    expect(groups.find((g) => g.id === 'group-a')?.live_matches).toBe(2)
    expect(groups.find((g) => g.id === 'group-a')?.pending_predictions).toBe(4)
    expect(groups.find((g) => g.id === 'group-empty')?.live_matches).toBe(1)
  })

  it('grupo sem jogos e grupo encerrado saem sem prazo e sem rodada', async () => {
    const groups = await groupsFor((sqlite) =>
      sqlite.exec(`
        INSERT INTO competitions (id, name, slug, season, status, type, penalty_phases, visibility) VALUES
          ('comp-done', 'Copa Encerrada', 'copa-encerrada', '2025', 'finished', 'cup', '["FINAL"]', 'public');
        INSERT INTO matches (
          id, competition_id, external_id, provider,
          home_team_id, away_team_id, start_time, status, round, phase, postponed, locked_at
        ) VALUES
          ('m-done-final', 'comp-done', 'fd-d1', 'football-data', 'fla', 'pal', '2026-06-15T11:00:00Z', 'scheduled', 'FINAL', 'FINAL', 0, NULL);
        INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code) VALUES
          ('group-done', 'Encerrado', 'comp-done', 'alice', 'IIII-JJJJ');
        INSERT INTO group_members (group_id, user_id, joined_at) VALUES
          ('group-done', 'alice', '2026-01-01T00:00:00Z');
      `),
    )

    for (const id of ['group-empty', 'group-done']) {
      const group = groups.find((g) => g.id === id)
      expect(group).toMatchObject({
        pending_predictions: 0,
        next_deadline: null,
        next_match_at: null,
        current_round_label: null,
        round_ends_at: null,
        live_matches: 0,
      })
    }
  })
})

describe('parsePendingSummary', () => {
  it('separa o horário e o id do jogo de prazo', () => {
    expect(
      parsePendingSummary(
        '{"pending":2,"deadline":"2026-11-14T21:30:00Z|0|abc-123","next_match_at":"2026-11-14T21:30:00Z","round":"35","round_ends_at":"2026-11-20T00:30:00Z"}',
      ),
    ).toEqual({
      pending: 2,
      deadline: { start_time: '2026-11-14T21:30:00Z', match_id: 'abc-123' },
      next_match_at: '2026-11-14T21:30:00Z',
      round: '35',
      round_ends_at: '2026-11-20T00:30:00Z',
    })
  })

  it('devolve o resumo vazio para valor nulo ou JSON inválido', () => {
    const empty = {
      pending: 0,
      deadline: null,
      next_match_at: null,
      round: null,
      round_ends_at: null,
    }
    expect(parsePendingSummary(null)).toEqual(empty)
    expect(parsePendingSummary('{')).toEqual(empty)
    expect(parsePendingSummary('{"pending":0,"deadline":null}')).toEqual(empty)
    expect(parsePendingSummary('{"pending":0,"deadline":"2026-11-14T21:30:00Z|abc"}')).toEqual(empty)
  })
})

describe('pendingSummarySql unit tests', () => {
  it('returns correctly formatted sql string with default alias', () => {
    const sql = pendingSummarySql()
    expect(sql.trim().replace(/\s+/g, ' ')).toContain(
      `ON m.competition_id = g.competition_id AND m.round = r.round`
    )
    expect(sql.trim().replace(/\s+/g, ' ')).toContain(
      `AND NOT ${lockedSql('m').trim().replace(/\s+/g, ' ')}`
    )
    expect(sql.trim().replace(/\s+/g, ' ')).toContain(
      `AND p.group_id = g.id`
    )
  })

  it('returns correctly formatted sql string with custom alias', () => {
    const sql = pendingSummarySql('customAlias')
    expect(sql.trim().replace(/\s+/g, ' ')).toContain(
      `ON m.competition_id = customAlias.competition_id AND m.round = r.round`
    )
    expect(sql.trim().replace(/\s+/g, ' ')).toContain(
      `AND p.group_id = customAlias.id`
    )
  })
})
