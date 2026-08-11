import { describe, expect, it, vi } from 'vitest'
import { calculatePenaltyBonus, calculatePoints, scoreUnprocessedMatches } from './scoring'

// ---------------------------------------------------------------------------
// calculatePoints — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe('calculatePoints', () => {
  describe('exact score → 3 points', () => {
    it('home win exact', () => expect(calculatePoints(2, 0, 2, 0)).toBe(3))
    it('away win exact', () => expect(calculatePoints(0, 3, 0, 3)).toBe(3))
    it('draw exact', () => expect(calculatePoints(1, 1, 1, 1)).toBe(3))
    it('0-0 exact', () => expect(calculatePoints(0, 0, 0, 0)).toBe(3))
  })

  describe('correct outcome but wrong score → 1 point', () => {
    it('predicted home win, different margin', () => expect(calculatePoints(2, 0, 3, 1)).toBe(1))
    it('predicted away win, different margin', () => expect(calculatePoints(0, 1, 0, 2)).toBe(1))
    it('predicted draw, different score', () => expect(calculatePoints(0, 0, 2, 2)).toBe(1))
    it('predicted draw, different score (1-1 vs 2-2)', () =>
      expect(calculatePoints(1, 1, 2, 2)).toBe(1))
  })

  describe('wrong outcome → 0 points', () => {
    it('predicted home win, actual away win', () => expect(calculatePoints(0, 1, 1, 0)).toBe(0))
    it('predicted away win, actual home win', () => expect(calculatePoints(1, 0, 0, 1)).toBe(0))
    it('predicted draw, actual home win', () => expect(calculatePoints(2, 0, 1, 1)).toBe(0))
    it('predicted home win, actual draw', () => expect(calculatePoints(0, 0, 1, 0)).toBe(0))
    it('predicted away win, actual draw', () => expect(calculatePoints(0, 0, 0, 1)).toBe(0))
  })

  describe('custom scoring (points_exact / points_winner)', () => {
    it('uses custom exact points on exact hit', () =>
      expect(calculatePoints(2, 0, 2, 0, 5, 2)).toBe(5))
    it('uses custom winner points on correct outcome', () =>
      expect(calculatePoints(2, 0, 3, 1, 5, 2)).toBe(2))
    it('wrong outcome still scores 0 with custom points', () =>
      expect(calculatePoints(0, 1, 1, 0, 5, 2)).toBe(0))
    it('"só placar exato" (3,0): correct outcome scores 0', () =>
      expect(calculatePoints(2, 0, 3, 1, 3, 0)).toBe(0))
    it('"só placar exato" (3,0): exact still scores 3', () =>
      expect(calculatePoints(2, 0, 2, 0, 3, 0)).toBe(3))
    it('"só vencedor" (1,1): exact hit scores the winner value', () =>
      expect(calculatePoints(2, 0, 2, 0, 1, 1)).toBe(1))
    it('"só vencedor" (1,1): correct outcome scores 1', () =>
      expect(calculatePoints(2, 0, 3, 1, 1, 1)).toBe(1))
  })

  describe('1X2 mode (points_exact = 0): exact-score bonus disabled', () => {
    // Picks are stored as casa=(1,0), empate=(0,0), fora=(0,1).
    it('correct winner scores the winner value', () =>
      expect(calculatePoints(2, 0, 1, 0, 0, 1)).toBe(1))
    it('a coincidental exact match still scores only the winner value, never 0', () =>
      expect(calculatePoints(1, 0, 1, 0, 0, 1)).toBe(1))
    it('correct draw scores the winner value', () =>
      expect(calculatePoints(2, 2, 0, 0, 0, 1)).toBe(1))
    it('wrong outcome scores 0', () => expect(calculatePoints(0, 1, 1, 0, 0, 1)).toBe(0))
  })
})

