import { describe, expect, it, vi } from 'vitest'
import { calculatePoints, scoreUnprocessedMatches } from './scoring'

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
}

type FakeMatch = {
  id: string
  competition_id: string
  status: 'scheduled' | 'live' | 'finished'
  home_score: number | null
  away_score: number | null
  scored_at: string | null
}

function buildFakeDb(matches: FakeMatch[], predictions: FakePrediction[]) {
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
          const results = matches.filter(
            (m) =>
              m.competition_id === compId &&
              m.status === 'finished' &&
              m.scored_at === null &&
              m.home_score !== null &&
              m.away_score !== null,
          ) as unknown as T[]
          return { results }
        }
        if (sql.includes('FROM predictions') && sql.includes('WHERE match_id = ?')) {
          const matchId = params[0] as string
          const results = predictions.filter((p) => p.match_id === matchId) as unknown as T[]
          return { results }
        }
        if (sql.includes('FROM predictions') && sql.includes('GROUP BY user_id')) {
          const groupId = params[0] as string
          const grouped = new Map<string, { total_points: number; exact_hits: number }>()
          for (const p of predictions.filter((p) => p.group_id === groupId)) {
            const pts = updatedPredictions[p.id]?.points_awarded ?? p.points_awarded
            const cur = grouped.get(p.user_id) ?? { total_points: 0, exact_hits: 0 }
            grouped.set(p.user_id, {
              total_points: cur.total_points + (pts as number),
              exact_hits: cur.exact_hits + (pts === 3 ? 1 : 0),
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

  const db = {
    prepare(sql: string) {
      const boundParams: unknown[] = []
      const stmt = {
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
        async run() {},
        // Capture UPDATE calls so we can assert on them
        _sql: sql,
        _params: boundParams,
      }
      return stmt
    },
    async batch(statements: ReturnType<typeof db.prepare>[]) {
      for (const s of statements) {
        const sql = (s as unknown as { _sql: string })._sql
        const params = (s as unknown as { _params: unknown[] })._params
        if (sql.startsWith('UPDATE predictions SET points_awarded')) {
          const [points, id] = params as [number, string]
          updatedPredictions[id] = { points_awarded: points }
        }
        if (sql.startsWith('UPDATE matches SET scored_at')) {
          const [scoredAt, id] = params as [string, string]
          updatedMatches[id] = { scored_at: scoredAt }
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
