import type { Dispatch, SetStateAction } from 'react'
import { trackEvent } from '../analytics/ga'
import type { Match } from '../components/MatchCard'

export interface MatchRoundEvents {
  prev: string
  next: string
}

/**
 * Groups matches by round and exposes navigation helpers shared by
 * PredictionsTab and GroupPicksTab.
 *
 * Rodadas com jogo adiado ficam fora do default_round (a API escolhe a
 * primeira rodada com jogo futuro, e um adiado guarda o horário original,
 * que já passou). Sem o marcador postponedByRound, o palpite reaberto
 * ficaria invisível: o usuário abre na rodada seguinte e não sabe que
 * ainda dá para editar aqueles jogos. Ver ADR-013.
 */
export function useMatchRounds(
  matches: Match[],
  roundIndex: number,
  setRoundIndex: Dispatch<SetStateAction<number>>,
  events: MatchRoundEvents,
) {
  const rounds = new Map<string, Match[]>()
  for (const m of matches) {
    const key = m.round
    if (!rounds.has(key)) rounds.set(key, [])
    rounds.get(key)!.push(m)
  }

  const roundKeys = Array.from(rounds.keys())
  const labelFor = (r: string) => rounds.get(r)?.[0]?.round_label ?? r

  const postponedByRound = new Map<string, number>()
  for (const [round, roundList] of rounds) {
    // Jogo adiado que o sync já viu iniciado (`locked_at`) está travado: não entra
    // na dica de "palpite segue aberto".
    const count = roundList.filter((m) => Boolean(m.postponed) && !m.locked_at).length
    if (count > 0) postponedByRound.set(round, count)
  }

  const safeIndex = Math.min(roundIndex, roundKeys.length - 1)
  const selectedRound = roundKeys[safeIndex]
  const roundMatches = rounds.get(selectedRound) ?? []

  function prev() {
    trackEvent(events.prev, {
      round: roundKeys[Math.max(0, safeIndex - 1)],
    })
    setRoundIndex((i) => Math.max(0, i - 1))
  }

  function next() {
    trackEvent(events.next, {
      round: roundKeys[Math.min(roundKeys.length - 1, safeIndex + 1)],
    })
    setRoundIndex((i) => Math.min(roundKeys.length - 1, i + 1))
  }

  return {
    roundKeys,
    safeIndex,
    selectedRound,
    roundMatches,
    labelFor,
    postponedByRound,
    prev,
    next,
  }
}
