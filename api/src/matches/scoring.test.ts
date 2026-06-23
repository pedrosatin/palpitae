import { describe, expect, it, vi } from 'vitest'
import { calculatePoints, penaltyBonus, PENALTY_DEFER_GRACE_MS, scoreUnprocessedMatches } from './scoring'
import { KNOCKOUT_PHASES } from './phases'

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
    it('predicted draw, different score (1-1 vs 2-2)', () => expect(calculatePoints(1, 1, 2, 2)).toBe(1))
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
    it('wrong outcome scores 0', () =>
      expect(calculatePoints(0, 1, 1, 0, 0, 1)).toBe(0))
  })
})

// ---------------------------------------------------------------------------
// penaltyBonus — pure function
// ---------------------------------------------------------------------------

describe('penaltyBonus', () => {
  it('returns 1 when team ids match', () => expect(penaltyBonus('team-A', 'team-A')).toBe(1))
  it('returns 0 when team ids differ', () => expect(penaltyBonus('team-A', 'team-B')).toBe(0))
  it('returns 0 when actual winner is null', () => expect(penaltyBonus(null, 'team-A')).toBe(0))
  it('returns 0 when predicted winner is null', () => expect(penaltyBonus('team-A', null)).toBe(0))
  it('returns 0 when both are null', () => expect(penaltyBonus(null, null)).toBe(0))
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
  predicted_penalty_winner_team_id?: string | null
  points_awarded: number
  penalty_bonus?: number
}

type FakeMatch = {
  id: string
  competition_id: string
  status: 'scheduled' | 'live' | 'finished'
  home_score: number | null
  away_score: number | null
  scored_at: string | null
  phase?: string | null
  penalty_winner_team_id?: string | null
  start_time?: string | null
}

type FakeGroupConfig = { points_exact: number; points_winner: number; penalty_picks_enabled?: number }

function buildFakeDb(
  matches: FakeMatch[],
  predictions: FakePrediction[],
  groups: Record<string, FakeGroupConfig> = {},
) {
  // Any group not explicitly configured uses the classic 3/1 scoring with picks enabled.
  const groupConfig = (groupId: string) => {
    const cfg = groups[groupId] ?? {}
    return {
      points_exact: cfg.points_exact ?? 3,
      points_winner: cfg.points_winner ?? 1,
      penalty_picks_enabled: cfg.penalty_picks_enabled ?? 1,
    }
  }
  const updatedMatches: Record<string, Partial<FakeMatch>> = {}
  const updatedPredictions: Record<string, Partial<FakePrediction>> = {}
  const leaderboardUpserts: Array<{ group_id: string; user_id: string; total_points: number; exact_hits: number }> = []

  function makeStatement(sql: string, params: unknown[]) {
    return {
      async first<T>(): Promise<T | null> {
        if (sql.includes('COUNT(*) AS count') && sql.includes("status = 'finished'") && sql.includes('scored_at IS NULL')) {
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
        return null
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (sql.includes('FROM matches') && sql.includes("status = 'finished'") && sql.includes('scored_at IS NULL')) {
          const compId = params[0] as string
          const graceDeadline = params[1] as string | undefined
          const results = matches.filter(
            (m) =>
              m.competition_id === compId &&
              m.status === 'finished' &&
              m.scored_at === null &&
              m.home_score !== null &&
              m.away_score !== null &&
              // Mirror the SQL guard: defer knockout draws until the shootout
              // result arrives — but only within the grace window.
              (
                m.home_score !== m.away_score ||
                m.phase == null ||
                !(KNOCKOUT_PHASES as readonly string[]).includes(m.phase) ||
                m.penalty_winner_team_id != null ||
                (m.start_time != null && graceDeadline != null && m.start_time <= graceDeadline)
              ),
          ) as unknown as T[]
          return { results }
        }
        if (sql.includes('FROM predictions') && sql.includes('WHERE p.match_id = ?')) {
          const matchId = params[0] as string
          const results = predictions
            .filter((p) => p.match_id === matchId)
            .map((p) => ({ ...p, ...groupConfig(p.group_id) })) as unknown as T[]
          return { results }
        }
        if (sql.includes('FROM predictions') && sql.includes('GROUP BY p.user_id')) {
          const groupId = params[0] as string
          const cfg = groupConfig(groupId)
          const grouped = new Map<string, { total_points: number; exact_hits: number }>()
          for (const p of predictions.filter((p) => p.group_id === groupId)) {
            const pts = updatedPredictions[p.id]?.points_awarded ?? p.points_awarded
            const bonus = updatedPredictions[p.id]?.penalty_bonus ?? p.penalty_bonus ?? 0
            const cur = grouped.get(p.user_id) ?? { total_points: 0, exact_hits: 0 }
            // Mirror the SQL: exact_hits counts rows awarded points_exact, but only
            // when the exact bonus is distinguishable (points_exact > points_winner).
            // total_points sums points_awarded + penalty_bonus.
            const isExact =
              cfg.points_exact > cfg.points_winner && pts === cfg.points_exact
            grouped.set(p.user_id, {
              total_points: cur.total_points + (pts as number) + (bonus as number),
              exact_hits: cur.exact_hits + (isExact ? 1 : 0),
            })
          }
          return {
            results: [...grouped.entries()].map(([user_id, v]) => ({
              user_id,
              ...v,
            })) as unknown as T[],
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
    _leaderboardUpserts: Array<{ group_id: string; user_id: string; total_points: number; exact_hits: number }>
  } = {
    prepare(sql: string) {
      const boundParams: unknown[] = []
      const stmt: FakeStatement = {
        bind(...args: unknown[]) {
          boundParams.push(...args)
          return stmt
        },
        async first<T>() {
          return makeStatement(sql, boundParams).first<T>()
        },
        async all<T>() {
          return makeStatement(sql, boundParams).all<T>()
        },
        async run() {
          if (sql.startsWith('UPDATE matches SET scored_at')) {
            const [scoredAt, id] = boundParams as [string, string]
            updatedMatches[id] = { scored_at: scoredAt }
          }
        },
        _sql: sql,
        _params: boundParams,
      }
      return stmt
    },
    async batch(statements: FakeStatement[]) {
      for (const s of statements) {
        const sql = (s as unknown as { _sql: string })._sql
        const params = (s as unknown as { _params: unknown[] })._params
        if (sql.startsWith('UPDATE predictions SET points_awarded')) {
          const [points, bonus, id] = params as [number, number, string]
          updatedPredictions[id] = { points_awarded: points, penalty_bonus: bonus }
        }
        if (sql.includes('INSERT INTO leaderboard')) {
          const [group_id, user_id, total_points, exact_hits] = params as [string, string, number, number]
          leaderboardUpserts.push({ group_id, user_id, total_points, exact_hits })
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
      { id: 'm1', competition_id: 'c1', status: 'scheduled', home_score: null, away_score: null, scored_at: null },
    ]
    const db = buildFakeDb(matches, [])
    const batchSpy = vi.spyOn(db, 'batch')

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(batchSpy).not.toHaveBeenCalled()
  })

  it('skips already scored matches', async () => {
    const matches: FakeMatch[] = [
      { id: 'm1', competition_id: 'c1', status: 'finished', home_score: 2, away_score: 0, scored_at: '2026-06-11T22:00:00Z' },
    ]
    const db = buildFakeDb(matches, [])
    const batchSpy = vi.spyOn(db, 'batch')

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(batchSpy).not.toHaveBeenCalled()
  })

  it('awards 3 points for exact score', async () => {
    const matches: FakeMatch[] = [
      { id: 'm1', competition_id: 'c1', status: 'finished', home_score: 2, away_score: 0, scored_at: null },
    ]
    const predictions: FakePrediction[] = [
      { id: 'p1', group_id: 'g1', user_id: 'u1', match_id: 'm1', predicted_home_score: 2, predicted_away_score: 0, points_awarded: 0 },
    ]
    const db = buildFakeDb(matches, predictions)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(3)
    expect(db._updatedMatches['m1']?.scored_at).toBeDefined()
  })

  it('awards 1 point for correct outcome', async () => {
    const matches: FakeMatch[] = [
      { id: 'm1', competition_id: 'c1', status: 'finished', home_score: 2, away_score: 0, scored_at: null },
    ]
    const predictions: FakePrediction[] = [
      { id: 'p1', group_id: 'g1', user_id: 'u1', match_id: 'm1', predicted_home_score: 3, predicted_away_score: 1, points_awarded: 0 },
    ]
    const db = buildFakeDb(matches, predictions)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(1)
  })

  it('awards 0 points for wrong outcome', async () => {
    const matches: FakeMatch[] = [
      { id: 'm1', competition_id: 'c1', status: 'finished', home_score: 2, away_score: 0, scored_at: null },
    ]
    const predictions: FakePrediction[] = [
      { id: 'p1', group_id: 'g1', user_id: 'u1', match_id: 'm1', predicted_home_score: 0, predicted_away_score: 1, points_awarded: 0 },
    ]
    const db = buildFakeDb(matches, predictions)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(0)
  })

  it('scores multiple predictions for the same match correctly', async () => {
    const matches: FakeMatch[] = [
      { id: 'm1', competition_id: 'c1', status: 'finished', home_score: 1, away_score: 1, scored_at: null },
    ]
    const predictions: FakePrediction[] = [
      { id: 'p1', group_id: 'g1', user_id: 'u1', match_id: 'm1', predicted_home_score: 1, predicted_away_score: 1, points_awarded: 0 }, // exact
      { id: 'p2', group_id: 'g1', user_id: 'u2', match_id: 'm1', predicted_home_score: 2, predicted_away_score: 2, points_awarded: 0 }, // correct outcome
      { id: 'p3', group_id: 'g1', user_id: 'u3', match_id: 'm1', predicted_home_score: 2, predicted_away_score: 0, points_awarded: 0 }, // wrong
    ]
    const db = buildFakeDb(matches, predictions)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(3)
    expect(db._updatedPredictions['p2']?.points_awarded).toBe(1)
    expect(db._updatedPredictions['p3']?.points_awarded).toBe(0)
  })

  it('updates the leaderboard after scoring', async () => {
    const matches: FakeMatch[] = [
      { id: 'm1', competition_id: 'c1', status: 'finished', home_score: 2, away_score: 0, scored_at: null },
    ]
    const predictions: FakePrediction[] = [
      { id: 'p1', group_id: 'g1', user_id: 'u1', match_id: 'm1', predicted_home_score: 2, predicted_away_score: 0, points_awarded: 0 }, // exact → 3pts
      { id: 'p2', group_id: 'g1', user_id: 'u2', match_id: 'm1', predicted_home_score: 1, predicted_away_score: 0, points_awarded: 0 }, // correct → 1pt
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
      { id: 'm1', competition_id: 'c1', status: 'finished', home_score: 2, away_score: 0, scored_at: null },
    ]
    const predictions: FakePrediction[] = [
      // exact hit in a custom-scored group (5/2) → 5 points
      { id: 'p1', group_id: 'gCustom', user_id: 'u1', match_id: 'm1', predicted_home_score: 2, predicted_away_score: 0, points_awarded: 0 },
      // correct outcome (wrong score) in the same group → 2 points
      { id: 'p2', group_id: 'gCustom', user_id: 'u2', match_id: 'm1', predicted_home_score: 1, predicted_away_score: 0, points_awarded: 0 },
      // exact hit in a default group (3/1) → 3 points
      { id: 'p3', group_id: 'gDefault', user_id: 'u3', match_id: 'm1', predicted_home_score: 2, predicted_away_score: 0, points_awarded: 0 },
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
      { id: 'm1', competition_id: 'c1', status: 'finished', home_score: 1, away_score: 0, scored_at: null },
    ]
    const predictions: FakePrediction[] = [
      // "Casa" pick (1,0) coincides exactly with the 1-0 result — must still score the winner value, not 0.
      { id: 'p1', group_id: 'g1X2', user_id: 'u1', match_id: 'm1', predicted_home_score: 1, predicted_away_score: 0, points_awarded: 0 },
      // "Fora" pick (0,1) — wrong outcome → 0.
      { id: 'p2', group_id: 'g1X2', user_id: 'u2', match_id: 'm1', predicted_home_score: 0, predicted_away_score: 1, points_awarded: 0 },
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
      { id: 'm1', competition_id: 'c1', status: 'finished', home_score: 2, away_score: 0, scored_at: null },
    ]
    const predictions: FakePrediction[] = [
      // exact hit in a "só vencedor" group (1/1) → 1 point, but not counted as exact
      { id: 'p1', group_id: 'gWinner', user_id: 'u1', match_id: 'm1', predicted_home_score: 2, predicted_away_score: 0, points_awarded: 0 },
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

  describe('penalty shootout scoring', () => {
    const shootoutMatch: FakeMatch = {
      id: 'm1', competition_id: 'c1', status: 'finished',
      home_score: 1, away_score: 1, scored_at: null,
      phase: 'QUARTER_FINALS', penalty_winner_team_id: 'team-A',
    }

    it('awards +1 bonus to the correct penalty-shootout pick', async () => {
      const predictions: FakePrediction[] = [
        { id: 'p1', group_id: 'g1', user_id: 'u1', match_id: 'm1',
          predicted_home_score: 1, predicted_away_score: 1,
          predicted_penalty_winner_team_id: 'team-A', points_awarded: 0 }, // correct
        { id: 'p2', group_id: 'g1', user_id: 'u2', match_id: 'm1',
          predicted_home_score: 1, predicted_away_score: 1,
          predicted_penalty_winner_team_id: 'team-B', points_awarded: 0 }, // wrong pick
        { id: 'p3', group_id: 'g1', user_id: 'u3', match_id: 'm1',
          predicted_home_score: 1, predicted_away_score: 1,
          predicted_penalty_winner_team_id: null, points_awarded: 0 },     // no pick
      ]
      const db = buildFakeDb([shootoutMatch], predictions)
      await scoreUnprocessedMatches('c1', db as unknown as D1Database)

      expect(db._updatedPredictions['p1']?.points_awarded).toBe(3)
      expect(db._updatedPredictions['p1']?.penalty_bonus).toBe(1)
      expect(db._updatedPredictions['p2']?.penalty_bonus).toBe(0)
      expect(db._updatedPredictions['p3']?.penalty_bonus).toBe(0)
    })

    it('defers scoring a knockout draw until penalty_winner_team_id arrives', async () => {
      const pendingMatch: FakeMatch = {
        ...shootoutMatch, penalty_winner_team_id: null,
      }
      const db = buildFakeDb([pendingMatch], [])
      const batchSpy = vi.spyOn(db, 'batch')
      await scoreUnprocessedMatches('c1', db as unknown as D1Database)
      expect(batchSpy).not.toHaveBeenCalled()
    })

    it('scores a knockout draw as a plain draw once the defer grace window passes', async () => {
      // Penalties never arrived (data gap, or a knockout leg that wasn't a
      // shootout). Once start_time is older than the grace window it must score —
      // base points for everyone, no bonus — instead of stalling forever.
      const staleMatch: FakeMatch = {
        ...shootoutMatch,
        penalty_winner_team_id: null,
        start_time: new Date(Date.now() - PENALTY_DEFER_GRACE_MS * 2).toISOString(),
      }
      const predictions: FakePrediction[] = [
        { id: 'p1', group_id: 'g1', user_id: 'u1', match_id: 'm1',
          predicted_home_score: 1, predicted_away_score: 1,
          predicted_penalty_winner_team_id: 'team-A', points_awarded: 0 },
      ]
      const db = buildFakeDb([staleMatch], predictions)
      await scoreUnprocessedMatches('c1', db as unknown as D1Database)
      expect(db._updatedPredictions['p1']?.points_awarded).toBe(3) // exact draw
      expect(db._updatedPredictions['p1']?.penalty_bonus).toBe(0)  // no winner → no bonus
    })

    it('awards 0 bonus when the group has penalty_picks_enabled = 0', async () => {
      const predictions: FakePrediction[] = [
        { id: 'p1', group_id: 'gOff', user_id: 'u1', match_id: 'm1',
          predicted_home_score: 1, predicted_away_score: 1,
          predicted_penalty_winner_team_id: 'team-A', points_awarded: 0 },
      ]
      const db = buildFakeDb([shootoutMatch], predictions, {
        gOff: { points_exact: 3, points_winner: 1, penalty_picks_enabled: 0 },
      })
      await scoreUnprocessedMatches('c1', db as unknown as D1Database)
      expect(db._updatedPredictions['p1']?.penalty_bonus).toBe(0)
    })

    it('awards 0 bonus in 1X2 groups (points_exact = 0)', async () => {
      const predictions: FakePrediction[] = [
        { id: 'p1', group_id: 'g1X2', user_id: 'u1', match_id: 'm1',
          predicted_home_score: 0, predicted_away_score: 0,
          predicted_penalty_winner_team_id: null, points_awarded: 0 },
      ]
      const db = buildFakeDb([shootoutMatch], predictions, {
        g1X2: { points_exact: 0, points_winner: 1, penalty_picks_enabled: 1 },
      })
      await scoreUnprocessedMatches('c1', db as unknown as D1Database)
      expect(db._updatedPredictions['p1']?.penalty_bonus).toBe(0)
    })

    it('awards 0 bonus for a group-stage draw (non-knockout phase)', async () => {
      const groupMatch: FakeMatch = {
        ...shootoutMatch, phase: null, penalty_winner_team_id: null,
      }
      const predictions: FakePrediction[] = [
        { id: 'p1', group_id: 'g1', user_id: 'u1', match_id: 'm1',
          predicted_home_score: 1, predicted_away_score: 1,
          predicted_penalty_winner_team_id: null, points_awarded: 0 },
      ]
      const db = buildFakeDb([groupMatch], predictions)
      await scoreUnprocessedMatches('c1', db as unknown as D1Database)
      expect(db._updatedPredictions['p1']?.points_awarded).toBe(3)
      expect(db._updatedPredictions['p1']?.penalty_bonus).toBe(0)
    })

    it('includes penalty bonus in the leaderboard total_points', async () => {
      const predictions: FakePrediction[] = [
        { id: 'p1', group_id: 'g1', user_id: 'u1', match_id: 'm1',
          predicted_home_score: 1, predicted_away_score: 1,
          predicted_penalty_winner_team_id: 'team-A', points_awarded: 0 }, // 3 + 1 = 4
        { id: 'p2', group_id: 'g1', user_id: 'u2', match_id: 'm1',
          predicted_home_score: 1, predicted_away_score: 1,
          predicted_penalty_winner_team_id: 'team-B', points_awarded: 0 }, // 3 + 0 = 3
      ]
      const db = buildFakeDb([shootoutMatch], predictions)
      await scoreUnprocessedMatches('c1', db as unknown as D1Database)

      const u1 = db._leaderboardUpserts.find((r) => r.user_id === 'u1')
      const u2 = db._leaderboardUpserts.find((r) => r.user_id === 'u2')
      expect(u1?.total_points).toBe(4)
      expect(u1?.exact_hits).toBe(1)
      expect(u2?.total_points).toBe(3)
      expect(u2?.exact_hits).toBe(1)
    })
  })

  it('only scores matches from the requested competition', async () => {
    const matches: FakeMatch[] = [
      { id: 'm1', competition_id: 'c1', status: 'finished', home_score: 2, away_score: 0, scored_at: null },
      { id: 'm2', competition_id: 'c2', status: 'finished', home_score: 1, away_score: 1, scored_at: null },
    ]
    const predictions: FakePrediction[] = [
      { id: 'p1', group_id: 'g1', user_id: 'u1', match_id: 'm1', predicted_home_score: 2, predicted_away_score: 0, points_awarded: 0 },
      { id: 'p2', group_id: 'g2', user_id: 'u1', match_id: 'm2', predicted_home_score: 1, predicted_away_score: 1, points_awarded: 0 },
    ]
    const db = buildFakeDb(matches, predictions)

    await scoreUnprocessedMatches('c1', db as unknown as D1Database)

    expect(db._updatedPredictions['p1']?.points_awarded).toBe(3)
    expect(db._updatedPredictions['p2']).toBeUndefined()
  })
})