// ---------------------------------------------------------------------------
// calculatePenaltyBonus — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe('calculatePenaltyBonus', () => {
  // signature: (predHome, predAway, predPenWinner, penWinner, pointsPenalty, eligible)
  it('awards the bonus on a correct draw + correct shootout winner', () =>
    expect(calculatePenaltyBonus(1, 1, 'home', 'home', 1, true)).toBe(1))
  it('uses the configured points_penalty value', () =>
    expect(calculatePenaltyBonus(0, 0, 'away', 'away', 3, true)).toBe(3))
  it('no bonus when the shootout winner is wrong', () =>
    expect(calculatePenaltyBonus(1, 1, 'home', 'away', 1, true)).toBe(0))
  it('no bonus when the prediction was not a draw', () =>
    expect(calculatePenaltyBonus(2, 1, 'home', 'home', 1, true)).toBe(0))
  it('no bonus when there was no shootout (penaltyWinner null)', () =>
    expect(calculatePenaltyBonus(1, 1, 'home', null, 1, true)).toBe(0))
  it('no bonus when no penalty winner was predicted', () =>
    expect(calculatePenaltyBonus(1, 1, null, 'home', 1, true)).toBe(0))
  it('no bonus when the match phase is not eligible', () =>
    expect(calculatePenaltyBonus(1, 1, 'home', 'home', 1, false)).toBe(0))
  it('no bonus when points_penalty is 0 (disabled)', () =>
    expect(calculatePenaltyBonus(1, 1, 'home', 'home', 0, true)).toBe(0))
  it('does not require an exact score — any correct draw counts', () =>
    expect(calculatePenaltyBonus(3, 3, 'home', 'home', 1, true)).toBe(1))
})

// ---------------------------------------------------------------------------
// scoreUnprocessedMatches — tests with a fake D1 database
// ---------------------------------------------------------------------------

type FakePrediction = {
  id: string
  group_id: string
  user_id: string
  match_id: string
  predicted_home_score: number
  predicted_away_score: number
  points_awarded: number
  penalty_points?: number
  predicted_penalty_winner?: 'home' | 'away' | null
}

type FakeMatch = {
  id: string
  competition_id: string
  status: 'scheduled' | 'finished'
  home_score: number | null
  away_score: number | null
  scored_at: string | null
  phase?: string | null
  penalty_winner?: 'home' | 'away' | null
}

type FakeGroupConfig = {
  points_exact: number
  points_winner: number
  points_penalty?: number
}

