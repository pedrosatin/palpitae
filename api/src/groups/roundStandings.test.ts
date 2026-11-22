/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { flakyD1 } from '../testing/flakyD1'
import { finalScore } from '../testing/matchFixtures'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { MATCH_SCORE_RARITY_COMPUTE_SQL } from './unlikelyExacts'
import {
  backfillMilestoneInserts,
  computeRoundStandings,
  computeStreaks,
  crossedForReference,
  exactMilestonesCrossed,
  highestExactMilestone,
  newMilestoneInserts,
  pickReferenceRound,
  recordExactMilestones,
  thresholdsReached,
  type ExactMilestone,
  type ExactMilestoneRow,
  type MemberRoundPicks,
  type RoundMemberRow,
  type RoundPhaseRow,
} from './roundStandings'

const NO_STREAKS = new Map<string, number>()

function noMilestone(exactHits = 0) {
  return {
    exact_hits: exactHits,
    exact_milestone: null as ExactMilestone | null,
    exact_milestones_crossed: [] as ExactMilestone[],
    unlikely_exact: false,
  }
}

function member(overrides: Partial<RoundMemberRow> & { user_id: string }): RoundMemberRow {
  return {
    joined_at: '2026-01-01T00:00:00Z',
    total_points: 0,
    exact_hits: 0,
    round_points: 0,
    round_exact: 0,
    since_points: overrides.round_points ?? 0,
    since_exact: 0,
    ...overrides,
  }
}

