/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { computeRoundStandings, type RoundMemberRow } from './roundStandings'

function member(overrides: Partial<RoundMemberRow> & { user_id: string }): RoundMemberRow {
  return {
    joined_at: '2026-01-01T00:00:00Z',
    total_points: 0,
    exact_hits: 0,
    round_points: 0,
    round_exact: 0,
    ...overrides,
  }
}

function changes(rows: RoundMemberRow[]) {
  return Object.fromEntries(computeRoundStandings(rows).map((s) => [s.user_id, s.position_change]))
}

describe('computeRoundStandings', () => {
  it('marca quem subiu, quem caiu e quem manteve a posição', () => {
    const rows = [
      member({ user_id: 'lider', total_points: 30, round_points: 0 }),
      member({ user_id: 'subiu', total_points: 28, round_points: 10 }),
      member({ user_id: 'caiu', total_points: 25, round_points: 1 }),
      member({ user_id: 'ultimo', total_points: 5, round_points: 0 }),
    ]

    expect(changes(rows)).toEqual({ lider: 0, subiu: 1, caiu: -1, ultimo: 0 })
  })

  it('devolve as linhas na ordem atual do ranking', () => {
    const rows = [
      member({ user_id: 'terceiro', total_points: 1 }),
      member({ user_id: 'primeiro', total_points: 9 }),
      member({ user_id: 'segundo', total_points: 5 }),
    ]

    expect(computeRoundStandings(rows).map((s) => s.user_id)).toEqual([
      'primeiro',
      'segundo',
      'terceiro',
    ])
  })

  it('desempata por exatos, tirando da posição anterior os exatos da rodada', () => {
    const rows = [
      member({ user_id: 'a', total_points: 10, exact_hits: 3, round_points: 3, round_exact: 3 }),
      member({ user_id: 'b', total_points: 10, exact_hits: 2, round_points: 3, round_exact: 0 }),
    ]

    // Antes da rodada, os dois tinham 7 pontos, com 0 e 2 exatos. Passa `a` à frente.
    expect(changes(rows)).toEqual({ a: 1, b: -1 })
  })

  it('desempata por entrada no grupo quando pontos e exatos empatam', () => {
    const rows = [
      member({ user_id: 'novo', joined_at: '2026-03-01T00:00:00Z', total_points: 10 }),
      member({
        user_id: 'antigo',
        joined_at: '2026-01-01T00:00:00Z',
        total_points: 10,
        round_points: 4,
      }),
    ]

    // Antes da rodada, `novo` tinha 10 e `antigo` tinha 6. Com o empate, `antigo` fica à frente.
    expect(computeRoundStandings(rows).map((s) => s.user_id)).toEqual(['antigo', 'novo'])
    expect(changes(rows)).toEqual({ antigo: 1, novo: -1 })
  })

  it('usa user_id como último desempate, em comparação binária', () => {
    const rows = [
      member({ user_id: 'b', total_points: 10 }),
      member({ user_id: 'a', total_points: 10 }),
      member({ user_id: 'Z', total_points: 10 }),
    ]

    expect(computeRoundStandings(rows).map((s) => s.user_id)).toEqual(['Z', 'a', 'b'])
  })

  it('devolve null para todos quando ninguém tinha ponto antes da rodada', () => {
    const rows = [
      member({ user_id: 'a', total_points: 7, round_points: 7 }),
      member({ user_id: 'b', total_points: 3, round_points: 3 }),
      member({ user_id: 'c' }),
    ]

    expect(changes(rows)).toEqual({ a: null, b: null, c: null })
  })

  it('mantém 0 pontos de rodada e calcula a variação de quem não palpitou', () => {
    const rows = [
      member({ user_id: 'palpitou', total_points: 12, round_points: 8 }),
      member({ user_id: 'ausente', total_points: 10 }),
    ]

    expect(computeRoundStandings(rows)).toEqual([
      { user_id: 'palpitou', round_points: 8, position_change: 1 },
      { user_id: 'ausente', round_points: 0, position_change: -1 },
    ])
  })
})

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

interface MatchSeed {
  round: string | null
  status?: 'scheduled' | 'live' | 'finished'
  postponed?: 0 | 1
  start?: string
}