function buildFakeDb(
  matches: FakeMatch[],
  predictions: FakePrediction[],
  groups: Record<string, FakeGroupConfig> = {},
  // Penalty phases per competition (the competitions.penalty_phases gate).
  penaltyPhases: Record<string, string[]> = {},
) {
  // Any group not explicitly configured uses the classic 3/1 scoring with the
  // default 1-point penalty bonus.
  const defaultConfig: Required<FakeGroupConfig> = {
    points_exact: 3,
    points_winner: 1,
    points_penalty: 1,
  }
  const groupConfig = (groupId: string): Required<FakeGroupConfig> => ({
    ...defaultConfig,
    ...groups[groupId],
  })
  const updatedMatches: Record<string, Partial<FakeMatch>> = {}
  const updatedPredictions: Record<string, Partial<FakePrediction>> = {}
  const leaderboardUpserts: Array<{
    group_id: string
    user_id: string
    total_points: number
    exact_hits: number
  }> = []

  function makeStatement(sql: string, params: unknown[]) {
    return {
      async first<T>(): Promise<T | null> {
        if (
          sql.includes('COUNT(*) AS count') &&
          sql.includes("status = 'finished'") &&
          sql.includes('scored_at IS NULL')
        ) {
          const compId = params[0] as string
          const count = matches.filter(
            (m) =>
              m.competition_id === compId &&
              m.status === 'finished' &&
              m.scored_at === null &&
              m.home_score !== null &&
              m.away_score !== null,
          ).length
          return { count } as T
        }
        // Match-level penalty context (penalty_winner, phase, competition gate)
        if (sql.includes('FROM matches m') && sql.includes('JOIN competitions')) {
          const matchId = params[0] as string
          const m = matches.find((x) => x.id === matchId)
          if (!m) return null
          return {
            penalty_winner: m.penalty_winner ?? null,
            phase: m.phase ?? null,
            penalty_phases: JSON.stringify(penaltyPhases[m.competition_id] ?? []),
          } as T
        }
        return null
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (
          sql.includes('FROM matches') &&
          sql.includes("status = 'finished'") &&
          sql.includes('scored_at IS NULL')
        ) {
          const compId = params[0] as string
          const results = matches
            .filter(
              (m) =>
                m.competition_id === compId &&
                m.status === 'finished' &&
                m.scored_at === null &&
                m.home_score !== null &&
                m.away_score !== null,
            )
            .map((m) => ({
              ...m,
              penalty_phases: JSON.stringify(penaltyPhases[m.competition_id] ?? []),
            })) as unknown as T[]
          return { results }
        }
        if (sql.includes('FROM predictions') && sql.includes('WHERE p.match_id IN')) {
          const matchIds = params as string[]
          const results = predictions
            .filter((p) => matchIds.includes(p.match_id))
            .map((p) => ({
              ...p,
              ...groupConfig(p.group_id),
            })) as unknown as T[]
          return { results }
        }
        if (sql.includes('FROM predictions') && sql.includes('GROUP BY p.group_id, p.user_id')) {
          const groupIdsStr = params[0] as string
          const groupIds = JSON.parse(groupIdsStr) as string[]
          const grouped = new Map<
            string,
            { group_id: string; user_id: string; total_points: number; exact_hits: number }
          >()
          for (const p of predictions.filter((p) => groupIds.includes(p.group_id))) {
            const cfg = groupConfig(p.group_id)
            const pts = updatedPredictions[p.id]?.points_awarded ?? p.points_awarded
            const penPts = updatedPredictions[p.id]?.penalty_points ?? 0
            const key = p.group_id + ':' + p.user_id
            const cur = grouped.get(key) ?? {
              group_id: p.group_id,
              user_id: p.user_id,
              total_points: 0,
              exact_hits: 0,
            }
            const isExact = cfg.points_exact > cfg.points_winner && pts === cfg.points_exact
            grouped.set(key, {
              group_id: p.group_id,
              user_id: p.user_id,
              total_points: cur.total_points + (pts as number) + (penPts as number),
              exact_hits: cur.exact_hits + (isExact ? 1 : 0),
            })
          }
          return {
            results: [...grouped.values()] as unknown as T[],
          }
        }
        return { results: [] }
      },
      async run() {},
    }
  }

  type FakeStatement = {
    bind(...args: unknown[]): FakeStatement
    first<T>(): Promise<T | null>
    all<T>(): Promise<{ results: T[] }>
    run(): Promise<void>
    _sql: string
    _params: unknown[]
  }

  const db: {
    prepare(sql: string): FakeStatement
    batch(statements: FakeStatement[]): Promise<void>
    _updatedMatches: Record<string, Partial<FakeMatch>>
    _updatedPredictions: Record<string, Partial<FakePrediction>>
    _leaderboardUpserts: Array<{
      group_id: string
      user_id: string
      total_points: number
      exact_hits: number
    }>
  } = {
    prepare(sql: string) {
      const stmt = {
        bind(...args: unknown[]) {
          return {
            ...stmt,
            _params: args,
            async first<T>() {
              return makeStatement(sql, args).first<T>()
            },
            async all<T>() {
              return makeStatement(sql, args).all<T>()
            },
            async run() {},
          }
        },
        async first<T>() {
          return makeStatement(sql, []).first<T>()
        },
        async all<T>() {
          return makeStatement(sql, []).all<T>()
        },
        async run() {},
        _sql: sql,
        _params: [] as unknown[],
      }
      return stmt as unknown as FakeStatement
    },
    async batch(statements: FakeStatement[]) {
      for (const s of statements) {
        const sql = (s as unknown as { _sql: string })._sql
        const params = (s as unknown as { _params: unknown[] })._params
        if (sql?.startsWith('UPDATE predictions SET points_awarded')) {
          const [points, penaltyPoints, id] = params as [number, number, string]
          updatedPredictions[id] = {
            points_awarded: points,
            penalty_points: penaltyPoints,
          }
        }
        if (sql?.startsWith('UPDATE matches SET scored_at')) {
          const [scoredAt, id] = params as [string, string]
          updatedMatches[id] = { scored_at: scoredAt }
        }
        if (sql?.includes('INSERT INTO leaderboard')) {
          const [group_id, user_id, total_points, exact_hits] = params as [
            string,
            string,
            number,
            number,
          ]
          leaderboardUpserts.push({
            group_id,
            user_id,
            total_points,
            exact_hits,
          })
        }
      }
    },
    _updatedMatches: updatedMatches,
    _updatedPredictions: updatedPredictions,
    _leaderboardUpserts: leaderboardUpserts,
  }

  return db
}