function crossedMap(
  entries: Record<string, ExactMilestone[]>,
): Map<string, ExactMilestone[]> {
  return new Map(Object.entries(entries))
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

    expect(computeRoundStandings(rows, NO_STREAKS)).toEqual([
      { user_id: 'alice', round_points: 3, position_change: 1, streak: 0, ...noMilestone() },
      { user_id: 'bob', round_points: 5, position_change: -1, streak: 0, ...noMilestone() },
    ])
  })

  it('tira do desempate anterior os exatos da rodada posterior', () => {
    const rows = [
      member({ user_id: 'a', total_points: 10, exact_hits: 2, since_points: 4, since_exact: 2 }),
      member({ user_id: 'b', total_points: 10, exact_hits: 1, since_points: 4 }),
    ]

    expect(changes(rows)).toEqual({ a: 1, b: -1 })
  })

  it('mantém 0 pontos de rodada e calcula a variação de quem não palpitou', () => {
    const rows = [
      member({ user_id: 'palpitou', total_points: 12, round_points: 8 }),
      member({ user_id: 'ausente', total_points: 10 }),
    ]

    expect(computeRoundStandings(rows, NO_STREAKS)).toEqual([
      { user_id: 'palpitou', round_points: 8, position_change: 1, streak: 0, ...noMilestone() },
      { user_id: 'ausente', round_points: 0, position_change: -1, streak: 0, ...noMilestone() },
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

  it('marca o maior marco pelo total e o cruzamento pelas linhas da rodada', () => {
    const rows = [
      member({
        user_id: 'cruzou',
        total_points: 20,
        exact_hits: 5,
        round_points: 3,
        round_exact: 1,
        since_points: 3,
        since_exact: 1,
      }),
      member({
        user_id: 'ja-tinha',
        total_points: 18,
        exact_hits: 6,
        round_points: 3,
        round_exact: 1,
        since_points: 3,
        since_exact: 1,
      }),
      member({ user_id: 'zero', total_points: 0 }),
    ]

    const byUser = Object.fromEntries(
      computeRoundStandings(
        rows,
        NO_STREAKS,
        crossedMap({ cruzou: [5], 'ja-tinha': [], zero: [] }),
      ).map((s) => [
        s.user_id,
        { exact_milestone: s.exact_milestone, exact_milestones_crossed: s.exact_milestones_crossed },
      ]),
    )

    expect(byUser).toEqual({
      cruzou: { exact_milestone: 5, exact_milestones_crossed: [5] },
      'ja-tinha': { exact_milestone: 5, exact_milestones_crossed: [] },
      zero: { exact_milestone: null, exact_milestones_crossed: [] },
    })
  })

  it('aceita vários limiares cruzados na mesma leitura', () => {
    const rows = [member({ user_id: 'a', exact_hits: 15 })]

    expect(
      computeRoundStandings(rows, NO_STREAKS, crossedMap({ a: [5, 15] }))[0]
        .exact_milestones_crossed,
    ).toEqual([5, 15])
  })
})

describe('highestExactMilestone, thresholdsReached e exactMilestonesCrossed', () => {
  it('devolve null abaixo de 5 e o maior limiar atingido', () => {
    expect(highestExactMilestone(0)).toBeNull()
    expect(highestExactMilestone(4)).toBeNull()
    expect(highestExactMilestone(5)).toBe(5)
    expect(highestExactMilestone(14)).toBe(5)
    expect(highestExactMilestone(15)).toBe(15)
    expect(highestExactMilestone(29)).toBe(15)
    expect(highestExactMilestone(30)).toBe(30)
    expect(highestExactMilestone(40)).toBe(30)
  })

  it('lista os limiares alcançados pelo total', () => {
    expect(thresholdsReached(0)).toEqual([])
    expect(thresholdsReached(4)).toEqual([])
    expect(thresholdsReached(5)).toEqual([5])
    expect(thresholdsReached(15)).toEqual([5, 15])
    expect(thresholdsReached(30)).toEqual([5, 15, 30])
  })

  it('dispara em 4→5 e não redispara em 5→6; cobre 15 e 30', () => {
    expect(exactMilestonesCrossed(4, 5)).toEqual([5])
    expect(exactMilestonesCrossed(5, 6)).toEqual([])
    expect(exactMilestonesCrossed(9, 10)).toEqual([])
    expect(exactMilestonesCrossed(14, 15)).toEqual([15])
    expect(exactMilestonesCrossed(15, 16)).toEqual([])
    expect(exactMilestonesCrossed(29, 30)).toEqual([30])
    expect(exactMilestonesCrossed(4, 16)).toEqual([5, 15])
    expect(exactMilestonesCrossed(0, 0)).toEqual([])
  })

  it('destaca só linhas cuja round é a referência', () => {
    const rows: ExactMilestoneRow[] = [
      { user_id: 'a', threshold: 5, round: '34' },
      { user_id: 'a', threshold: 15, round: null },
      { user_id: 'b', threshold: 5, round: '33' },
    ]
    expect(crossedForReference(rows, 'a', '34')).toEqual([5])
    expect(crossedForReference(rows, 'a', '33')).toEqual([])
    expect(crossedForReference(rows, 'b', '33')).toEqual([5])
  })

  it('monta backfill e inserções novas sem repetir o que já existe', () => {
    const members = [
      member({ user_id: 'a', exact_hits: 7 }),
      member({ user_id: 'b', exact_hits: 15 }),
      member({ user_id: 'c', exact_hits: 0 }),
    ]
    expect(backfillMilestoneInserts(members)).toEqual([
      { user_id: 'a', threshold: 5 },
      { user_id: 'b', threshold: 5 },
      { user_id: 'b', threshold: 15 },
    ])
    expect(
      newMilestoneInserts(members, [{ user_id: 'b', threshold: 5, round: null }]),
    ).toEqual([
      { user_id: 'a', threshold: 5 },
      { user_id: 'b', threshold: 15 },
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
  /** Instantâneo de pontuação; o padrão é `2026-06-02T00:00:00Z`. */
  scoredAt?: string
}

type Barrier = { ready: Promise<void>; release: () => void }

function createBarrierControl() {
  let pause: { reached: () => void; resume: Promise<void> } | undefined
  function arm(): Barrier {
    let release!: () => void
    let reached!: () => void
    const ready = new Promise<void>((resolve) => {
      reached = resolve
    })
    const resume = new Promise<void>((resolve) => {
      release = resolve
    })
    pause = { reached, resume }
    return { ready, release }
  }
  async function hit() {
    const barrier = pause
    pause = undefined
    if (!barrier) return
    barrier.reached()
    await barrier.resume
  }
  return { arm, hit }
}

/** D1 que pausa depois de adquirir o marcador de inicialização. */
function pauseAfterInitAcquire(db: D1Database, control: ReturnType<typeof createBarrierControl>) {
  return {
    prepare(sql: string) {
      const statement = db.prepare(sql)
      if (!sql.includes('INSERT INTO exact_milestones_initialized')) return statement
      return {
        bind(...values: unknown[]) {
          const bound = statement.bind(...values)
          return {
            ...bound,
            async run() {
              const result = await bound.run()
              await control.hit()
              return result
            },
          }
        },
      }
    },
    batch: db.batch.bind(db),
  } as D1Database
}

/**
 * D1 que pausa na entrada do primeiro `batch`. Em `getRoundStandings` esse
 * lote é a leitura conjunta de fases, membros e palpites.
 */
function pauseBeforeFirstBatch(db: D1Database, control: ReturnType<typeof createBarrierControl>) {
  return {
    prepare: db.prepare.bind(db),
    async batch(statements: Parameters<D1Database['batch']>[0]) {
      await control.hit()
      return db.batch(statements)
    },
  } as D1Database
}

async function createFixture(wrapDb?: (db: D1Database) => D1Database) {
  const { sqlite, db: rawDb } = createSqliteD1()
  handles.push(sqlite)
  const db = wrapDb ? wrapDb(rawDb) : rawDb

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
        exact_milestone: number | null
        exact_milestones_crossed: number[]
        unlikely_exact: boolean
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
           start_time, status, round, phase, postponed, scored_at, home_score, away_score
         ) VALUES (?, ?, ?, 'football-data', 'fla', 'pal', ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        status === 'finished' && !seed.unscored
          ? (seed.scoredAt ?? '2026-06-02T00:00:00Z')
          : null,
        ...finalScore(status),
      )
    return id
  }

  function setScoredAt(matchId: string, scoredAt: string | null) {
    sqlite.prepare(`UPDATE matches SET scored_at = ? WHERE id = ?`).run(scoredAt, matchId)
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
         VALUES ('group-a', ?, ?, ?, '2026-06-14T00:00:00Z')
         ON CONFLICT (group_id, user_id) DO UPDATE SET
           total_points = excluded.total_points,
           exact_hits = excluded.exact_hits,
           last_updated = excluded.last_updated`,
      )
      .run(user, total, exact)
  }

  return { sqlite, db, get, standings, addMatch, addPick, setBoard, setScoredAt }
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

  it('não bloqueia com REGULAR_SEASON de fase não eliminatória depois da rodada 34', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '21', start: BEFORE })
    addMatch({ round: '34', start: ROUND_START })
    addMatch({ round: 'REGULAR_SEASON', phase: 'REGULAR_SEASON', start: AFTER })

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
        { user_id: 'bob', round_points: 3, position_change: 1, streak: 2, ...noMilestone(1) },
        { user_id: 'alice', round_points: 0, position_change: -1, streak: 0, ...noMilestone(1) },
        { user_id: 'carol', round_points: 0, position_change: 0, streak: 0, ...noMilestone() },
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
        { user_id: 'alice', round_points: 1, position_change: 1, streak: 2, ...noMilestone() },
        { user_id: 'bob', round_points: 0, position_change: -1, streak: 0, ...noMilestone() },
        { user_id: 'carol', round_points: 0, position_change: 0, streak: 0, ...noMilestone() },
      ],
    })
  })

  it('tira do desempate anterior os exatos da rodada seguinte', async () => {
    const { standings, addMatch, addPick, setBoard } = await createFixture()
    const earlier = addMatch({ round: '1', start: BEFORE })
    const reference = addMatch({ round: '2', start: ROUND_START })
    const next = addMatch({ round: '3', start: AFTER })
    addMatch({ round: '3', status: 'scheduled', start: LATER })
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

  it('grupo novo sem exatos inicializa sem destaque e destaca o 5 depois', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    addMatch({ round: '1' })

    const first = await standings()
    expect(first.round).toBe('1')
    expect(
      first.standings.every(
        (s) => s.exact_milestone === null && s.exact_milestones_crossed.length === 0,
      ),
    ).toBe(true)
    expect(
      sqlite
        .prepare(`SELECT 1 AS ok FROM exact_milestones_initialized WHERE group_id = 'group-a'`)
        .get(),
    ).toEqual({ ok: 1 })
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM exact_milestones WHERE group_id = 'group-a'`).get(),
    ).toEqual({ n: 0 })

    const hits = [1, 2, 3, 4, 5].map((i) =>
      addMatch({ round: '2', start: ROUND_START, scoredAt: `2026-05-02T0${i}:00:00Z` }),
    )
    for (const match of hits) addPick('alice', match, { awarded: 3 })
    setBoard('alice', 15, 5)

    const crossed = await standings()
    expect(crossed.round).toBe('2')
    expect(crossed.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [5],
    })
    expect(
      sqlite
        .prepare(
          `SELECT threshold, round FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice' ORDER BY threshold`,
        )
        .all(),
    ).toEqual([{ threshold: 5, round: '2' }])
  })

  it('grupo antigo na primeira leitura faz backfill sem destaque', async () => {
    const { sqlite, standings, addMatch, setBoard } = await createFixture()
    addMatch({ round: '1' })
    setBoard('alice', 21, 7)

    const body = await standings()
    expect(body.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [],
    })
    expect(
      sqlite
        .prepare(
          `SELECT threshold, round FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice'`,
        )
        .all(),
    ).toEqual([{ threshold: 5, round: null }])
  })

  it('grava o marco na rodada observada, mantém o destaque nela e some na seguinte', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const prior = [1, 2, 3, 4].map(() =>
      addMatch({ round: '1', start: BEFORE, scoredAt: '2026-04-02T00:00:00Z' }),
    )
    for (const match of prior) addPick('alice', match, { awarded: 3 })
    setBoard('alice', 12, 4)
    await standings()

    const fifth = addMatch({
      round: '2',
      start: ROUND_START,
      scoredAt: '2026-05-02T00:00:00Z',
    })
    addPick('alice', fifth, { awarded: 3 })
    setBoard('alice', 15, 5)

    const crossed = await standings()
    expect(crossed.round).toBe('2')
    expect(crossed.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [5],
    })

    const again = await standings()
    expect(again.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestones_crossed: [5],
    })
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice' AND threshold = 5`,
        )
        .get(),
    ).toEqual({ n: 1 })

    const sixth = addMatch({
      round: '3',
      start: AFTER,
      scoredAt: '2026-06-02T00:00:00Z',
    })
    addPick('alice', sixth, { awarded: 3 })
    sqlite
      .prepare(
        `UPDATE leaderboard SET total_points = 18, exact_hits = 6
         WHERE group_id = 'group-a' AND user_id = 'alice'`,
      )
      .run()

    const next = await standings()
    expect(next.round).toBe('3')
    expect(next.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [],
    })
  })

  it('membro sozinho no grupo recebe o marco normalmente', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    sqlite.exec(`DELETE FROM group_members WHERE user_id IN ('bob', 'carol')`)
    addMatch({ round: '1' })
    await standings()

    const hits = [1, 2, 3, 4, 5].map((i) =>
      addMatch({ round: '2', start: ROUND_START, scoredAt: `2026-05-02T0${i}:00:00Z` }),
    )
    for (const match of hits) addPick('alice', match, { awarded: 3 })
    setBoard('alice', 15, 5)

    const body = await standings()
    expect(body.standings).toHaveLength(1)
    expect(body.standings[0]).toMatchObject({
      user_id: 'alice',
      exact_milestone: 5,
      exact_milestones_crossed: [5],
    })
  })

  it('marca o cruzamento de 15 e de 30 placares exatos', async () => {
    const { standings, addMatch, setBoard } = await createFixture()
    addMatch({ round: '1' })
    await standings()
    setBoard('alice', 45, 15)
    addMatch({ round: '2', start: ROUND_START })

    expect((await standings()).standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 15,
      exact_milestones_crossed: [5, 15],
    })

    const { standings: standings30, addMatch: add30, setBoard: set30 } = await createFixture()
    add30({ round: '1' })
    await standings30()
    set30('alice', 90, 30)
    add30({ round: '2', start: ROUND_START })

    expect((await standings30()).standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 30,
      exact_milestones_crossed: [5, 15, 30],
    })
  })

  it('exato pontuado entre rodadas destaca na próxima referência lida', async () => {
    const { standings, addMatch, addPick, setBoard } = await createFixture()
    const prior = [1, 2, 3, 4].map(() =>
      addMatch({ round: '33', start: BEFORE, scoredAt: '2026-03-02T00:00:00Z' }),
    )
    for (const match of prior) addPick('alice', match, { awarded: 3 })
    addMatch({ round: '34', start: ROUND_START, scoredAt: '2026-05-01T20:00:00Z' })
    setBoard('alice', 12, 4)

    const before = await standings()
    expect(before.round).toBe('34')
    expect(before.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: null,
      exact_milestones_crossed: [],
    })

    const late = addMatch({
      round: '33',
      start: BEFORE,
      scoredAt: '2026-05-10T12:00:00Z',
    })
    addPick('alice', late, { awarded: 3 })
    setBoard('alice', 15, 5)

    const on34 = await standings()
    expect(on34.round).toBe('34')
    expect(on34.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [5],
    })
  })

  it('exato entre o fechamento da 34 e a leitura da 35 destaca na 35', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const prior = [1, 2, 3, 4].map(() =>
      addMatch({ round: '33', start: BEFORE, scoredAt: '2026-03-02T00:00:00Z' }),
    )
    for (const match of prior) addPick('alice', match, { awarded: 3 })
    addMatch({ round: '34', start: ROUND_START, scoredAt: '2026-05-01T20:00:00Z' })
    setBoard('alice', 12, 4)
    await standings()

    const late = addMatch({
      round: '33',
      start: BEFORE,
      scoredAt: '2026-05-10T12:00:00Z',
    })
    addPick('alice', late, { awarded: 3 })
    sqlite
      .prepare(
        `UPDATE leaderboard SET total_points = 15, exact_hits = 5
         WHERE group_id = 'group-a' AND user_id = 'alice'`,
      )
      .run()
    addMatch({ round: '35', start: AFTER, scoredAt: '2026-06-02T00:00:00Z' })

    const body = await standings()
    expect(body.round).toBe('35')
    expect(body.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [5],
    })
    expect(
      sqlite
        .prepare(
          `SELECT round FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice' AND threshold = 5`,
        )
        .get(),
    ).toEqual({ round: '35' })
  })

  it('repontuação que muda scored_at não redispara o cruzamento', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard, setScoredAt } = await createFixture()
    const prior = [1, 2, 3, 4].map(() =>
      addMatch({ round: '1', start: BEFORE, scoredAt: '2026-04-02T00:00:00Z' }),
    )
    for (const match of prior) addPick('alice', match, { awarded: 3 })
    setBoard('alice', 12, 4)
    await standings()

    const fifth = addMatch({
      round: '2',
      start: ROUND_START,
      scoredAt: '2026-05-02T00:00:00Z',
    })
    addPick('alice', fifth, { awarded: 3 })
    setBoard('alice', 15, 5)

    expect((await standings()).standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestones_crossed: [5],
    })

    setScoredAt(fifth, '2026-05-03T00:00:00Z')
    expect((await standings()).standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [5],
    })
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice' AND threshold = 5`,
        )
        .get(),
    ).toEqual({ n: 1 })

    const sixth = addMatch({
      round: '3',
      start: AFTER,
      scoredAt: '2026-06-02T00:00:00Z',
    })
    addPick('alice', sixth, { awarded: 3 })
    sqlite
      .prepare(
        `UPDATE leaderboard SET total_points = 18, exact_hits = 6
         WHERE group_id = 'group-a' AND user_id = 'alice'`,
      )
      .run()

    expect((await standings()).standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [],
    })
  })

  it('4 para 15 numa leitura grava e destaca os dois; a seguinte não redispara', async () => {
    const { sqlite, standings, addMatch, setBoard } = await createFixture()
    addMatch({ round: '1' })
    setBoard('alice', 12, 4)
    await standings()

    setBoard('alice', 45, 15)
    addMatch({ round: '2', start: ROUND_START })

    const crossed = await standings()
    expect(crossed.round).toBe('2')
    expect(crossed.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 15,
      exact_milestones_crossed: [5, 15],
    })
    expect(
      sqlite
        .prepare(
          `SELECT threshold, round FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice' ORDER BY threshold`,
        )
        .all(),
    ).toEqual([
      { threshold: 5, round: '2' },
      { threshold: 15, round: '2' },
    ])

    setBoard('alice', 48, 16)
    addMatch({ round: '3', start: AFTER })
    expect((await standings()).standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 15,
      exact_milestones_crossed: [],
    })
  })

  it('duas gravações concorrentes do mesmo marco ficam com uma linha só', async () => {
    const { standings, addMatch, setBoard, sqlite } = await createFixture()
    addMatch({ round: '1' })
    await standings()
    setBoard('alice', 15, 5)
    addMatch({ round: '2', start: ROUND_START })

    // Simula duas leituras que tentam gravar o mesmo limiar com rodadas diferentes.
    // A chave primária e o DO NOTHING preservam a primeira; a releitura decide o destaque.
    sqlite
      .prepare(
        `INSERT INTO exact_milestones (group_id, user_id, threshold, round)
         VALUES ('group-a', 'alice', 5, '34')
         ON CONFLICT (group_id, user_id, threshold) DO NOTHING`,
      )
      .run()
    sqlite
      .prepare(
        `INSERT INTO exact_milestones (group_id, user_id, threshold, round)
         VALUES ('group-a', 'alice', 5, '35')
         ON CONFLICT (group_id, user_id, threshold) DO NOTHING`,
      )
      .run()
    expect(
      sqlite
        .prepare(
          `SELECT threshold, round FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice' AND threshold = 5`,
        )
        .all(),
    ).toEqual([{ threshold: 5, round: '34' }])

    const body = await standings()
    expect(body.round).toBe('2')
    expect(body.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [],
    })
  })

  it('sem rodada de referência não grava marco', async () => {
    const { sqlite, standings, addMatch, setBoard } = await createFixture()
    addMatch({ round: '8', start: ROUND_START })
    addMatch({ round: 'LAST_16', start: AFTER })
    setBoard('alice', 15, 5)

    expect(await standings()).toEqual({ round: null, standings: [] })
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM exact_milestones WHERE group_id = 'group-a'`).get(),
    ).toEqual({ n: 0 })
    expect(
      sqlite
        .prepare(`SELECT COUNT(*) AS n FROM exact_milestones_initialized WHERE group_id = 'group-a'`)
        .get(),
    ).toEqual({ n: 0 })
  })

  it('exclusão de conta e de grupo apagam as linhas de marcos', async () => {
    const { sqlite, standings, addMatch, setBoard } = await createFixture()
    addMatch({ round: '1' })
    await standings()
    // bob não é dono: a exclusão de conta do dono exige transferência (ADR-026).
    setBoard('bob', 15, 5)
    addMatch({ round: '2', start: ROUND_START })
    await standings()

    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'bob'`,
        )
        .get(),
    ).toEqual({ n: 1 })

    sqlite.exec(`DELETE FROM users WHERE id = 'bob'`)
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'bob'`,
        )
        .get(),
    ).toEqual({ n: 0 })

    const { sqlite: sqlite2, standings: standings2, addMatch: add2, setBoard: set2 } =
      await createFixture()
    add2({ round: '1' })
    await standings2()
    set2('carol', 15, 5)
    add2({ round: '2', start: ROUND_START })
    await standings2()
    expect(
      sqlite2
        .prepare(`SELECT COUNT(*) AS n FROM exact_milestones_initialized WHERE group_id = 'group-a'`)
        .get(),
    ).toEqual({ n: 1 })

    sqlite2.exec(`DELETE FROM groups WHERE id = 'group-a'`)
    expect(
      sqlite2.prepare(`SELECT COUNT(*) AS n FROM exact_milestones WHERE group_id = 'group-a'`).get(),
    ).toEqual({ n: 0 })
    expect(
      sqlite2
        .prepare(`SELECT COUNT(*) AS n FROM exact_milestones_initialized WHERE group_id = 'group-a'`)
        .get(),
    ).toEqual({ n: 0 })
  })

  it('inicialização concorrente: quem perde o marcador grava o marco com a rodada', async () => {
    const control = createBarrierControl()
    const { sqlite, db, addMatch } = await createFixture((raw) =>
      pauseAfterInitAcquire(raw, control),
    )
    addMatch({ round: '1' })
    const membersZero = [
      member({ user_id: 'alice', exact_hits: 0 }),
      member({ user_id: 'bob', exact_hits: 0 }),
      member({ user_id: 'carol', exact_hits: 0 }),
    ]
    const membersFive = [
      member({ user_id: 'alice', exact_hits: 5 }),
      member({ user_id: 'bob', exact_hits: 0 }),
      member({ user_id: 'carol', exact_hits: 0 }),
    ]

    const gate = control.arm()
    const first = recordExactMilestones(db, 'group-a', '1', membersZero)
    await gate.ready
    const second = await recordExactMilestones(db, 'group-a', '1', membersFive)
    gate.release()
    await first

    expect(second.get('alice')).toEqual([5])
    expect(
      sqlite
        .prepare(
          `SELECT threshold, round FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice'`,
        )
        .all(),
    ).toEqual([{ threshold: 5, round: '1' }])
  })

  it('falha na primeira inicialização responde 200 e a leitura seguinte grava', async () => {
    let failInit = true
    const { sqlite, standings, addMatch, setBoard } = await createFixture((raw) =>
      flakyD1(raw, {
        failStatement: (sql) => {
          if (!failInit) return false
          if (!sql.includes('INSERT INTO exact_milestones_initialized')) return false
          failInit = false
          return true
        },
      }),
    )
    addMatch({ round: '1' })
    setBoard('alice', 15, 5)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const failed = await standings()
    expect(failed.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [],
    })
    expect(
      sqlite
        .prepare(`SELECT COUNT(*) AS n FROM exact_milestones_initialized WHERE group_id = 'group-a'`)
        .get(),
    ).toEqual({ n: 0 })
    expect(error).toHaveBeenCalled()
    error.mockRestore()

    const ok = await standings()
    expect(ok.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [],
    })
    expect(
      sqlite
        .prepare(
          `SELECT threshold, round FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice'`,
        )
        .all(),
    ).toEqual([{ threshold: 5, round: null }])
  })

  it('falha no backfill libera o marcador e a leitura seguinte reinicializa', async () => {
    let failBackfill = true
    const { sqlite, standings, addMatch, setBoard } = await createFixture((raw) =>
      flakyD1(raw, {
        failBatch: (sqls) => {
          if (!failBackfill) return false
          if (!sqls.some((sql) => sql.includes('INSERT INTO exact_milestones'))) return false
          failBackfill = false
          return true
        },
      }),
    )
    addMatch({ round: '1' })
    setBoard('alice', 15, 5)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const failed = await standings()
    expect(failed.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestones_crossed: [],
    })
    expect(
      sqlite
        .prepare(`SELECT COUNT(*) AS n FROM exact_milestones_initialized WHERE group_id = 'group-a'`)
        .get(),
    ).toEqual({ n: 0 })
    expect(error).toHaveBeenCalled()
    error.mockRestore()

    const ok = await standings()
    expect(
      sqlite
        .prepare(
          `SELECT threshold, round FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice'`,
        )
        .all(),
    ).toEqual([{ threshold: 5, round: null }])
    expect(ok.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestones_crossed: [],
    })
  })

  it('falha ao gravar marco posterior responde 200 e a leitura seguinte grava', async () => {
    let failMilestone = false
    const { sqlite, standings, addMatch, setBoard } = await createFixture((raw) =>
      flakyD1(raw, {
        failBatch: (sqls) => {
          if (!failMilestone) return false
          if (!sqls.some((sql) => sql.includes('INSERT INTO exact_milestones'))) return false
          failMilestone = false
          return true
        },
      }),
    )
    addMatch({ round: '1' })
    await standings()
    setBoard('alice', 15, 5)
    addMatch({ round: '2', start: ROUND_START })
    failMilestone = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const failed = await standings()
    expect(failed.round).toBe('2')
    expect(failed.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [],
    })
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice'`,
        )
        .get(),
    ).toEqual({ n: 0 })
    expect(error).toHaveBeenCalled()
    error.mockRestore()

    const ok = await standings()
    expect(ok.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [5],
    })
    expect(
      sqlite
        .prepare(
          `SELECT threshold, round FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice'`,
        )
        .all(),
    ).toEqual([{ threshold: 5, round: '2' }])
  })

  it('leitura conjunta de fases e membros usa a referência do mesmo snapshot', async () => {
    const control = createBarrierControl()
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture((raw) =>
      pauseBeforeFirstBatch(raw, control),
    )
    const prior = [1, 2, 3, 4].map(() =>
      addMatch({ round: '33', start: BEFORE, scoredAt: '2026-03-02T00:00:00Z' }),
    )
    for (const match of prior) addPick('alice', match, { awarded: 3 })
    addMatch({ round: '34', start: ROUND_START, scoredAt: '2026-05-01T20:00:00Z' })
    setBoard('alice', 12, 4)
    await standings()

    const gate = control.arm()
    const pending = standings()
    await gate.ready
    const late = addMatch({
      round: '33',
      start: BEFORE,
      scoredAt: '2026-05-10T12:00:00Z',
    })
    addPick('alice', late, { awarded: 3 })
    setBoard('alice', 15, 5)
    addMatch({ round: '35', start: AFTER, scoredAt: '2026-06-02T00:00:00Z' })
    gate.release()

    const body = await pending
    expect(body.round).toBe('35')
    expect(body.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [5],
    })
    expect(
      sqlite
        .prepare(
          `SELECT round FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice' AND threshold = 5`,
        )
        .get(),
    ).toEqual({ round: '35' })
  })

  it('membro que sai e volta ao grupo mantém o registro do marco', async () => {
    const { sqlite, standings, addMatch, setBoard } = await createFixture()
    addMatch({ round: '1' })
    await standings()
    setBoard('bob', 15, 5)
    addMatch({ round: '2', start: ROUND_START })
    await standings()

    sqlite.exec(`DELETE FROM group_members WHERE user_id = 'bob' AND group_id = 'group-a'`)
    expect(
      sqlite
        .prepare(
          `SELECT threshold, round FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'bob'`,
        )
        .all(),
    ).toEqual([{ threshold: 5, round: '2' }])

    sqlite
      .prepare(
        `INSERT INTO group_members (id, group_id, user_id, joined_at)
         VALUES ('gm-bob-2', 'group-a', 'bob', '2026-07-01T00:00:00Z')`,
      )
      .run()

    const body = await standings()
    expect(body.standings.find((s) => s.user_id === 'bob')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [5],
    })
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'bob' AND threshold = 5`,
        )
        .get(),
    ).toEqual({ n: 1 })
  })

  it('correção de placar que tira e devolve o exato não recria nem muda a rodada', async () => {
    const { sqlite, standings, addMatch, setBoard } = await createFixture()
    addMatch({ round: '1' })
    await standings()
    setBoard('alice', 15, 5)
    addMatch({ round: '2', start: ROUND_START })
    await standings()

    setBoard('alice', 12, 4)
    expect((await standings()).standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: null,
      exact_milestones_crossed: [5],
    })

    setBoard('alice', 15, 5)
    expect((await standings()).standings.find((s) => s.user_id === 'alice')).toMatchObject({
      exact_milestone: 5,
      exact_milestones_crossed: [5],
    })
    expect(
      sqlite
        .prepare(
          `SELECT threshold, round FROM exact_milestones
           WHERE group_id = 'group-a' AND user_id = 'alice'`,
        )
        .all(),
    ).toEqual([{ threshold: 5, round: '2' }])
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

describe('GET /groups/:id/round-standings placar improvável', () => {
  /** Cria N usuários e um grupo cada, com palpite no jogo (placar 0x0 = errado por padrão). */
  function seedCompetitionTipsters(
    sqlite: DatabaseSync,
    matchId: string,
    count: number,
    opts?: { exactUsers?: string[]; home?: number; away?: number },
  ) {
    const exactUsers = new Set(opts?.exactUsers ?? [])
    const home = opts?.home ?? 0
    const away = opts?.away ?? 0
    for (let i = 0; i < count; i++) {
      const userId = `tip-${i}`
      const groupId = `g-tip-${i}`
      const predictedHome = exactUsers.has(userId) ? 1 : home
      const predictedAway = exactUsers.has(userId) ? 0 : away
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO users (id, email, provider, provider_id, user_name)
           VALUES (?, ?, 'google', ?, ?)`,
        )
        .run(userId, `${userId}@example.com`, `g-${userId}`, userId)
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO groups (id, name, competition_id, owner_user_id, invite_code)
           VALUES (?, ?, 'comp-a', ?, ?)`,
        )
        .run(groupId, `Grupo ${i}`, userId, `CODE${String(i).padStart(4, '0')}`)
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO group_members (id, group_id, user_id, joined_at)
           VALUES (?, ?, ?, '2026-01-01T00:00:00Z')`,
        )
        .run(`gm-${userId}`, groupId, userId)
      sqlite
        .prepare(
          `INSERT INTO predictions (
             id, user_id, group_id, match_id, predicted_home_score, predicted_away_score,
             points_awarded
           ) VALUES (?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(`p-${userId}-${matchId}`, userId, groupId, matchId, predictedHome, predictedAway)
    }
  }

  it('marca placar raro no limiar de 10% (2/20 com 10 de fora)', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 18)
    addPick('alice', match, { awarded: 3 })
    addPick('bob', match, { awarded: 3 })
    setBoard('alice', 3, 1)
    setBoard('bob', 3, 1)

    const body = await standings()
    expect(body.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      unlikely_exact: true,
    })
    expect(body.standings.find((s) => s.user_id === 'bob')).toMatchObject({
      unlikely_exact: true,
    })
  })

  it('não marca quando a fração passa de 10% com massa de fora', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 17, { exactUsers: ['tip-0'] })
    addPick('alice', match, { awarded: 3 })
    addPick('bob', match, { awarded: 3 })
    setBoard('alice', 3, 1)
    setBoard('bob', 3, 1)

    const body = await standings()
    expect(body.standings.every((s) => s.unlikely_exact === false)).toBe(true)
  })

  it('não marca abaixo do mínimo de 10 palpiteiros', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 5)
    addPick('alice', match, { awarded: 3 })
    setBoard('alice', 3, 1)

    const body = await standings()
    expect(body.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      unlikely_exact: false,
    })
  })

  it('empate no raro: todos que cravaram recebem o reconhecimento', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 18)
    addPick('alice', match, { awarded: 3 })
    addPick('bob', match, { awarded: 3 })
    setBoard('alice', 3, 1)
    setBoard('bob', 3, 1)

    const body = await standings()
    expect(body.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      unlikely_exact: true,
    })
    expect(body.standings.find((s) => s.user_id === 'bob')).toMatchObject({
      unlikely_exact: true,
    })
  })

  it('mesmo usuário em dois grupos conta uma vez no denominador', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 10)
    addPick('alice', match, { awarded: 3 })
    setBoard('alice', 3, 1)

    sqlite.exec(`
      INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code)
      VALUES ('group-b', 'Bolão B', 'comp-a', 'alice', 'BBBB-CCCC');
      INSERT INTO group_members (id, group_id, user_id, joined_at)
      VALUES ('gm-alice-b', 'group-b', 'alice', '2026-01-01T00:00:00Z');
      INSERT INTO predictions (
        id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded
      ) VALUES ('p-alice-b', 'alice', 'group-b', '${match}', 1, 0, 3);
    `)

    const body = await standings()
    expect(body.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      unlikely_exact: true,
    })
    expect(
      sqlite
        .prepare(
          `SELECT tipster_count FROM unlikely_exacts
           WHERE group_id = 'group-a' AND user_id = 'alice' AND match_id = ?`,
        )
        .get(match),
    ).toEqual({ tipster_count: 11 })
  })

  it('grupo solo recebe o selo quando a competição tem massa', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    sqlite.exec(`DELETE FROM group_members WHERE user_id IN ('bob', 'carol')`)
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 10)
    addPick('alice', match, { awarded: 3 })
    setBoard('alice', 3, 1)

    const body = await standings()
    expect(body.standings).toHaveLength(1)
    expect(body.standings[0]).toMatchObject({
      unlikely_exact: true,
    })
  })

  it('jogo sem ninguém com exato não gera selo', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 10)
    addPick('alice', match, { awarded: 1 })
    sqlite
      .prepare(
        `UPDATE predictions SET predicted_home_score = 0, predicted_away_score = 0, points_awarded = 1
         WHERE user_id = 'alice' AND match_id = ?`,
      )
      .run(match)
    setBoard('alice', 1, 0)

    const body = await standings()
    expect(body.standings.every((s) => s.unlikely_exact === false)).toBe(true)
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM unlikely_exacts WHERE group_id = 'group-a'`).get(),
    ).toEqual({ n: 0 })
  })

  it('releitura da mesma rodada mantém o selo e não duplica a linha', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 10)
    addPick('alice', match, { awarded: 3 })
    setBoard('alice', 3, 1)

    const first = await standings()
    const second = await standings()
    expect(first.standings.find((s) => s.user_id === 'alice')?.unlikely_exact).toBe(true)
    expect(second.standings.find((s) => s.user_id === 'alice')?.unlikely_exact).toBe(true)
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM unlikely_exacts
           WHERE group_id = 'group-a' AND user_id = 'alice'`,
        )
        .get(),
    ).toEqual({ n: 1 })
  })

  it('não redispara o selo numa rodada seguinte após correção de placar', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const first = addMatch({ round: '1', start: BEFORE, scoredAt: '2026-04-02T00:00:00Z' })
    seedCompetitionTipsters(sqlite, first, 10)
    addPick('alice', first, { awarded: 3 })
    setBoard('alice', 3, 1)
    await standings()

    const second = addMatch({ round: '2', start: ROUND_START, scoredAt: '2026-05-02T00:00:00Z' })
    seedCompetitionTipsters(sqlite, second, 10)
    addPick('alice', second, { awarded: 0 })
    sqlite
      .prepare(
        `UPDATE predictions SET predicted_home_score = 0, predicted_away_score = 0, points_awarded = 0
         WHERE user_id = 'alice' AND match_id = ?`,
      )
      .run(second)
    setBoard('alice', 3, 1)

    const next = await standings()
    expect(next.round).toBe('2')
    expect(next.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      unlikely_exact: false,
    })

    sqlite.prepare(`UPDATE matches SET home_score = 2, away_score = 2 WHERE id = ?`).run(first)
    const afterFix = await standings()
    expect(afterFix.round).toBe('2')
    expect(afterFix.standings.find((s) => s.user_id === 'alice')?.unlikely_exact).toBe(false)
    expect(
      sqlite
        .prepare(
          `SELECT round FROM unlikely_exacts
           WHERE group_id = 'group-a' AND user_id = 'alice' ORDER BY round`,
        )
        .all(),
    ).toEqual([{ round: '1' }])
  })

  it('mata-mata sem rodada de referência não inventa selo', async () => {
    const { standings, addMatch } = await createFixture()
    addMatch({ round: '8', start: ROUND_START })
    addMatch({ round: 'LAST_16', start: AFTER })

    expect(await standings()).toEqual({ round: null, standings: [] })
  })

  it('falha de gravação não derruba o GET', async () => {
    let failInsert = true
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture((raw) =>
      flakyD1(raw, {
        failBatch: (sqls) => {
          if (!failInsert) return false
          if (!sqls.some((sql) => sql.includes('INSERT INTO unlikely_exacts'))) return false
          failInsert = false
          return true
        },
      }),
    )
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 10)
    addPick('alice', match, { awarded: 3 })
    setBoard('alice', 3, 1)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const body = await standings()
    expect(body.round).toBe('1')
    expect(body.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      unlikely_exact: false,
    })
    expect(error).toHaveBeenCalled()
    error.mockRestore()

    const recovered = await standings()
    expect(recovered.standings.find((s) => s.user_id === 'alice')).toMatchObject({
      unlikely_exact: true,
    })
  })

  it('não reconhece com 19 tipsters no grupo e 1 de fora (privacidade)', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 1)
    for (let i = 0; i < 18; i++) {
      const userId = `in-${i}`
      sqlite
        .prepare(
          `INSERT INTO users (id, email, provider, provider_id, user_name)
           VALUES (?, ?, 'google', ?, ?)`,
        )
        .run(userId, `${userId}@example.com`, `g-${userId}`, userId)
      sqlite
        .prepare(
          `INSERT INTO group_members (id, group_id, user_id, joined_at)
           VALUES (?, 'group-a', ?, '2026-01-01T00:00:00Z')`,
        )
        .run(`gm-${userId}`, userId)
      sqlite
        .prepare(
          `INSERT INTO predictions (
             id, user_id, group_id, match_id, predicted_home_score, predicted_away_score,
             points_awarded
           ) VALUES (?, ?, 'group-a', ?, 0, 0, 0)`,
        )
        .run(`p-${userId}-${match}`, userId, match)
    }
    addPick('alice', match, { awarded: 3 })
    setBoard('alice', 3, 1)

    const body = await standings()
    expect(body.standings.find((s) => s.user_id === 'alice')?.unlikely_exact).toBe(false)
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM unlikely_exacts WHERE group_id = 'group-a'`).get(),
    ).toEqual({ n: 0 })
  })

  it('não reconhece com 9 tipsters fora do grupo no limiar de raridade', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 9)
    addPick('alice', match, { awarded: 3 })
    setBoard('alice', 3, 1)

    const body = await standings()
    expect(body.standings.find((s) => s.user_id === 'alice')?.unlikely_exact).toBe(false)
  })

  it('reconhece no limiar de 10 tipsters fora do grupo', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 10)
    addPick('alice', match, { awarded: 3 })
    setBoard('alice', 3, 1)

    const body = await standings()
    expect(body.standings.find((s) => s.user_id === 'alice')?.unlikely_exact).toBe(true)
    expect(
      sqlite
        .prepare(
          `SELECT outside_tipster_count FROM unlikely_exacts
           WHERE group_id = 'group-a' AND user_id = 'alice' AND match_id = ?`,
        )
        .get(match),
    ).toEqual({ outside_tipster_count: 10 })
  })

  it('reusa match_score_rarity na segunda leitura da mesma rodada', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 10)
    addPick('alice', match, { awarded: 3 })
    setBoard('alice', 3, 1)

    await standings()
    const first = sqlite
      .prepare(
        `SELECT tipster_count, exact_count, scored_at_snapshot, status FROM match_score_rarity WHERE match_id = ?`,
      )
      .get(match) as {
      tipster_count: number
      exact_count: number
      scored_at_snapshot: string
      status: string
    }
    expect(first.tipster_count).toBe(11)
    expect(first.exact_count).toBe(1)
    expect(first.status).toBe('ready')

    await standings()
    const second = sqlite
      .prepare(
        `SELECT tipster_count, exact_count, scored_at_snapshot, status FROM match_score_rarity WHERE match_id = ?`,
      )
      .get(match)
    expect(second).toEqual(first)
  })

  it('50 leituras concorrentes calculam o agregado uma vez por jogo', async () => {
    let computes = 0
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture((raw) => {
      return new Proxy(raw, {
        get(target, prop, receiver) {
          if (prop === 'prepare') {
            return (sql: string) => {
              const stmt = target.prepare(sql)
              if (sql !== MATCH_SCORE_RARITY_COMPUTE_SQL) return stmt
              return new Proxy(stmt, {
                get(sTarget, sProp) {
                  const value: unknown = Reflect.get(sTarget, sProp, sTarget)
                  if (typeof value !== 'function') return value
                  if (sProp === 'bind') {
                    return (...args: unknown[]) => {
                      const bound = (value as (...a: unknown[]) => D1PreparedStatement).apply(
                        sTarget,
                        args,
                      )
                      return new Proxy(bound, {
                        get(bTarget, bProp) {
                          const bVal: unknown = Reflect.get(bTarget, bProp, bTarget)
                          if (typeof bVal !== 'function') return bVal
                          if (bProp === 'first' || bProp === 'all') {
                            return async (...a: unknown[]) => {
                              computes += 1
                              return (bVal as (...x: unknown[]) => unknown).apply(bTarget, a)
                            }
                          }
                          return bVal.bind(bTarget)
                        },
                      })
                    }
                  }
                  return value.bind(sTarget)
                },
              })
            }
          }
          const value: unknown = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      }) as D1Database
    })
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 10)
    addPick('alice', match, { awarded: 3 })
    setBoard('alice', 3, 1)

    await Promise.all(Array.from({ length: 50 }, () => standings()))
    expect(computes).toBe(1)
    expect(
      sqlite
        .prepare(`SELECT status, tipster_count FROM match_score_rarity WHERE match_id = ?`)
        .get(match),
    ).toEqual({ status: 'ready', tipster_count: 11 })
  })

  it('retoma reserva computing expirada e grava o agregado', async () => {
    const { sqlite, standings, addMatch, addPick, setBoard } = await createFixture()
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 10)
    addPick('alice', match, { awarded: 3 })
    setBoard('alice', 3, 1)
    sqlite
      .prepare(
        `INSERT INTO match_score_rarity (
           match_id, tipster_count, exact_count, scored_at_snapshot, computed_at, status
         ) VALUES (?, 0, 0, '2026-06-02T00:00:00Z', datetime('now', '-120 seconds'), 'computing')`,
      )
      .run(match)

    const body = await standings()
    expect(body.standings.find((s) => s.user_id === 'alice')?.unlikely_exact).toBe(true)
    expect(
      sqlite
        .prepare(`SELECT status, tipster_count, exact_count FROM match_score_rarity WHERE match_id = ?`)
        .get(match),
    ).toEqual({ status: 'ready', tipster_count: 11, exact_count: 1 })
  })

  it('falha do commit do agregado não derruba o GET e mantém reconhecimentos gravados', async () => {
    let failCommit = false
    const { sqlite, standings, addMatch, addPick, setBoard, setScoredAt } = await createFixture(
      (raw) =>
        flakyD1(raw, {
          failStatement: (sql) => failCommit && sql.includes('UPDATE match_score_rarity SET'),
        }),
    )
    const match = addMatch({ round: '1' })
    seedCompetitionTipsters(sqlite, match, 10)
    addPick('alice', match, { awarded: 3 })
    setBoard('alice', 3, 1)
    await standings()
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM unlikely_exacts WHERE group_id = 'group-a'`).get(),
    ).toEqual({ n: 1 })

    failCommit = true
    setScoredAt(match, '2026-06-03T00:00:00Z')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const body = await standings()
    expect(body.round).toBe('1')
    expect(body.standings.find((s) => s.user_id === 'alice')?.unlikely_exact).toBe(true)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('GET /groups pódio', () => {
  it('desempata por user_id quando pontos, exatos e entrada empatam', async () => {
    const { sqlite, get, addMatch } = await createFixture()
    addMatch({ round: '1' })
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
