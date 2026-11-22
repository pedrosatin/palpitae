import { predictedClassified } from './predictedTie'
import type { Match, Prediction } from '../components/MatchCard/types'

export type PredictionMap = Map<string, Prediction>

export type PredictionUpdate = {
  matchId: string
  home: number
  away: number
  penaltyWinner: 'home' | 'away' | null
}

export function predictionBase(
  home: number,
  away: number,
  penaltyWinner: 'home' | 'away' | null,
): string {
  return `${home}:${away}:${penaltyWinner ?? 'null'}`
}

export function buildOptimisticPrediction(
  existing: Prediction | undefined,
  match: Match | undefined,
  home: number,
  away: number,
  penaltyWinner: 'home' | 'away' | null,
  leg1Prediction: Prediction | undefined,
): Prediction {
  return {
    id: existing?.id ?? '',
    match_id: match?.id ?? existing?.match_id ?? '',
    predicted_home_score: home,
    predicted_away_score: away,
    predicted_penalty_winner: penaltyWinner,
    classified_points: existing?.classified_points ?? 0,
    predicted_classified: match
      ? predictedClassified(match, home, away, penaltyWinner, leg1Prediction)
      : null,
    points_awarded: existing?.points_awarded ?? 0,
    penalty_points: existing?.penalty_points ?? 0,
    locked: 0,
    updated_at: new Date().toISOString(),
  }
}

export function recomputeAllClassified(map: PredictionMap, allMatches: Match[]): PredictionMap {
  for (const context of allMatches) {
    const pick = map.get(context.id)
    if (!pick) continue
    map.set(context.id, {
      ...pick,
      predicted_classified: predictedClassified(
        context,
        pick.predicted_home_score,
        pick.predicted_away_score,
        pick.predicted_penalty_winner ?? null,
        context.leg1_match_id ? map.get(context.leg1_match_id) : undefined,
      ),
    })
  }
  return map
}

export function applyPredictionUpdates(
  prev: PredictionMap,
  updates: PredictionUpdate[],
  allMatches: Match[],
): PredictionMap {
  if (updates.length === 0) return prev
  const next = new Map(prev)
  const matchesById = new Map(allMatches.map((m) => [m.id, m]))
  for (const { matchId, home, away, penaltyWinner } of updates) {
    const existing = next.get(matchId)
    const match = matchesById.get(matchId)
    const built = buildOptimisticPrediction(
      existing,
      match,
      home,
      away,
      penaltyWinner,
      match?.leg1_match_id ? next.get(match.leg1_match_id) : undefined,
    )
    next.set(matchId, { ...built, match_id: matchId })
  }
  return recomputeAllClassified(next, allMatches)
}

export function rollbackPredictions(
  prev: PredictionMap,
  matchIds: string[],
  confirmed: PredictionMap,
  allMatches: Match[],
): PredictionMap {
  if (matchIds.length === 0) return prev
  const next = new Map(prev)
  for (const matchId of matchIds) {
    const original = confirmed.get(matchId)
    if (original) next.set(matchId, original)
    else next.delete(matchId)
  }
  return recomputeAllClassified(next, allMatches)
}
