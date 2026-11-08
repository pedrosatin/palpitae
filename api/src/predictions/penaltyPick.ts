import type { TieRole } from '../matches/ties'

export type Leg1ScorePair = {
  homeScore: number
  awayScore: number
}

/**
 * Vencedor dos pênaltis a gravar no palpite. Regras:
 *   - obrigatório no empate de jogo único numa fase de penalty_phases;
 *   - a ida nunca aceita vencedor de pênaltis;
 *   - na volta, se a soma com o palpite da ida empata o agregado, grava o pick
 *     quando vier válido. Sem pick o palpite é aceito e só não pontua o classificado;
 *   - nos outros casos grava null, e um valor inválido é descartado em silêncio.
 */
export function resolvePenaltyPick(input: {
  eligible: boolean
  role: TieRole
  home: number
  away: number
  rawPenaltyWinner: unknown
  leg1Score: Leg1ScorePair | null
}): { ok: true; value: 'home' | 'away' | null } | { ok: false } {
  const { eligible, role, home, away, rawPenaltyWinner, leg1Score } = input
  const validPick: 'home' | 'away' | null =
    rawPenaltyWinner === 'home' || rawPenaltyWinner === 'away' ? rawPenaltyWinner : null

  if (role === 'leg1') return { ok: true, value: null }
  if (role === 'leg2') {
    const tied = leg1Score && home + leg1Score.awayScore === away + leg1Score.homeScore
    return { ok: true, value: tied ? validPick : null }
  }
  if (eligible && home === away) return validPick ? { ok: true, value: validPick } : { ok: false }

  return { ok: true, value: null }
}