describe('scoreUnprocessedMatches', () => {
  it('skips when no finished unscored matches', async () => {
    const matches: FakeMatch[] = [
      {
        id: 'm1',
        competition_id: 'c1',
        status: 'scheduled',
        home_score: null,
        away_score: null,
        scored_at: null,
      },
    ]
    const db = buildFakeDb(matches, [])
    const batchSpy = vi.spyOn(db, 'batch')

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(batchSpy).not.toHaveBeenCalled()
  })

  it('skips already scored matches', async () => {
    const matches: FakeMatch[] = [
      {
        id: 'm1',
        competition_id: 'c1',
        status: 'finished',
        home_score: 2,
        away_score: 0,
        scored_at: '2026-06-11T22:00:00Z',
      },
    ]
    const db = buildFakeDb(matches, [])
    const batchSpy = vi.spyOn(db, 'batch')

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(batchSpy).not.toHaveBeenCalled()
  })

  it('awards 3 points for exact score', async () => {
    const matches: FakeMatch[] = [
      {
        id: 'm1',
        competition_id: 'c1',
        status: 'finished',
        home_score: 2,
        away_score: 0,
        scored_at: null,
      },
    ]
    const predictions: FakePrediction[] = [
      {
        id: 'p1',
        group_id: 'g1',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 2,
        predicted_away_score: 0,
        points_awarded: 0,
      },
    ]
    const db = buildFakeDb(matches, predictions)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(3)
    expect(db._updatedMatches['m1']?.scored_at).toBeDefined()
  })

  it('awards 1 point for correct outcome', async () => {
    const matches: FakeMatch[] = [
      {
        id: 'm1',
        competition_id: 'c1',
        status: 'finished',
        home_score: 2,
        away_score: 0,
        scored_at: null,
      },
    ]
    const predictions: FakePrediction[] = [
      {
        id: 'p1',
        group_id: 'g1',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 3,
        predicted_away_score: 1,
        points_awarded: 0,
      },
    ]
    const db = buildFakeDb(matches, predictions)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(1)
  })

  it('awards 0 points for wrong outcome', async () => {
    const matches: FakeMatch[] = [
      {
        id: 'm1',
        competition_id: 'c1',
        status: 'finished',
        home_score: 2,
        away_score: 0,
        scored_at: null,
      },
    ]
    const predictions: FakePrediction[] = [
      {
        id: 'p1',
        group_id: 'g1',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 0,
        predicted_away_score: 1,
        points_awarded: 0,
      },
    ]
    const db = buildFakeDb(matches, predictions)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(0)
  })

  it('scores multiple predictions for the same match correctly', async () => {
    const matches: FakeMatch[] = [
      {
        id: 'm1',
        competition_id: 'c1',
        status: 'finished',
        home_score: 1,
        away_score: 1,
        scored_at: null,
      },
    ]
    const predictions: FakePrediction[] = [
      {
        id: 'p1',
        group_id: 'g1',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 1,
        predicted_away_score: 1,
        points_awarded: 0,
      }, // exact
      {
        id: 'p2',
        group_id: 'g1',
        user_id: 'u2',
        match_id: 'm1',
        predicted_home_score: 2,
        predicted_away_score: 2,
        points_awarded: 0,
      }, // correct outcome
      {
        id: 'p3',
        group_id: 'g1',
        user_id: 'u3',
        match_id: 'm1',
        predicted_home_score: 2,
        predicted_away_score: 0,
        points_awarded: 0,
      }, // wrong
    ]
    const db = buildFakeDb(matches, predictions)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(3)
    expect(db._updatedPredictions['p2']?.points_awarded).toBe(1)
    expect(db._updatedPredictions['p3']?.points_awarded).toBe(0)
  })

  it('updates the leaderboard after scoring', async () => {
    const matches: FakeMatch[] = [
      {
        id: 'm1',
        competition_id: 'c1',
        status: 'finished',
        home_score: 2,
        away_score: 0,
        scored_at: null,
      },
    ]
    const predictions: FakePrediction[] = [
      {
        id: 'p1',
        group_id: 'g1',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 2,
        predicted_away_score: 0,
        points_awarded: 0,
      }, // exact → 3pts
      {
        id: 'p2',
        group_id: 'g1',
        user_id: 'u2',
        match_id: 'm1',
        predicted_home_score: 1,
        predicted_away_score: 0,
        points_awarded: 0,
      }, // correct → 1pt
    ]
    const db = buildFakeDb(matches, predictions)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    const u1 = db._leaderboardUpserts.find((r) => r.user_id === 'u1')
    const u2 = db._leaderboardUpserts.find((r) => r.user_id === 'u2')

    expect(u1?.total_points).toBe(3)
    expect(u1?.exact_hits).toBe(1)
    expect(u2?.total_points).toBe(1)
    expect(u2?.exact_hits).toBe(0)
  })

  it('applies per-group scoring config when scoring a shared match', async () => {
    const matches: FakeMatch[] = [
      {
        id: 'm1',
        competition_id: 'c1',
        status: 'finished',
        home_score: 2,
        away_score: 0,
        scored_at: null,
      },
    ]
    const predictions: FakePrediction[] = [
      // exact hit in a custom-scored group (5/2) → 5 points
      {
        id: 'p1',
        group_id: 'gCustom',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 2,
        predicted_away_score: 0,
        points_awarded: 0,
      },
      // correct outcome (wrong score) in the same group → 2 points
      {
        id: 'p2',
        group_id: 'gCustom',
        user_id: 'u2',
        match_id: 'm1',
        predicted_home_score: 1,
        predicted_away_score: 0,
        points_awarded: 0,
      },
      // exact hit in a default group (3/1) → 3 points
      {
        id: 'p3',
        group_id: 'gDefault',
        user_id: 'u3',
        match_id: 'm1',
        predicted_home_score: 2,
        predicted_away_score: 0,
        points_awarded: 0,
      },
    ]
    const db = buildFakeDb(matches, predictions, {
      gCustom: { points_exact: 5, points_winner: 2 },
    })

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(5)
    expect(db._updatedPredictions['p2']?.points_awarded).toBe(2)
    expect(db._updatedPredictions['p3']?.points_awarded).toBe(3)

    const u1 = db._leaderboardUpserts.find((r) => r.user_id === 'u1')
    expect(u1?.total_points).toBe(5)
    expect(u1?.exact_hits).toBe(1) // 5 == points_exact and 5 > 2
  })

  it('scores a 1X2 group (points_exact = 0) by winner only, with 0 exact_hits', async () => {
    const matches: FakeMatch[] = [
      {
        id: 'm1',
        competition_id: 'c1',
        status: 'finished',
        home_score: 1,
        away_score: 0,
        scored_at: null,
      },
    ]
    const predictions: FakePrediction[] = [
      // "Casa" pick (1,0) coincides exactly with the 1-0 result — must still score the winner value, not 0.
      {
        id: 'p1',
        group_id: 'g1X2',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 1,
        predicted_away_score: 0,
        points_awarded: 0,
      },
      // "Fora" pick (0,1) — wrong outcome → 0.
      {
        id: 'p2',
        group_id: 'g1X2',
        user_id: 'u2',
        match_id: 'm1',
        predicted_home_score: 0,
        predicted_away_score: 1,
        points_awarded: 0,
      },
    ]
    const db = buildFakeDb(matches, predictions, {
      g1X2: { points_exact: 0, points_winner: 1 },
    })

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(1)
    expect(db._updatedPredictions['p2']?.points_awarded).toBe(0)

    const u1 = db._leaderboardUpserts.find((r) => r.user_id === 'u1')
    expect(u1?.total_points).toBe(1)
    expect(u1?.exact_hits).toBe(0)
  })

  it('reports 0 exact_hits when points_exact equals points_winner (indistinguishable)', async () => {
    const matches: FakeMatch[] = [
      {
        id: 'm1',
        competition_id: 'c1',
        status: 'finished',
        home_score: 2,
        away_score: 0,
        scored_at: null,
      },
    ]
    const predictions: FakePrediction[] = [
      // exact hit in a "só vencedor" group (1/1) → 1 point, but not counted as exact
      {
        id: 'p1',
        group_id: 'gWinner',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 2,
        predicted_away_score: 0,
        points_awarded: 0,
      },
    ]
    const db = buildFakeDb(matches, predictions, {
      gWinner: { points_exact: 1, points_winner: 1 },
    })

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(1)
    const u1 = db._leaderboardUpserts.find((r) => r.user_id === 'u1')
    expect(u1?.total_points).toBe(1)
    expect(u1?.exact_hits).toBe(0)
  })

  it('only scores matches from the requested competition', async () => {
    const matches: FakeMatch[] = [
      {
        id: 'm1',
        competition_id: 'c1',
        status: 'finished',
        home_score: 2,
        away_score: 0,
        scored_at: null,
      },
      {
        id: 'm2',
        competition_id: 'c2',
        status: 'finished',
        home_score: 1,
        away_score: 1,
        scored_at: null,
      },
    ]
    const predictions: FakePrediction[] = [
      {
        id: 'p1',
        group_id: 'g1',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 2,
        predicted_away_score: 0,
        points_awarded: 0,
      },
      {
        id: 'p2',
        group_id: 'g2',
        user_id: 'u1',
        match_id: 'm2',
        predicted_home_score: 1,
        predicted_away_score: 1,
        points_awarded: 0,
      },
    ]
    const db = buildFakeDb(matches, predictions)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(3)
    expect(db._updatedPredictions['p2']).toBeUndefined()
  })
})

