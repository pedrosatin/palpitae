import { bench, describe } from 'vitest'
import { scoreUnprocessedMatches } from './scoring'
import { D1Database } from '@cloudflare/workers-types'
import { vi } from 'vitest'

// Create a large fake DB with multiple groups and predictions for benchmark
const createFakeDb = (numGroups: number, numPredictionsPerGroup: number) => {
  const matchId = 'm1'
  const competitionId = 'c1'

  const groups = Array.from({ length: numGroups }, (_, i) => ({
    id: `g${i}`,
    points_exact: 3,
    points_winner: 1,
    points_penalty: 1,
  }))

  const predictions: any[] = []
  for (let g = 0; g < numGroups; g++) {
    for (let p = 0; p < numPredictionsPerGroup; p++) {
      predictions.push({
        id: `p_${g}_${p}`,
        group_id: `g${g}`,
        user_id: `u${p}`,
        predicted_home_score: 1,
        predicted_away_score: 0,
        points_awarded: 0,
        penalty_points: 0,
        predicted_penalty_winner: null,
      })
    }
  }

  const matches = [
    {
      id: matchId,
      competition_id: competitionId,
      status: 'finished',
      home_score: 1,
      away_score: 0,
      scored_at: null,
      penalty_winner: null,
      phase: 'GROUP',
    },
  ]

  const db = {
    prepare: vi.fn((sql: string) => {
      let results: any[] = []

      return {
        bind: vi.fn((...args) => {
          if (sql.includes('SELECT id, home_score, away_score FROM matches')) {
            results = matches
          } else if (sql.includes('SELECT m.penalty_winner, m.phase, c.penalty_phases')) {
             results = [{ penalty_winner: null, phase: 'GROUP', penalty_phases: 'FINAL' }]
          } else if (sql.includes('SELECT p.id, p.group_id, p.user_id')) {
             results = predictions.map(p => ({
               ...p,
               points_exact: 3,
               points_winner: 1,
               points_penalty: 1
             }))
          } else if (sql.includes('SELECT p.group_id, p.user_id') && sql.includes('FROM predictions p')) {
             // Mock returning multiple users for chunked groups
             const groupIds = args as string[]
             results = groupIds.flatMap(groupId =>
                Array.from({ length: numPredictionsPerGroup }, (_, i) => ({
                  group_id: groupId,
                  user_id: `u${i}`,
                  total_points: 3,
                  exact_hits: 1
                }))
             )
          }

          return {
            all: vi.fn(async () => ({ results })),
            first: vi.fn(async () => results[0] ?? null),
            run: vi.fn(async () => ({ success: true }))
          }
        })
      }
    }),
    batch: vi.fn(async () => {
      // simulate batch execution delay loosely
      return []
    })
  }
  return db as unknown as D1Database
}

describe('scoreUnprocessedMatches benchmark', () => {
  const db100 = createFakeDb(50, 20) // 50 groups, 20 predictions each (1000 total)

  bench('scoreUnprocessedMatches - optimized', async () => {
    await scoreUnprocessedMatches('c1', db100)
  })
})
