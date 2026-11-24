import { bench, describe } from 'vitest'
import { INVOCATION_CALL_LIMIT } from './callBudget'
import { scoreUnprocessedMatches } from './scoring'
import type { D1Database } from '@cloudflare/workers-types'

const MAX_MATCHES_PER_INVOCATION = 600
const PREDICTIONS_PER_MATCH_MAX_WRITES = 10
const MAX_GROUP_MEMBERS = 50
const MATCHES_AT_MAX_GROUP = 120

const createMockDb = (numMatches: number, numPredictionsPerMatch: number) => {
  const matches = Array.from({ length: numMatches }, (_, i) => ({
    id: `m${i}`,
    home_score: 1,
    away_score: 1,
    penalty_winner: null,
    phase: null,
    penalty_phases: 'FINAL',
    prediction_count: numPredictionsPerMatch,
  }))

  const predictions = Array.from({ length: numPredictionsPerMatch * numMatches }, (_, i) => {
    const predInMatch = Math.floor(i / numMatches)
    return {
      id: `p${i}`,
      match_id: `m${i % numMatches}`,
      group_id: `g${Math.floor(predInMatch / MAX_GROUP_MEMBERS)}`,
      user_id: `u${predInMatch}`,
      predicted_home_score: 1,
      predicted_away_score: 1,
      predicted_penalty_winner: null,
      points_exact: 3,
      points_winner: 1,
      points_penalty: 0,
    }
  })

  const predictionsByMatch = new Map<string, typeof predictions>()
  for (const prediction of predictions) {
    let list = predictionsByMatch.get(prediction.match_id)
    if (!list) {
      list = []
      predictionsByMatch.set(prediction.match_id, list)
    }
    list.push(prediction)
  }

  const matchesResult = { results: matches }
  const leaderboardResult = {
    results: [{ group_id: 'g0', user_id: 'u0', total_points: 10, exact_hits: 2 }],
  }
  const emptyResult = { results: [] }
  const firstResult = { penalty_winner: null, phase: null, penalty_phases: 'FINAL' }

  const matchesBound = {
    all: async () => matchesResult,
    first: async () => firstResult,
  }
  const leaderboardBound = {
    all: async () => leaderboardResult,
    first: async () => firstResult,
  }
  const noopBound = {
    all: async () => emptyResult,
    first: async () => firstResult,
  }

  const matchesStmt = { bind: () => matchesBound }
  const predictionsStmt = {
    bind: (matchIdsJson: string) => ({
      all: async () => {
        const matchIds = JSON.parse(matchIdsJson) as string[]
        const results: typeof predictions = []
        for (const matchId of matchIds) {
          const list = predictionsByMatch.get(matchId)
          if (list) results.push(...list)
        }
        return { results }
      },
      first: async () => firstResult,
    }),
  }
  const leaderboardStmt = { bind: () => leaderboardBound }
  const noopStmt = { bind: () => noopBound }

  return {
    prepare(query: string) {
      if (query.includes('FROM matches')) return matchesStmt
      if (query.includes('FROM predictions')) return predictionsStmt
      if (query.includes('FROM leaderboard')) return leaderboardStmt
      return noopStmt
    },
    batch: async () => [],
  } as unknown as D1Database
}

describe('scoreUnprocessedMatches', () => {
  const maxMatchesDb = createMockDb(MAX_MATCHES_PER_INVOCATION, PREDICTIONS_PER_MATCH_MAX_WRITES)
  const maxGroupDb = createMockDb(MATCHES_AT_MAX_GROUP, MAX_GROUP_MEMBERS)

  bench('600 matches x 10 predictions (invocation call budget)', async () => {
    await scoreUnprocessedMatches('c1', maxMatchesDb, INVOCATION_CALL_LIMIT)
  })

  bench('120 matches x 50 predictions (max_members = 50)', async () => {
    await scoreUnprocessedMatches('c1', maxGroupDb, INVOCATION_CALL_LIMIT)
  })
})
