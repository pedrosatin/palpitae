import type { Match, Prediction } from '../components/MatchCard'
import { needsPenaltyPick } from './predictedTie'
import { isMatchLocked } from './predictionDrafts'

export interface RoundProgress {
  /** Jogos da rodada com palpite salvo, sem contar o jogo aberto em que falta pênalti. */
  predicted: number
  /** Palpitados mais os jogos abertos ainda sem palpite completo. */
  total: number
  /** Início do próximo jogo aberto com data marcada. `null` quando só restam adiados. */
  nextClosing: string | null
}

/**
 * Palpite salvo que pede o vencedor nos pênaltis e não tem essa escolha. Acontece
 * na volta quando a ida muda e o agregado passa a empatar. O card mostra "falta
 * pênalti". A ida vem dos palpites salvos, porque o contador conta só o que está
 * salvo.
 */
function missingPenalty(
  match: Match,
  prediction: Prediction,
  predictions: Map<string, Prediction>,
) {
  if (prediction.predicted_penalty_winner) return false
  const leg1 = match.leg1_match_id ? predictions.get(match.leg1_match_id) : undefined
  return needsPenaltyPick(
    match,
    prediction.predicted_home_score,
    prediction.predicted_away_score,
    leg1,
  )
}

/**
 * Progresso da rodada exibida na aba Palpitar. Sem jogo aberto, devolve `null` e o
 * cabeçalho some.
 *
 * Jogo travado sem palpite fica fora do total, porque não há mais o que fazer nele.
 * Assim `total - predicted` é exatamente o que ainda dá para palpitar. Jogo aberto em
 * que falta pênalti conta no total e fica fora dos palpitados. Jogo adiado segue
 * aberto (ADR-013) e conta no total. Sem horário de fechamento, fica fora de
 * `nextClosing`.
 */
export function roundProgress(
  roundMatches: Match[],
  predictions: Map<string, Prediction>,
  nowMs: number,
): RoundProgress | null {
  const open = roundMatches.filter((m) => !isMatchLocked(m, predictions.get(m.id), nowMs))
  if (open.length === 0) return null

  const openIds = new Set(open.map((m) => m.id))
  const lockedPredicted = roundMatches.filter(
    (m) => !openIds.has(m.id) && predictions.has(m.id),
  ).length
  const openPredicted = open.filter((m) => {
    const prediction = predictions.get(m.id)
    return prediction !== undefined && !missingPenalty(m, prediction, predictions)
  }).length
  const timed = open.filter((m) => !m.postponed).map((m) => m.start_time)
  timed.sort((a, b) => Date.parse(a) - Date.parse(b))

  return {
    predicted: lockedPredicted + openPredicted,
    total: lockedPredicted + open.length,
    nextClosing: timed[0] ?? null,
  }
}

/** Contador do cabeçalho, como `7 de 10 palpitados`. */
export function progressLabel({ predicted, total }: RoundProgress): string {
  return `${predicted} de ${total} ${total === 1 ? 'palpitado' : 'palpitados'}`
}
