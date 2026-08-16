import { bench, describe } from 'vitest'
import { scoreUnprocessedMatches } from './scoring'
import type { D1Database } from '@cloudflare/workers-types'

// Mocking D1 DB
function createMockDb(numUnscored: number, numStatements: number) {
  let batchCalls = 0;
  return {
    prepare: (query: string) => {
      const stmt = {
        bind: (...args: any[]) => stmt,
        all: () => {
          if (query.includes('SELECT m.id')) {
            const results = []
            for (let i = 0; i < numUnscored; i++) {
               results.push({ id: `m${i}`, home_score: 1, away_score: 1, penalty_winner: null, phase: 'group', penalty_phases: '[]'})
            }
            return Promise.resolve({ results })
          }
          if (query.includes('SELECT p.id')) {
             const results = []
             for (let i = 0; i < numUnscored; i++) {
                results.push({ id: `p${i}`, match_id: `m${i}`, group_id: 'g1', user_id: 'u1', predicted_home_score: 1, predicted_away_score: 1, predicted_penalty_winner: null, points_exact: 3, points_winner: 1, points_penalty: 0 })
             }
             return Promise.resolve({ results })
          }
          if (query.includes('SELECT p.group_id')) {
             return Promise.resolve({ results: [{ group_id: 'g1', user_id: 'u1', total_points: 3, exact_hits: 1 }]})
          }
          return Promise.resolve({ results: [] })
        }
      }
      return stmt;
    },
    batch: async (statements: any[]) => {
      batchCalls++;
      // Simulate network delay
      await new Promise(r => setTimeout(r, 1))
      return statements.map(() => ({ success: true }))
    },
    getBatchCalls: () => batchCalls
  } as unknown as D1Database
}

describe('scoreUnprocessedMatches', () => {
  bench('score matches with many statements', async () => {
    const db = createMockDb(500, 500)
    await scoreUnprocessedMatches('c1', db)
  }, { time: 1000 })
})
