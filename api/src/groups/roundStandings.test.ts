/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import {
  computeRoundStandings,
  computeStreaks,
  pickReferenceRound,
  type MemberRoundPicks,
  type RoundMemberRow,
  type RoundPhaseRow,
} from './roundStandings'

const NO_STREAKS = new Map<string, number>()

function member(overrides: Partial<RoundMemberRow> & { user_id: string }): RoundMemberRow {
  return {
    joined_at: '2026-01-01T00:00:00Z',
    total_points: 0,
    exact_hits: 0,
    unscored: 0,
    round_points: 0,
    since_points: overrides.round_points ?? 0,
    since_exact: 0,
    ...overrides,
  }
}

function changes(rows: RoundMemberRow[]) {
  return Object.fromEntries(
    computeRoundStandings(rows, NO_STREAKS).map((s) => [s.user_id, s.position_change]),
  )
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

    expect(computeRoundStandings(rows, NO_STREAKS).map((s) => s.user_id)).toEqual([
      'primeiro',
      'segundo',
      'terceiro',
    ])
  })

  it('desempata por exatos, tirando da posição anterior os exatos da rodada', () => {
    const rows = [
      member({ user_id: 'a', total_points: 10, exact_hits: 3, round_points: 3, since_exact: 3 }),
      member({ user_id: 'b', total_points: 10, exact_hits: 2, round_points: 3 }),
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
    expect(computeRoundStandings(rows, NO_STREAKS).map((s) => s.user_id)).toEqual([
      'antigo',
      'novo',
    ])
    expect(changes(rows)).toEqual({ antigo: 1, novo: -1 })
  })

  it('usa user_id como último desempate, em comparação binária', () => {
    const rows = [
      member({ user_id: 'b', total_points: 10 }),
      member({ user_id: 'a', total_points: 10 }),
      member({ user_id: 'Z', total_points: 10 }),
    ]

    expect(computeRoundStandings(rows, NO_STREAKS).map((s) => s.user_id)).toEqual(['Z', 'a', 'b'])
  })

  it('devolve null para todos quando ninguém tinha ponto antes da rodada', () => {
    const rows = [
      member({ user_id: 'a', total_points: 7, round_points: 7 }),
      member({ user_id: 'b', total_points: 3, round_points: 3 }),
      member({ user_id: 'c' }),
    ]

    expect(changes(rows)).toEqual({ a: null, b: null, c: null })
  })

  it('devolve null na primeira rodada mesmo com a rodada seguinte pontuada em parte', () => {
    const rows = [
      member({ user_id: 'alice', total_points: 6, round_points: 6, since_points: 6 }),
      member({ user_id: 'bob', total_points: 6, round_points: 3, since_points: 6 }),
    ]

    expect(changes(rows)).toEqual({ alice: null, bob: null })
  })

  it('tira da posição anterior a rodada de referência e a seguinte, e mostra só a referência', () => {
    const rows = [
      member({ user_id: 'alice', total_points: 20, round_points: 3, since_points: 12 }),
      member({ user_id: 'bob', total_points: 18, round_points: 5, since_points: 5 }),
    ]

    // Antes da referência, alice tinha 8 e bob tinha 13. Descontando só a referência, seria 17 a 13.
    expect(computeRoundStandings(rows, NO_STREAKS)).toEqual([
      { user_id: 'alice', round_points: 3, position_change: 1, streak: 0 },
      { user_id: 'bob', round_points: 5, position_change: -1, streak: 0 },
    ])
  })

  it('tira do desempate anterior os exatos da rodada posterior', () => {
    const rows = [
      member({ user_id: 'a', total_points: 10, exact_hits: 2, since_points: 4, since_exact: 2 }),
      member({ user_id: 'b', total_points: 10, exact_hits: 1, since_points: 4 }),
    ]

    // Antes da referência, os dois tinham 6 pontos, com 0 e 1 exato. Passa `a` à frente.
    expect(changes(rows)).toEqual({ a: 1, b: -1 })
  })

  it('mantém 0 pontos de rodada e calcula a variação de quem não palpitou', () => {
    const rows = [
      member({ user_id: 'palpitou', total_points: 12, round_points: 8 }),
      member({ user_id: 'ausente', total_points: 10 }),
    ]

    expect(computeRoundStandings(rows, NO_STREAKS)).toEqual([
      { user_id: 'palpitou', round_points: 8, position_change: 1, streak: 0 },
      { user_id: 'ausente', round_points: 0, position_change: -1, streak: 0 },
    ])
  })

  it('leva a sequência de cada membro e usa 0 para quem não tem', () => {
    const rows = [member({ user_id: 'a', total_points: 5 }), member({ user_id: 'b' })]

    const streaks = new Map([['a', 4]])

    expect(computeRoundStandings(rows, streaks).map((s) => [s.user_id, s.streak])).toEqual([
      ['a', 4],
      ['b', 0],
    ])
  })
})

