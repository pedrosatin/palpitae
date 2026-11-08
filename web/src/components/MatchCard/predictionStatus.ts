import type { Prediction } from './types'

/** Estado do palpite num jogo aberto. */
export type PredictionStatus = 'empty' | 'saved' | 'dirty'

/** Rótulo visível e anunciado de cada estado. */
export const PREDICTION_STATUS_LABEL: Record<PredictionStatus, string> = {
  empty: 'sem palpite',
  saved: 'palpite salvo',
  dirty: 'alterado, não salvo',
}

/**
 * Compara os campos do card com o palpite salvo. Sem palpite salvo, qualquer campo
 * preenchido já conta como alteração. O pênalti só conta quando a escolha está na
 * tela, a mesma regra do salvamento.
 */
export function predictionStatus({
  prediction,
  home,
  away,
  penaltyWinner,
  showPenaltyPicker,
}: {
  prediction: Prediction | undefined
  home: string
  away: string
  penaltyWinner: 'home' | 'away' | null
  showPenaltyPicker: boolean
}): PredictionStatus {
  if (!prediction) return home === '' && away === '' ? 'empty' : 'dirty'
  if (home === '' || away === '') return 'dirty'
  const scoreChanged =
    Number(home) !== prediction.predicted_home_score ||
    Number(away) !== prediction.predicted_away_score
  const penaltyChanged =
    showPenaltyPicker && penaltyWinner !== (prediction.predicted_penalty_winner ?? null)
  return scoreChanged || penaltyChanged ? 'dirty' : 'saved'
}
