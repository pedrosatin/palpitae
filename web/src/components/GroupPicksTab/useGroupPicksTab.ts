import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useMatchRounds } from '../../hooks/useMatchRounds'
import { useNow } from '../../hooks/useNow'
import { invalidateApiCache } from '../../lib/api-cache'
import {
  applyDefaultRoundFromMatches,
  competitionMatchesQueryOptions,
  matchesQueryErrorMessage,
} from '../../lib/competitionMatches'
import { fetchGroupPredictions } from '../../lib/groupPredictions'
import type { GroupMember, OpenPickers } from '../../lib/groupReminder'
import { isMatchLocked } from '../../lib/predictionDrafts'
import type { Match } from '../MatchCard/types'

const TICK_MS = 30_000

/** Por quanto tempo depois da primeira busca a aba busca de novo até a API revelar os palpites. */
const REVEAL_RETRY_MS = 5 * 60_000

export interface MemberPrediction {
  match_id: string
  user_id: string
  user_display: string
  predicted_home_score: number
  predicted_away_score: number
  predicted_penalty_winner: 'home' | 'away' | null
  points_awarded: number
  classified_points?: number
  predicted_classified?: 'home' | 'away' | null
  penalty_points: number
  locked: 0 | 1
}

export interface GroupPicksResponse {
  self_user_id: string
  members: GroupMember[]
  predictions: MemberPrediction[]
  /** Ausente na API antiga. Sem o campo, a aba não afirma quem palpitou. */
  open_pickers?: OpenPickers
}

/**
 * Diz se a resposta da API é de depois do travamento do jogo. A API calcula `locked`
 * com o relógio do servidor, e todos os palpites de um jogo vêm com o mesmo valor.
 * Um palpite com `locked` igual a 0 mostra que a resposta é de antes do travamento,
 * mesmo que o relógio local já tenha passado do horário de início. Sem palpite na
 * resposta, valem o status e o `locked_at` do jogo.
 */
export function serverConfirmsLock(match: Match, memberPicks: MemberPrediction[]): boolean {
  if (memberPicks.some((p) => p.locked !== 1)) return false
  return (
    memberPicks.length > 0 ||
    match.status === 'live' ||
    match.status === 'finished' ||
    Boolean(match.locked_at)
  )
}

/**
 * Jogos da rodada que já começaram pelo relógio local e que a última resposta da API
 * ainda trata como abertos, com palpite de `locked` 0 ou com a lista de quem palpitou
 * neles. Os palpites dos outros membros só chegam numa nova busca. Cada jogo vem como
 * `id@start_time`, e um jogo remarcado conta de novo no horário novo.
 */
export function unrevealedStarts(
  roundMatches: Match[],
  picks: GroupPicksResponse | null,
  now: number,
): string[] {
  if (!picks) return []
  const openOnServer = new Set(
    picks.predictions.filter((p) => p.locked !== 1).map((p) => p.match_id),
  )
  for (const [matchId, userIds] of Object.entries(picks.open_pickers ?? {})) {
    if (userIds.length > 0) openOnServer.add(matchId)
  }
  return roundMatches
    .filter((m) => openOnServer.has(m.id) && isMatchLocked(m, undefined, now))
    .map((m) => `${m.id}@${m.start_time}`)
}

/** Palpites dos membros por jogo. A API já filtra pela regra de revelação. */
export function groupPredictionsByMatch(
  predictions: MemberPrediction[],
): Map<string, MemberPrediction[]> {
  const picksByMatch = new Map<string, MemberPrediction[]>()
  for (const p of predictions) {
    if (!picksByMatch.has(p.match_id)) picksByMatch.set(p.match_id, [])
    picksByMatch.get(p.match_id)!.push(p)
  }
  return picksByMatch
}

export function isMatchOpenForPicks(
  match: Match,
  memberPicks: MemberPrediction[],
  now: number,
): boolean {
  return !serverConfirmsLock(match, memberPicks) && !isMatchLocked(match, undefined, now)
}

export function pickersOfMatch(
  match: Match,
  openPickers: OpenPickers | undefined,
  members: GroupMember[],
  open: boolean,
): GroupMember[] | null {
  if (!openPickers || !open) return null
  const picked = new Set(openPickers[match.id])
  return members.filter((m) => picked.has(m.user_id))
}