const BEFORE = '2026-04-01T19:00:00Z'
const ROUND_START = '2026-05-01T19:00:00Z'
const AFTER = '2026-06-01T19:00:00Z'
const LATER = '2026-07-01T19:00:00Z'

function roundRow(overrides: Partial<RoundPhaseRow> = {}): RoundPhaseRow {
  return {
    round: '8',
    phase: 'REGULAR_SEASON',
    finished: 1,
    pending: 0,
    first_start: ROUND_START,
    last_scored: ROUND_START,
    ...overrides,
  }
}

function knockoutRow(lastScored: string | null, phase = 'LAST_16'): RoundPhaseRow {
  return roundRow({ round: phase, phase, first_start: BEFORE, last_scored: lastScored })
}

describe('pickReferenceRound', () => {
  it('escolhe a rodada encerrada de maior número, em ordem numérica', () => {
    expect(pickReferenceRound([roundRow({ round: '9' }), roundRow({ round: '21' })])).toBe('21')
  })

  it('ignora a rodada com jogo pendente e vale a anterior', () => {
    expect(pickReferenceRound([roundRow({ round: '5' }), roundRow({ pending: 1 })])).toBe('5')
  })

  it('ignora a rodada sem jogo pontuado', () => {
    expect(pickReferenceRound([roundRow({ round: '5' }), roundRow({ finished: 0 })])).toBe('5')
  })

  it('devolve null sem rodada numerada', () => {
    expect(
      pickReferenceRound([
        roundRow({ round: 'REGULAR_SEASON' }),
        roundRow({ round: null, phase: null }),
        roundRow({ round: '' }),
      ]),
    ).toBeNull()
  })

  it('soma as fases da mesma rodada, em qualquer ordem', () => {
    const open = roundRow({ phase: 'LEAGUE_STAGE', pending: 1 })
    const closed = roundRow()
    const earlier = roundRow({ round: '5' })

    expect(pickReferenceRound([earlier, closed, open])).toBe('5')
    expect(pickReferenceRound([earlier, open, closed])).toBe('5')
  })

  it('usa o menor início entre as fases da mesma rodada, em qualquer ordem', () => {
    const first = roundRow({ first_start: BEFORE })
    const second = roundRow({ phase: 'LEAGUE_STAGE', first_start: AFTER })

    expect(pickReferenceRound([first, second, knockoutRow(ROUND_START)])).toBeNull()
    expect(pickReferenceRound([second, first, knockoutRow(ROUND_START)])).toBeNull()
  })

  it('devolve null com a rodada 8 fechada e a rodada 3 remarcada para depois do mata-mata', () => {
    expect(
      pickReferenceRound([
        roundRow({ round: '3', first_start: LATER, last_scored: LATER }),
        roundRow(),
        knockoutRow(AFTER),
      ]),
    ).toBeNull()
  })

  it('devolve null com jogo remarcado da própria rodada depois do LAST_16', () => {
    expect(pickReferenceRound([roundRow({ last_scored: LATER }), knockoutRow(AFTER)])).toBeNull()
  })

  it('não bloqueia com fase não eliminatória depois da rodada, seja qual for o round', () => {
    const after = { first_start: AFTER, last_scored: AFTER }

    expect(
      pickReferenceRound([
        roundRow({ round: '21', first_start: BEFORE, last_scored: BEFORE }),
        roundRow({ round: '34' }),
        roundRow({ round: 'REGULAR_SEASON', phase: 'REGULAR_SEASON', ...after }),
        roundRow({ round: 'GROUP_STAGE', phase: 'GROUP_STAGE', ...after }),
        roundRow({ round: null, phase: 'LEAGUE_STAGE', ...after }),
        roundRow({ round: null, phase: null, ...after }),
      ]),
    ).toBe('34')
  })

  it('não bloqueia com LAST_16 encerrado sem pontuação', () => {
    expect(pickReferenceRound([roundRow(), knockoutRow(null)])).toBe('8')
  })

  it('não bloqueia com fase eliminatória preliminar anterior ao início da rodada', () => {
    expect(pickReferenceRound([roundRow(), knockoutRow(BEFORE, 'FIRST_STAGE')])).toBe('8')
  })

  it('não bloqueia com jogo eliminatório no mesmo horário do início da rodada', () => {
    expect(pickReferenceRound([roundRow(), knockoutRow(ROUND_START)])).toBe('8')
  })

  it('devolve null com mata-mata pontuado depois do início da rodada', () => {
    expect(pickReferenceRound([roundRow(), knockoutRow(AFTER)])).toBeNull()
  })
})

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

