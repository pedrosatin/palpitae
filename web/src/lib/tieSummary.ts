import type { Match, Prediction } from '../components/MatchCard/types'
import { formatMatchDay } from './matchTime'
import { predictedTieScore } from './predictedTie'

export interface TieSummary {
  /** Placar real da ida, como `Ida: Palmeiras 1 × 0 Vasco`. */
  leg1: string
  /** Agregado real e quem avançou. Só existe com a volta encerrada. */
  aggregate: string | null
}

function hasScore(m: Match | undefined): m is Match & { home_score: number; away_score: number } {
  return (
    m !== undefined && m.status === 'finished' && m.home_score !== null && m.away_score !== null
  )
}

/**
 * Resumo do confronto para o card da volta, com os placares reais. Sem volta, sem
 * ida ou com a ida ainda sem resultado, não há o que mostrar. O agregado segue o
 * mando da volta, o mesmo do card.
 */
export function tieSummary(match: Match, leg1: Match | undefined): TieSummary | null {
  if (match.tie_role !== 'leg2' || !hasScore(leg1)) return null

  const summary: TieSummary = {
    leg1: `Ida: ${leg1.home_team_name} ${leg1.home_score} × ${leg1.away_score} ${leg1.away_team_name}`,
    aggregate: null,
  }
  if (!hasScore(match)) return summary

  const home = match.home_score + leg1.away_score
  const away = match.away_score + leg1.home_score
  const winner = home > away ? 'home' : away > home ? 'away' : (match.penalty_winner ?? null)
  const name = winner === 'home' ? match.home_team_name : match.away_team_name
  const decidedOnPenalties = home === away && winner !== null
  summary.aggregate =
    `Agregado ${home} × ${away}` +
    (winner ? ` · ${name} avançou${decidedOnPenalties ? ' nos pênaltis' : ''}` : '')
  return summary
}

/**
 * Agregado previsto pelos palpites da ida e da volta, para a volta ainda aberta.
 * Precisa do palpite da ida e do placar da volta completo.
 */
export function predictedAggregateText(
  match: Match,
  home: string,
  away: string,
  leg1Prediction: Prediction | undefined,
): string | null {
  if (match.tie_role !== 'leg2' || !leg1Prediction || home === '' || away === '') return null
  const score = predictedTieScore(match, Number(home), Number(away), leg1Prediction)
  return score ? `Agregado previsto ${score.home} × ${score.away}` : null
}

/** Volta de um confronto, achada na lista completa pelo `leg1_match_id`. */
export function findLeg2(match: Match, all: Match[]): Match | undefined {
  if (match.tie_role !== 'leg1') return undefined
  return all.find((m) => m.leg1_match_id === match.id)
}

/** Dia do jogo. Adiado guarda o horário antigo, então sai sem data. */
function legDay(label: 'Ida' | 'Volta', leg: Match): string {
  return leg.postponed
    ? `${label}: data a definir`
    : `${label} em ${formatMatchDay(leg.start_time)}`
}

/**
 * Quando é o outro jogo do confronto. Na volta, mostra o dia da ida enquanto ela
 * não tem resultado. Na ida, mostra o dia da volta. Jogo único não mostra nada.
 */
export function tieDateHint(
  match: Match,
  leg1: Match | undefined,
  leg2: Match | undefined,
): string | null {
  if (match.tie_role === 'leg2' && leg1 && !hasScore(leg1)) return legDay('Ida', leg1)
  if (match.tie_role === 'leg1' && leg2) return legDay('Volta', leg2)
  return null
}