async function createFixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)

  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
      ('alice', 'alice@example.com', 'google', 'g-alice', 'Alice'),
      ('bob', 'bob@example.com', 'google', 'g-bob', 'Bob'),
      ('carol', 'carol@example.com', 'google', 'g-carol', 'Carol'),
      ('fora', 'fora@example.com', 'google', 'g-fora', 'Fora');

    DELETE FROM competitions;

    INSERT INTO competitions (id, name, slug, season, status, type, penalty_phases, visibility) VALUES
      ('comp-a', 'Brasileirão 2026', 'brasileirao-2026', '2026', 'ongoing', 'league', '[]', 'public'),
      ('comp-b', 'Outro', 'outro-2026', '2026', 'ongoing', 'league', '[]', 'public');

    INSERT INTO teams (id, name, short_name, slug) VALUES
      ('fla', 'Flamengo', 'FLA', 'flamengo'),
      ('pal', 'Palmeiras', 'PAL', 'palmeiras');

    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code) VALUES
      ('group-a', 'Bolão A', 'comp-a', 'alice', 'AAAA-BBBB');

    INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES
      ('gm-alice', 'group-a', 'alice', '2026-01-01T00:00:00Z'),
      ('gm-bob', 'group-a', 'bob', '2026-01-02T00:00:00Z'),
      ('gm-carol', 'group-a', 'carol', '2026-01-03T00:00:00Z');
  `)

  const env: Env = {
    DB: db,
    JWT_SECRET: 'test-round-standings-secret',
    ADMIN_EMAIL: 'admin@palpitae.com.br',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    RESEND_API_KEY: 'test-resend',
  }

  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext

  async function get(path: string, user: string | null) {
    const headers: Record<string, string> = { 'CF-Connecting-IP': '192.0.2.41' }
    if (user) {
      const token = await signJwt(
        { sub: user, email: `${user}@example.com`, jti: `jti-${user}` },
        env.JWT_SECRET,
        3600,
      )
      headers.Cookie = `session=${token}`
    }
    return worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, { method: 'GET', headers }),
      env,
      ctx,
    )
  }

  async function standings(user = 'alice') {
    const res = await get('/groups/group-a/round-standings', user)
    expect(res.status).toBe(200)
    return (await res.json()) as {
      round: string | null
      standings: { user_id: string; round_points: number; position_change: number | null }[]
    }
  }

  let nextMatch = 0
  function addMatch(seed: MatchSeed, competition = 'comp-a'): string {
    nextMatch += 1
    const id = `m-${nextMatch}`
    sqlite
      .prepare(
        `INSERT INTO matches (
           id, competition_id, external_id, provider, home_team_id, away_team_id,
           start_time, status, round, postponed
         ) VALUES (?, ?, ?, 'football-data', 'fla', 'pal', ?, ?, ?, ?)`,
      )
      .run(
        id,
        competition,
        `ext-${nextMatch}`,
        seed.start ?? '2026-06-01T19:00:00Z',
        seed.status ?? 'finished',
        seed.round,
        seed.postponed ?? 0,
      )
    return id
  }

  function addPick(
    user: string,
    matchId: string,
    points: { awarded?: number; penalty?: number; classified?: number },
  ) {
    sqlite
      .prepare(
        `INSERT INTO predictions (
           id, user_id, group_id, match_id, predicted_home_score, predicted_away_score,
           points_awarded, penalty_points, classified_points
         ) VALUES (?, ?, 'group-a', ?, 1, 0, ?, ?, ?)`,
      )
      .run(
        `p-${user}-${matchId}`,
        user,
        matchId,
        points.awarded ?? 0,
        points.penalty ?? 0,
        points.classified ?? 0,
      )
  }

  function setBoard(user: string, total: number, exact = 0) {
    sqlite
      .prepare(
        `INSERT INTO leaderboard (group_id, user_id, total_points, exact_hits, last_updated)
         VALUES ('group-a', ?, ?, ?, '2026-06-14T00:00:00Z')`,
      )
      .run(user, total, exact)
  }

  return { sqlite, get, standings, addMatch, addPick, setBoard }
}

describe('GET /groups/:id/round-standings', () => {
  it('barra quem não é membro e quem não está autenticado', async () => {
    const { get, addMatch } = await createFixture()
    addMatch({ round: '1' })

    expect((await get('/groups/group-a/round-standings', 'fora')).status).toBe(404)
    expect((await get('/groups/group-a/round-standings', null)).status).toBe(401)
  })

  it('aceita a rodada com jogo adiado como encerrada', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '5' })
    addMatch({ round: '5', status: 'scheduled', postponed: 1 })

    expect((await standings()).round).toBe('5')
  })

  it('não conta a rodada com jogo remarcado para o futuro', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '5' })
    addMatch({ round: '6' })
    addMatch({ round: '6', status: 'scheduled', postponed: 0, start: '2026-12-01T19:00:00Z' })

    expect((await standings()).round).toBe('5')
  })

  it('não conta a rodada com jogo ao vivo', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '5' })
    addMatch({ round: '6', status: 'live' })
    addMatch({ round: '6' })

    expect((await standings()).round).toBe('5')
  })

  it('escolhe a rodada de maior número, mesmo com jogo mais recente em outra', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '21', start: '2026-11-07T19:00:00Z' })
    addMatch({ round: '34', start: '2026-10-20T19:00:00Z' })
    addMatch({ round: '9', start: '2026-05-20T19:00:00Z' })

    expect((await standings()).round).toBe('34')
  })

  it('devolve null quando só há rodada não numerada', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: 'REGULAR_SEASON' })
    addMatch({ round: null })

    expect(await standings()).toEqual({ round: null, standings: [] })
  })

  it('devolve null quando nenhuma rodada encerrou', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '1', status: 'scheduled' })

    expect(await standings()).toEqual({ round: null, standings: [] })
  })

  it('devolve null quando o mata-mata já começou', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '8' })
    addMatch({ round: 'LAST_16' })
    addMatch({ round: 'LAST_16', status: 'scheduled' })

    expect(await standings()).toEqual({ round: null, standings: [] })
  })

  it('mantém a referência enquanto o mata-mata só tem jogos futuros', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '8' })
    addMatch({ round: 'LAST_16', status: 'scheduled' })

    expect((await standings()).round).toBe('8')
  })

  it('ignora rodadas de outra competição', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '3' })
    addMatch({ round: '30' }, 'comp-b')
    addMatch({ round: 'FINAL' }, 'comp-b')

    expect((await standings()).round).toBe('3')
  })

  it('soma points_awarded, penalty_points e classified_points só da rodada', async () => {
    const { standings, addMatch, addPick, setBoard } = await createFixture()
    const earlier = addMatch({ round: '1' })
    const first = addMatch({ round: '2' })
    const second = addMatch({ round: '2' })
    addPick('alice', earlier, { awarded: 3 })
    addPick('alice', first, { awarded: 3, penalty: 2 })
    addPick('alice', second, { awarded: 1, classified: 5 })
    setBoard('alice', 14, 2)

    const body = await standings()

    expect(body.round).toBe('2')
    expect(body.standings.find((s) => s.user_id === 'alice')?.round_points).toBe(11)
  })

  it('calcula a variação com os exatos da rodada e o membro sem palpite fica com 0', async () => {
    const { standings, addMatch, addPick, setBoard } = await createFixture()
    const earlier = addMatch({ round: '1' })
    const round = addMatch({ round: '2' })
    addPick('alice', earlier, { awarded: 3 })
    addPick('bob', earlier, { awarded: 1 })
    addPick('bob', round, { awarded: 3 })
    setBoard('alice', 3, 1)
    setBoard('bob', 4, 1)

    expect(await standings()).toEqual({
      round: '2',
      standings: [
        { user_id: 'bob', round_points: 3, position_change: 1 },
        { user_id: 'alice', round_points: 0, position_change: -1 },
        { user_id: 'carol', round_points: 0, position_change: 0 },
      ],
    })
  })

  it('devolve position_change null na primeira rodada pontuada', async () => {
    const { standings, addMatch, addPick, setBoard } = await createFixture()
    const round = addMatch({ round: '1' })
    addPick('alice', round, { awarded: 3 })
    setBoard('alice', 3, 1)

    const body = await standings()

    expect(body.round).toBe('1')
    expect(body.standings.map((s) => s.position_change)).toEqual([null, null, null])
  })

  it('não inclui palpites de quem saiu do grupo', async () => {
    const { sqlite, standings, addMatch, addPick } = await createFixture()
    const round = addMatch({ round: '1' })
    addPick('carol', round, { awarded: 3 })
    sqlite.exec(`DELETE FROM group_members WHERE user_id = 'carol'`)

    const body = await standings()

    expect(body.standings.map((s) => s.user_id).sort()).toEqual(['alice', 'bob'])
  })

  it('não conta exato em grupo que só pontua o resultado', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    sqlite.exec(`UPDATE groups SET points_exact = 1, points_winner = 1 WHERE id = 'group-a'`)
    const earlier = addMatch({ round: '1' })
    const round = addMatch({ round: '2' })
    // Antes da rodada, os dois empatam e a entrada no grupo põe alice à frente. Se o acerto
    // dela contasse como exato, ela ficaria com -1 exato e bob passaria na posição anterior.
    addPick('alice', earlier, { awarded: 1 })
    addPick('bob', earlier, { awarded: 1 })
    addPick('alice', round, { awarded: 1 })
    addPick('bob', round, { penalty: 1 })
    setBoard('alice', 2, 0)
    setBoard('bob', 2, 0)

    const body = await standings()

    expect(body.standings.map((s) => s.position_change)).toEqual([0, 0, 0])
  })
})

describe('GET /groups/:id/members', () => {
  it('desempata por user_id quando pontos, exatos e entrada empatam', async () => {
    const { sqlite, get } = await createFixture()
    // `aaron` entra por último, para o desempate não coincidir com a ordem de inserção.
    sqlite.exec(`
      INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
        ('aaron', 'aaron@example.com', 'google', 'g-aaron', 'Aaron');
      INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES
        ('gm-aaron', 'group-a', 'aaron', '2026-01-01T00:00:00Z');
      UPDATE group_members SET joined_at = '2026-01-01T00:00:00Z' WHERE group_id = 'group-a';
      INSERT INTO leaderboard (group_id, user_id, total_points, exact_hits, last_updated) VALUES
        ('group-a', 'alice', 5, 1, '2026-06-14T00:00:00Z'),
        ('group-a', 'bob', 5, 1, '2026-06-14T00:00:00Z'),
        ('group-a', 'carol', 5, 1, '2026-06-14T00:00:00Z'),
        ('group-a', 'aaron', 5, 1, '2026-06-14T00:00:00Z');
    `)

    const res = await get('/groups/group-a/members', 'alice')
    const body = (await res.json()) as { members: { user_id: string }[] }

    expect(body.members.map((m) => m.user_id)).toEqual(['aaron', 'alice', 'bob', 'carol'])
  })
})
