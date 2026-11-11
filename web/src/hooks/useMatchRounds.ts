import type { Dispatch, SetStateAction } from 'react'
import { trackEvent } from '../analytics/ga'
import type { Match } from '../components/MatchCard'
import { rescheduledOpenByRound } from '../lib/rounds'

export interface MatchRoundEvents {
  prev: string
  next: string
}

/**
 * Groups matches by round and exposes navigation helpers shared by
 * PredictionsTab and GroupPicksTab.
 *
 * Rodadas com jogo adiado ficam fora do default_round (um adiado guarda o
 * horário original, que já passou). Rodadas que ficaram para trás com um jogo
 * remarcado para o futuro também ficam (ver api/src/matches/defaultRound.ts).
 * Sem os marcadores postponedByRound e rescheduledByRound, o palpite aberto
 * ficaria invisível: o usuário abre na rodada seguinte e não sabe que ainda dá
 * para palpitar naqueles jogos. Ver ADR-013 e ADR-019.
 *
 * `defaultRound` é o `default_round` da API e fica fora de rescheduledByRound.
 */
export function useMatchRounds(
  matches: Match[],
  roundIndex: number,
  setRoundIndex: Dispatch<SetStateAction<number>>,
  events: MatchRoundEvents,
  defaultRound?: string | null,
) {
  // A ordem vem da API; a lista não deve ser reordenada no front.
  const rounds = new Map<string, Match[]>()
  const knockoutRounds = new Set<string>()
  for (const m of matches) {
    const key = m.round
    if (m.is_knockout) knockoutRounds.add(key)
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

  const rescheduledByRound = rescheduledOpenByRound(rounds, Date.now(), defaultRound)

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
    knockoutRounds,
    safeIndex,
    selectedRound,
    roundMatches,
    labelFor,
    postponedByRound,
    rescheduledByRound,
    prev,
    next,
  }
}