interface MatchSeed {
  round: string | null
  /** Sem valor, a rodada numerada vira `REGULAR_SEASON` e a outra usa o próprio `round`. */
  phase?: string | null
  status?: 'scheduled' | 'live' | 'finished'
  postponed?: 0 | 1
  start?: string
  /** Jogo encerrado que a pontuação ainda não processou. */
  unscored?: boolean
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
      standings: {
        user_id: string
        round_points: number
        position_change: number | null
        streak: number
      }[]
    }
  }

  let nextMatch = 0
  function addMatch(seed: MatchSeed, competition = 'comp-a'): string {
    nextMatch += 1
    const id = `m-${nextMatch}`
    const status = seed.status ?? 'finished'
    sqlite
      .prepare(
        `INSERT INTO matches (
           id, competition_id, external_id, provider, home_team_id, away_team_id,
           start_time, status, round, phase, postponed, scored_at
         ) VALUES (?, ?, ?, 'football-data', 'fla', 'pal', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        competition,
        `ext-${nextMatch}`,
        seed.start ?? '2026-06-01T19:00:00Z',
        status,
        seed.round,
        seed.phase !== undefined
          ? seed.phase
          : seed.round !== null && /^\d+$/.test(seed.round)
            ? 'REGULAR_SEASON'
            : seed.round,
        seed.postponed ?? 0,
        status === 'finished' && !seed.unscored ? '2026-06-02T00:00:00Z' : null,
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

describe('computeStreaks', () => {
  function picked(user: string, rounds: string[], picks = 1): MemberRoundPicks[] {
    return rounds.map((round) => ({ user_id: user, round, picks }))
  }

  function streak(phases: RoundPhaseRow[], picks: MemberRoundPicks[], user = 'ana') {
    return computeStreaks(phases, picks).get(user)
  }

  const threeRounds = [roundRow({ round: '1' }), roundRow({ round: '2' }), roundRow({ round: '3' })]

  it('conta 3 rodadas seguidas da referência para trás', () => {
    expect(streak(threeRounds, picked('ana', ['1', '2', '3']))).toBe(3)
  })

  it('para na primeira rodada encerrada sem palpite', () => {
    const phases = [...threeRounds, roundRow({ round: '4' })]

    expect(streak(phases, picked('ana', ['1', '2', '4']))).toBe(1)
  })

  it('quebra quando o membro palpitou só parte dos jogos da rodada', () => {
    const phases = [roundRow({ round: '1' }), roundRow({ round: '2', finished: 2 })]

    expect(streak(phases, picked('ana', ['1', '2']))).toBe(0)
    expect(streak(phases, [...picked('ana', ['1']), ...picked('ana', ['2'], 2)])).toBe(2)
  })

  it('pula a rodada aberta no meio, sem contar e sem quebrar', () => {
    const phases = [
      roundRow({ round: '1' }),
      roundRow({ round: '2', pending: 1 }),
      roundRow({ round: '3' }),
    ]

    expect(streak(phases, picked('ana', ['1', '3']))).toBe(2)
  })

  it('não conta rodada sem jogo pontuado', () => {
    const phases = [roundRow({ round: '1' }), roundRow({ round: '2', finished: 0 })]

    expect(streak(phases, picked('ana', ['1']))).toBe(1)
  })

  it('dá 0 a quem não palpitou na referência, mesmo com rodadas anteriores completas', () => {
    expect(streak(threeRounds, picked('ana', ['1', '2']))).toBe(0)
  })

  it('percorre as rodadas em ordem numérica', () => {
    const phases = [roundRow({ round: '9' }), roundRow({ round: '10' })]

    expect(streak(phases, picked('ana', ['10']))).toBe(1)
  })

  it('soma as fases da mesma rodada', () => {
    const phases = [roundRow({ round: '5' }), roundRow({ round: '5', phase: 'LEAGUE_STAGE' })]

    expect(streak(phases, picked('ana', ['5']))).toBe(0)
    expect(streak(phases, picked('ana', ['5'], 2))).toBe(1)
  })

  it('ignora rodada sem número', () => {
    const phases = [roundRow({ round: '1' }), roundRow({ round: 'REGULAR_SEASON', finished: 9 })]

    expect(streak(phases, picked('ana', ['1']))).toBe(1)
  })

  it('calcula cada membro à parte', () => {
    const picks = [...picked('ana', ['1', '2', '3']), ...picked('bia', ['3'])]

    expect(Object.fromEntries(computeStreaks(threeRounds, picks))).toEqual({ ana: 3, bia: 1 })
  })
})

describe('GET /groups/:id/round-standings', () => {
  it('barra quem não é membro e quem não está autenticado', async () => {
    const { get, addMatch } = await createFixture()
    addMatch({ round: '1' })

    expect((await get('/groups/group-a/round-standings', 'fora')).status).toBe(404)
    expect((await get('/groups/group-a/round-standings', null)).status).toBe(401)
  })

  it('devolve 404 para grupo apagado', async () => {
    const { sqlite, get, addMatch } = await createFixture()
    addMatch({ round: '1' })
    sqlite.exec(`UPDATE groups SET deleted_at = datetime('now') WHERE id = 'group-a'`)

    expect((await get('/groups/group-a/round-standings', 'alice')).status).toBe(404)
  })

  it('devolve 404 em competição pilot para usuário sem permissão', async () => {
    const { sqlite, get, addMatch } = await createFixture()
    addMatch({ round: '1' })
    sqlite.exec(`UPDATE competitions SET visibility = 'pilot' WHERE id = 'comp-a'`)

    expect((await get('/groups/group-a/round-standings', 'alice')).status).toBe(404)
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

  it('não conta a rodada com jogo encerrado ainda sem pontuação e vale a anterior', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '5' })
    addMatch({ round: '6' })
    addMatch({ round: '6', unscored: true })

    expect((await standings()).round).toBe('5')
  })

  it('mantém aberta a rodada com jogo encerrado sem pontuação e postponed 1', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '5' })
    addMatch({ round: '6' })
    addMatch({ round: '6', unscored: true, postponed: 1 })

    expect((await standings()).round).toBe('5')
  })

  it('não conta a rodada só com jogos adiados', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '5' })
    addMatch({ round: '6', status: 'scheduled', postponed: 1 })

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

  it('devolve null quando o mata-mata foi pontuado depois da rodada', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '8', start: ROUND_START })
    addMatch({ round: 'LAST_16', start: AFTER })
    addMatch({ round: 'LAST_16', status: 'scheduled', start: LATER })

    expect(await standings()).toEqual({ round: null, standings: [] })
  })

  it('devolve null com a rodada 8 fechada e a rodada 3 remarcada para depois do mata-mata', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '3', start: LATER })
    addMatch({ round: '8', start: ROUND_START })
    addMatch({ round: 'LAST_16', start: AFTER })

    expect(await standings()).toEqual({ round: null, standings: [] })
  })

  it('devolve null com jogo remarcado da própria rodada depois do LAST_16', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '8', start: ROUND_START })
    addMatch({ round: '8', start: LATER })
    addMatch({ round: 'LAST_16', start: AFTER })

    expect(await standings()).toEqual({ round: null, standings: [] })
  })

  it('separa as fases de uma mesma rodada ao procurar o mata-mata', async () => {
    const { standings, addMatch } = await createFixture()
    // O último jogo não é eliminatório. Sem agrupar por fase, a linha da rodada ficaria com ele.
    addMatch({ round: '8', start: ROUND_START })
    addMatch({ round: '8', phase: 'LAST_16', start: AFTER })
    addMatch({ round: '8', start: LATER })

    expect(await standings()).toEqual({ round: null, standings: [] })
  })

  it('não bloqueia com REGULAR_SEASON e round NULL de fase não eliminatória depois da rodada 34', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '21', start: BEFORE })
    addMatch({ round: '34', start: ROUND_START })
    addMatch({ round: 'REGULAR_SEASON', phase: 'REGULAR_SEASON', start: AFTER })
    addMatch({ round: null, phase: 'REGULAR_SEASON', start: LATER })

    expect((await standings()).round).toBe('34')
  })

  it('não bloqueia com LAST_16 encerrado e ainda sem pontuação', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '8', start: ROUND_START })
    addMatch({ round: 'LAST_16', start: AFTER, unscored: true })

    expect((await standings()).round).toBe('8')
  })

  it('não bloqueia com fase eliminatória preliminar anterior ao início da rodada', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: 'FIRST_STAGE', phase: 'FIRST_STAGE', start: BEFORE })
    addMatch({ round: '1', start: ROUND_START })

    expect((await standings()).round).toBe('1')
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
    addMatch({ round: 'FINAL', start: '2026-07-01T19:00:00Z' }, 'comp-b')

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
        { user_id: 'bob', round_points: 3, position_change: 1, streak: 2 },
        { user_id: 'alice', round_points: 0, position_change: -1, streak: 0 },
        { user_id: 'carol', round_points: 0, position_change: 0, streak: 0 },
      ],
    })
  })

  it('devolve position_change null com a rodada 1 fechada e a rodada 2 pontuada em parte', async () => {
    const { standings, addMatch, addPick, setBoard } = await createFixture()
    const first = addMatch({ round: '1', start: BEFORE })
    const saturday = addMatch({ round: '2', start: ROUND_START })
    addMatch({ round: '2', status: 'scheduled', start: AFTER })
    addPick('alice', first, { awarded: 6 })
    addPick('bob', first, { awarded: 3 })
    addPick('alice', saturday, { awarded: 0 })
    addPick('bob', saturday, { awarded: 3 })
    setBoard('alice', 6, 0)
    setBoard('bob', 6, 2)

    const body = await standings()

    expect(body.round).toBe('1')
    expect(body.standings.map((s) => s.position_change)).toEqual([null, null, null])
    expect(body.standings.find((s) => s.user_id === 'alice')?.round_points).toBe(6)
    expect(body.standings.find((s) => s.user_id === 'bob')?.round_points).toBe(3)
  })

  it('ignora a referência e a rodada seguinte na posição anterior, e mostra só a referência', async () => {
    const { standings, addMatch, addPick, setBoard } = await createFixture()
    const earlier = addMatch({ round: '1', start: BEFORE })
    const reference = addMatch({ round: '2', start: ROUND_START })
    const next = addMatch({ round: '3', start: AFTER })
    addMatch({ round: '3', status: 'scheduled', start: LATER })
    addPick('alice', earlier, { awarded: 5 })
    addPick('bob', earlier, { awarded: 8 })
    addPick('alice', reference, { awarded: 1 })
    addPick('alice', next, { awarded: 9 })
    setBoard('alice', 15, 0)
    setBoard('bob', 8, 0)

    expect(await standings()).toEqual({
      round: '2',
      standings: [
        { user_id: 'alice', round_points: 1, position_change: 1, streak: 2 },
        { user_id: 'bob', round_points: 0, position_change: -1, streak: 0 },
        { user_id: 'carol', round_points: 0, position_change: 0, streak: 0 },
      ],
    })
  })

  it('tira do desempate anterior os exatos da rodada seguinte', async () => {
    const { standings, addMatch, addPick, setBoard } = await createFixture()
    const earlier = addMatch({ round: '1', start: BEFORE })
    const reference = addMatch({ round: '2', start: ROUND_START })
    const next = addMatch({ round: '3', start: AFTER })
    addMatch({ round: '3', status: 'scheduled', start: LATER })
    // Na rodada 1, os dois fazem 3 pontos e só bob crava. Na rodada 3, só alice crava.
    addPick('alice', earlier, { awarded: 1, penalty: 2 })
    addPick('bob', earlier, { awarded: 3 })
    addPick('alice', reference, { awarded: 1 })
    addPick('bob', reference, { awarded: 1 })
    addPick('alice', next, { awarded: 3 })
    addPick('bob', next, { awarded: 1, penalty: 2 })
    setBoard('alice', 7, 1)
    setBoard('bob', 7, 1)

    const body = await standings()

    expect(body.standings.map((s) => [s.user_id, s.position_change])).toEqual([
      ['alice', 1],
      ['bob', -1],
      ['carol', 0],
    ])
  })

  it('não soma rodada sem número ao que veio da referência em diante', async () => {
    const { standings, addMatch, addPick, setBoard } = await createFixture()
    // Rodada 0 existe na ESPN. `CAST` de uma fase sem número também dá 0.
    const zero = addMatch({ round: '0', start: BEFORE })
    const loose = addMatch({ round: 'REGULAR_SEASON', start: AFTER })
    addPick('alice', zero, { awarded: 1 })
    addPick('bob', zero, { awarded: 3 })
    addPick('alice', loose, { awarded: 5 })
    setBoard('alice', 6, 0)
    setBoard('bob', 3, 1)

    const body = await standings()

    expect(body.round).toBe('0')
    expect(body.standings.map((s) => s.position_change)).toEqual([0, 0, 0])
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

describe('GET /groups/:id/round-standings com sequência', () => {
  function streaks(body: { standings: { user_id: string; streak: number }[] }) {
    return Object.fromEntries(body.standings.map((s) => [s.user_id, s.streak]))
  }

  it('conta 3 rodadas seguidas e devolve streak em todas as linhas', async () => {
    const { standings, addMatch, addPick } = await createFixture()
    const first = addMatch({ round: '1' })
    const second = addMatch({ round: '2' })
    const third = addMatch({ round: '3' })
    for (const match of [first, second, third]) addPick('alice', match, {})
    for (const match of [second, third]) addPick('bob', match, {})

    const body = await standings()

    expect(body.round).toBe('3')
    expect(body.standings.every((s) => typeof s.streak === 'number')).toBe(true)
    expect(streaks(body)).toEqual({ alice: 3, bob: 2, carol: 0 })
  })

  it('quebra na rodada em que faltou palpite em um dos jogos', async () => {
    const { standings, addMatch, addPick } = await createFixture()
    addPick('alice', addMatch({ round: '1' }), {})
    addPick('alice', addMatch({ round: '2' }), {})
    addMatch({ round: '2' })
    addPick('alice', addMatch({ round: '3' }), {})

    expect(streaks(await standings())).toMatchObject({ alice: 1 })
  })

  it('pula a rodada com jogo remarcado para o futuro, sem contar e sem quebrar', async () => {
    const { standings, addMatch, addPick } = await createFixture()
    addPick('alice', addMatch({ round: '1' }), {})
    addMatch({ round: '2' })
    addMatch({ round: '2', status: 'scheduled', start: LATER })
    addPick('alice', addMatch({ round: '3' }), {})

    const body = await standings()

    expect(body.round).toBe('3')
    expect(streaks(body)).toMatchObject({ alice: 2 })
  })

  it('não exige jogo adiado sem data', async () => {
    const { standings, addMatch, addPick } = await createFixture()
    addPick('alice', addMatch({ round: '1' }), {})
    addMatch({ round: '1', status: 'scheduled', postponed: 1 })

    expect(streaks(await standings())).toMatchObject({ alice: 1 })
  })

  it('não aceita palpite em jogo adiado no lugar de jogo encerrado sem palpite', async () => {
    const { standings, addMatch, addPick } = await createFixture()
    addPick('alice', addMatch({ round: '1' }), {})
    addMatch({ round: '1' })
    addPick('alice', addMatch({ round: '1', status: 'scheduled', postponed: 1 }), {})

    expect(streaks(await standings())).toMatchObject({ alice: 0 })
  })

  it('não exige jogo encerrado sem scored_at, porque a rodada dele segue aberta', async () => {
    const { standings, addMatch, addPick } = await createFixture()
    addPick('alice', addMatch({ round: '1' }), {})
    addMatch({ round: '2' })
    addMatch({ round: '2', unscored: true })
    addPick('alice', addMatch({ round: '3' }), {})

    const body = await standings()

    expect(body.round).toBe('3')
    expect(streaks(body)).toMatchObject({ alice: 2 })
  })

  it('dá 0 a quem não palpitou na referência', async () => {
    const { standings, addMatch, addPick } = await createFixture()
    addPick('alice', addMatch({ round: '1' }), {})
    addMatch({ round: '2' })

    const body = await standings()

    expect(body.round).toBe('2')
    expect(streaks(body)).toEqual({ alice: 0, bob: 0, carol: 0 })
  })

  it('não conta o palpite do mesmo membro em outro grupo', async () => {
    const { sqlite, standings, addMatch, addPick } = await createFixture()
    const match = addMatch({ round: '1' })
    addPick('alice', match, {})
    sqlite.exec(`
      INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code) VALUES
        ('group-b', 'Bolão B', 'comp-a', 'bob', 'CCCC-DDDD');
      INSERT INTO predictions (
        id, user_id, group_id, match_id, predicted_home_score, predicted_away_score
      ) VALUES ('p-bob-b', 'bob', 'group-b', '${match}', 1, 0);
    `)

    expect(streaks(await standings())).toEqual({ alice: 1, bob: 0, carol: 0 })
  })

  it('segue sem linhas quando não há rodada de referência', async () => {
    const { standings, addMatch, addPick } = await createFixture()
    addPick('alice', addMatch({ round: 'REGULAR_SEASON' }), {})

    expect(await standings()).toEqual({ round: null, standings: [] })
  })
})

describe('GET /groups pódio', () => {
  it('desempata por user_id quando pontos, exatos e entrada empatam', async () => {
    const { sqlite, get, addMatch } = await createFixture()
    addMatch({ round: '1' })
    // `aaron` entra por último, para o desempate não coincidir com a ordem de inserção.
    sqlite.exec(`
      INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
        ('aaron', 'aaron@example.com', 'google', 'g-aaron', 'Aaron');
      INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES
        ('gm-aaron', 'group-a', 'aaron', '2026-01-01T00:00:00Z');
      UPDATE group_members SET joined_at = '2026-01-01T00:00:00Z' WHERE group_id = 'group-a';
      INSERT INTO leaderboard (group_id, user_id, total_points, exact_hits, last_updated) VALUES
        ('group-a', 'carol', 5, 1, '2026-06-14T00:00:00Z'),
        ('group-a', 'bob', 5, 1, '2026-06-14T00:00:00Z'),
        ('group-a', 'alice', 5, 1, '2026-06-14T00:00:00Z'),
        ('group-a', 'aaron', 5, 1, '2026-06-14T00:00:00Z');
    `)

    const res = await get('/groups', 'alice')
    const body = (await res.json()) as { groups: { podium: { display: string }[] | null }[] }

    expect(body.groups[0].podium?.map((entry) => entry.display)).toEqual(['Aaron', 'Alice', 'Bob'])
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