describe('scoreUnprocessedMatches — penalty bonus', () => {
  // Eligible single-game knockout that went to a shootout. home_score/away_score
  // hold the canonical (reg+ET) draw; penalty_winner is the shootout result.
  const shootout = (penaltyWinner: 'home' | 'away'): FakeMatch => ({
    id: 'm1',
    competition_id: 'c1',
    status: 'finished',
    home_score: 1,
    away_score: 1,
    scored_at: null,
    phase: 'FINAL',
    penalty_winner: penaltyWinner,
  })
  const eligible = { c1: ['FINAL'] }

  it('eligible draw + correct shootout winner → base + points_penalty', async () => {
    const predictions: FakePrediction[] = [
      {
        id: 'p1',
        group_id: 'g1',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 1,
        predicted_away_score: 1,
        points_awarded: 0,
        predicted_penalty_winner: 'home',
      },
    ]
    const db = buildFakeDb([shootout('home')], predictions, {}, eligible)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(3) // exact draw
    expect(db._updatedPredictions['p1']?.penalty_points).toBe(1)
    expect(db._leaderboardUpserts.find((r) => r.user_id === 'u1')?.total_points).toBe(4)
  })

  it('eligible draw + wrong shootout winner → base only, no bonus', async () => {
    const predictions: FakePrediction[] = [
      {
        id: 'p1',
        group_id: 'g1',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 1,
        predicted_away_score: 1,
        points_awarded: 0,
        predicted_penalty_winner: 'away',
      },
    ]
    const db = buildFakeDb([shootout('home')], predictions, {}, eligible)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(3)
    expect(db._updatedPredictions['p1']?.penalty_points).toBe(0)
    expect(db._leaderboardUpserts.find((r) => r.user_id === 'u1')?.total_points).toBe(3)
  })

  it('partial draw (1-1 vs 2-2) + correct winner → winner base + bonus, no exact required', async () => {
    const predictions: FakePrediction[] = [
      {
        id: 'p1',
        group_id: 'g1',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 2,
        predicted_away_score: 2,
        points_awarded: 0,
        predicted_penalty_winner: 'home',
      },
    ]
    const db = buildFakeDb([shootout('home')], predictions, {}, eligible)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(1) // correct draw, wrong score
    expect(db._updatedPredictions['p1']?.penalty_points).toBe(1)
  })

  it('phase not in penalty_phases → no bonus even with a shootout winner', async () => {
    const predictions: FakePrediction[] = [
      {
        id: 'p1',
        group_id: 'g1',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 1,
        predicted_away_score: 1,
        points_awarded: 0,
        predicted_penalty_winner: 'home',
      },
    ]
    // Gate lists only QUARTER_FINALS; the match is a FINAL → not eligible.
    const db = buildFakeDb([shootout('home')], predictions, {}, { c1: ['QUARTER_FINALS'] })

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.penalty_points).toBe(0)
  })

  it('points_penalty = 0 disables the bonus even on a correct call', async () => {
    const predictions: FakePrediction[] = [
      {
        id: 'p1',
        group_id: 'gNoPen',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 1,
        predicted_away_score: 1,
        points_awarded: 0,
        predicted_penalty_winner: 'home',
      },
    ]
    const db = buildFakeDb(
      [shootout('home')],
      predictions,
      { gNoPen: { points_exact: 3, points_winner: 1, points_penalty: 0 } },
      eligible,
    )

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.penalty_points).toBe(0)
  })

  it('1X2 mode (points_exact = 0): bonus still applies on a correct draw pick', async () => {
    const predictions: FakePrediction[] = [
      // "Empate" pick is stored as (0,0); the real canonical score was 1-1.
      {
        id: 'p1',
        group_id: 'g1X2',
        user_id: 'u1',
        match_id: 'm1',
        predicted_home_score: 0,
        predicted_away_score: 0,
        points_awarded: 0,
        predicted_penalty_winner: 'home',
      },
    ]
    const db = buildFakeDb(
      [shootout('home')],
      predictions,
      { g1X2: { points_exact: 0, points_winner: 1 } },
      eligible,
    )

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(1) // correct outcome (draw)
    expect(db._updatedPredictions['p1']?.penalty_points).toBe(1)
    expect(db._leaderboardUpserts.find((r) => r.user_id === 'u1')?.total_points).toBe(2)
  })
})
