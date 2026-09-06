/**
 * Pure helpers for turning a round's local score/penalty drafts into the
 * payload sent to `PUT /predictions/bulk`. Extracted from
 * `usePredictionsTab` so the "which drafts are worth saving" rule lives in one
 * testable place instead of a single 40-line closure.
 */
import type { Match, Prediction } from '../components/MatchCard'

export type ScoreDraft = { home: string; away: string }
export type PenaltyWinner = 'home' | 'away' | null

export type RoundDraftPayload = {
  match_id: string
  predicted_home_score: number
  predicted_away_score: number
  predicted_penalty_winner?: PenaltyWinner
}

export type CollectRoundDraftsInput = {
  roundMatches: Match[]
  drafts: Map<string, ScoreDraft>
  penaltyDrafts: Map<string, PenaltyWinner>
  predictions: Map<string, Prediction>
}

/** A match is locked once it has kicked off or the server marked its prediction locked. */
function isMatchLocked(match: Match, prediction: Prediction | undefined): boolean {
  return Boolean(prediction?.locked) || new Date() >= new Date(match.start_time)
}

/**
 * Resolves the two score fields for a match, falling back to the saved
 * prediction (or `0`) when a field has no draft. Returns `null` when either
 * field is an empty string — an in-progress edit that must not be saved.
 */
function resolveDraftScores(
  draft: ScoreDraft | undefined,
  prediction: Prediction | undefined,
): { home: number; away: number } | null {
  const homeStr = draft?.home ?? (prediction ? String(prediction.predicted_home_score) : '0')
  const awayStr = draft?.away ?? (prediction ? String(prediction.predicted_away_score) : '0')
  if (homeStr === '' || awayStr === '') return null
  return { home: Number(homeStr), away: Number(awayStr) }
}

/**
 * Works out the penalty winner for a drawn knockout score. `eligibleDraw` is
 * false unless the score is level and the match is decided on penalties; when
 * it is, the draft wins, else the saved prediction, else `null`.
 */
function resolvePenaltyWinner(
  match: Match,
  home: number,
  away: number,
  penaltyDraft: PenaltyWinner | undefined,
  hasPenaltyDraft: boolean,
  prediction: Prediction | undefined,
): { eligibleDraw: boolean; winner: PenaltyWinner } {
  const eligibleDraw = home === away && Boolean(match.decides_on_penalties)
  if (!eligibleDraw) return { eligibleDraw, winner: null }
  const winner = hasPenaltyDraft
    ? (penaltyDraft ?? null)
    : (prediction?.predicted_penalty_winner ?? null)
  return { eligibleDraw, winner }
}

/** True when the resolved score or penalty winner differs from the saved prediction. */
function hasPredictionChange(
  home: number,
  away: number,
  penaltyWinner: PenaltyWinner,
  prediction: Prediction | undefined,
): boolean {
  const scoreChanged =
    !prediction ||
    home !== prediction.predicted_home_score ||
    away !== prediction.predicted_away_score
  const penaltyChanged = penaltyWinner !== (prediction?.predicted_penalty_winner ?? null)
  return scoreChanged || penaltyChanged
}

/**
 * Collects the drafts in `roundMatches` that are unlocked, complete and
 * actually different from what is already saved.
 */
export function collectRoundDrafts({
  roundMatches,
  drafts,
  penaltyDrafts,
  predictions,
}: CollectRoundDraftsInput): RoundDraftPayload[] {
  const out: RoundDraftPayload[] = []

  for (const match of roundMatches) {
    const prediction = predictions.get(match.id)
    if (isMatchLocked(match, prediction)) continue

    const draft = drafts.get(match.id)
    const hasPenaltyDraft = penaltyDrafts.has(match.id)
    if (!draft && !hasPenaltyDraft) continue

    const scores = resolveDraftScores(draft, prediction)
    if (!scores) continue

    const { eligibleDraw, winner } = resolvePenaltyWinner(
      match,
      scores.home,
      scores.away,
      penaltyDrafts.get(match.id),
      hasPenaltyDraft,
      prediction,
    )
    if (eligibleDraw && winner === null) continue

    if (hasPredictionChange(scores.home, scores.away, winner, prediction)) {
      out.push({
        match_id: match.id,
        predicted_home_score: scores.home,
        predicted_away_score: scores.away,
        predicted_penalty_winner: winner,
      })
    }
  }

  return out
}
