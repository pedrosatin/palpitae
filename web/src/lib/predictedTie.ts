import type { Match, Prediction } from '../components/MatchCard/types'

/** Aggregate is oriented to the return match's home and away teams. */
export function predictedTieScore(match: Match, home: number, away: number, leg1?: Prediction) {
  if (match.tie_role === 'leg2') {
    if (!leg1) return null
    return { home: home + leg1.predicted_away_score, away: away + leg1.predicted_home_score }
  }
  return { home, away }
}

export function needsPenaltyPick(match: Match, home: number, away: number, leg1?: Prediction) {
  if (!match.decides_on_penalties || match.tie_role === 'leg1') return false
  const score = predictedTieScore(match, home, away, leg1)
  return score !== null && score.home === score.away
}

export function predictedClassified(
  match: Match,
  home: number,
  away: number,
  winner: 'home' | 'away' | null,
  leg1?: Prediction,
) {
  if (match.tie_role === 'leg1' || (!match.tie_role && !match.decides_on_penalties)) return null
  const score = predictedTieScore(match, home, away, leg1)
  if (!score) return null
  return score.home > score.away ? 'home' : score.away > score.home ? 'away' : winner
}
