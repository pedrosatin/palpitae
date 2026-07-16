import { bench, describe, vi } from 'vitest'
import { scoreUnprocessedMatches } from './scoring'
import type { D1Database } from '@cloudflare/workers-types'

// Setup dummy db that will just do the bare minimum mock needed to return what scoreUnprocessedMatches expects
const createMockDb = (numMatches: number, numPredictionsPerMatch: number) => {
  const matches = Array.from({ length: numMatches }, (_, i) => ({
    id: `m${i}`,
    home_score: 1,
    away_score: 1,
    penalty_winner: null,
    phase: null,
    penalty_phases: 'FINAL'
  }));

  const predictions = Array.from({ length: numPredictionsPerMatch * numMatches }, (_, i) => ({
    id: `p${i}`,
    match_id: `m${i % numMatches}`,
    group_id: `g${i}`,
    user_id: `u${i}`,
    predicted_home_score: 1,
    predicted_away_score: 1,
    predicted_penalty_winner: null,
    points_exact: 3,
    points_winner: 1,
    points_penalty: 0
  }));

  const mockPrepare = vi.fn().mockImplementation((query: string) => {
    return {
      bind: vi.fn().mockImplementation(() => ({
        all: vi.fn().mockImplementation(async () => {
          if (query.includes('FROM matches')) {
            return { results: matches };
          }
          if (query.includes('FROM predictions')) {
            return { results: predictions };
          }
          if (query.includes('FROM leaderboard')) {
            return { results: [{ user_id: 'u1', total_points: 10, exact_hits: 2 }] };
          }
          return { results: [] };
        }),
        first: vi.fn().mockImplementation(async () => {
          return { penalty_winner: null, phase: null, penalty_phases: 'FINAL' };
        }),
      }))
    };
  });

  return {
    prepare: mockPrepare,
    batch: vi.fn().mockResolvedValue(true)
  } as unknown as D1Database;
};

describe('scoreUnprocessedMatches N+1 issue fixed', () => {
  // Use a smaller number of matches for benchmark to prevent out-of-memory error
  const db = createMockDb(10, 5);

  bench('fixed implementation with bulk queries', async () => {
    await scoreUnprocessedMatches('c1', db);
  });
});
