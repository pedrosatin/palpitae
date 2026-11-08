import type { Match, Prediction } from '../components/MatchCard'
import { isMatchLocked } from './predictionDrafts'

export interface RoundProgress {
  /** Jogos da rodada com palpite salvo. */
  predicted: number
  /** Palpitados mais os jogos abertos ainda sem palpite. */
  total: number
  /** Início do próximo jogo aberto com data marcada. `null` quando só restam adiados. */
  nextClosing: string | null
}

/**
 * Progresso da rodada exibida na aba Palpitar. Sem jogo aberto, devolve `null` e o
 * cabeçalho some.
 *
 * Jogo travado sem palpite fica fora do total, porque não há mais o que fazer nele.
 * Assim `total - predicted` é exatamente o que ainda dá para palpitar. Jogo adiado
 * segue aberto (ADR-013) e conta no total, mas não tem horário de fechamento.
 */
export function roundProgress(
  roundMatches: Match[],
  predictions: Map<string, Prediction>,
  nowMs: number,
): RoundProgress | null {
  const open = roundMatches.filter((m) => !isMatchLocked(m, predictions.get(m.id), nowMs))
  if (open.length === 0) return null

  const predicted = roundMatches.filter((m) => predictions.has(m.id)).length
  const openWithout = open.filter((m) => !predictions.has(m.id)).length
  const timed = open.filter((m) => !m.postponed).map((m) => m.start_time)
  timed.sort((a, b) => Date.parse(a) - Date.parse(b))

  return { predicted, total: predicted + openWithout, nextClosing: timed[0] ?? null }
}

/** Contador do cabeçalho, como `7 de 10 palpitados`. */
export function progressLabel({ predicted, total }: RoundProgress): string {
  return `${predicted} de ${total} ${total === 1 ? 'palpitado' : 'palpitados'}`
}