/**
 * No início do jogo, a resposta guardada ainda esconde os palpites dos outros. Num
 * grupo de palpites ocultos, a aba busca de novo na primeira virada do relógio depois
 * do início e, se a API ainda não travou, a cada tique por `REVEAL_RETRY_MS` a partir
 * dessa busca. Contar do início deixaria sem busca a aba que volta de segundo plano
 * depois do prazo.
 */
function useRevealRetry(
  groupId: string,
  predictionsVisibility: string,
  roundMatches: Match[],
  picks: GroupPicksResponse | null,
  now: number,
  setPicks: (data: GroupPicksResponse) => void,
) {
  const firstRevealFetch = useRef(new Map<string, number>())
  const unrevealed =
    predictionsVisibility === 'hidden' ? unrevealedStarts(roundMatches, picks, now).join(',') : ''
  useEffect(() => {
    if (!unrevealed) return
    const firstFetch = firstRevealFetch.current
    const due = unrevealed
      .split(',')
      .map((key) => `${groupId}:${key}`)
      .filter((key) => now - (firstFetch.get(key) ?? now) < REVEAL_RETRY_MS)
    if (due.length === 0) return
    for (const key of due) if (!firstFetch.has(key)) firstFetch.set(key, now)
    let active = true
    invalidateApiCache(`groups:predictions:${groupId}`)
    fetchGroupPredictions<GroupPicksResponse>(groupId)
      .then((data) => {
        if (active) setPicks(data)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [unrevealed, now, groupId, setPicks])
}

export function useGroupPicksTab(
  groupId: string,
  competitionId: string,
  predictionsVisibility: string,
) {
  const matchesQuery = useQuery(competitionMatchesQueryOptions(competitionId))
  const [picks, setPicks] = useState<GroupPicksResponse | null>(null)
  const [picksLoading, setPicksLoading] = useState(true)
  const [picksError, setPicksError] = useState<string | null>(null)
  const [roundIndex, setRoundIndex] = useState(0)
  // Aplica a rodada padrão uma vez por grupo e competição enquanto a aba está montada.
  // Um refetch não troca a rodada escolhida. Com o cache velho em atualização, espera
  // o dado novo para a rodada padrão vir da resposta atual.
  const appliedDefaultRoundKey = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    setPicks(null)
    setPicksLoading(true)
    setPicksError(null)

    fetchGroupPredictions<GroupPicksResponse>(groupId)
      .then((picksData) => {
        if (!active) return
        setPicks(picksData)
      })
      .catch((e: Error) => {
        if (active) setPicksError(e.message)
      })
      .finally(() => {
        if (active) setPicksLoading(false)
      })
    return () => {
      active = false
    }
  }, [groupId])

  useEffect(() => {
    if (!matchesQuery.data || matchesQuery.isFetching) return
    const key = `${groupId}:${competitionId}`
    if (appliedDefaultRoundKey.current === key) return
    appliedDefaultRoundKey.current = key
    applyDefaultRoundFromMatches(
      matchesQuery.data.matches,
      matchesQuery.data.default_round,
      setRoundIndex,
    )
  }, [groupId, competitionId, matchesQuery.data, matchesQuery.isFetching])

  const matches = matchesQuery.data?.matches ?? []
  const matchesError = matchesQueryErrorMessage(matchesQuery.error, matchesQuery.isError)
  const loading = matchesQuery.isPending || picksLoading
  const error = matchesError ?? picksError

  const {
    roundKeys,
    safeIndex,
    selectedRound,
    roundMatches,
    labelFor,
    knockoutRounds,
    prev,
    next,
  } = useMatchRounds(matches, roundIndex, setRoundIndex, {
    prev: 'click_group_picks_rodada_anterior',
    next: 'click_group_picks_proxima_rodada',
  })

  // O relógio também vira no início de cada jogo da rodada exibida.
  const now = useNow(
    TICK_MS,
    roundMatches.map((m) => m.start_time),
  )

  useRevealRetry(groupId, predictionsVisibility, roundMatches, picks, now, setPicks)

  return {
    picks,
    loading,
    error,
    matches,
    now,
    roundKeys,
    safeIndex,
    selectedRound,
    roundMatches,
    labelFor,
    knockoutRounds,
    prev,
    next,
    setRoundIndex,
  }
}
