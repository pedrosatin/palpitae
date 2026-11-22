import { useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { buildApiUrl } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import { invalidateGroupPredictions } from '../../lib/groupPredictions'
import { invalidateGroupsList } from '../../lib/groupsList'
import { collectRoundDrafts, savedBase, type UnsavedDrafts } from '../../lib/predictionDrafts'
import {
  applyPredictionUpdates,
  predictionBase,
  rollbackPredictions,
  type PredictionMap,
  type PredictionUpdate,
} from '../../lib/predictionOptimistic'
import { plural } from '../../lib/replicateToGroups'
import type { Match } from '../MatchCard'

type BulkSaveResponse = { saved: string[]; locked?: string[]; not_found?: string[] }

function bulkRejectionMessage(sent: string[], data: BulkSaveResponse): string | null {
  const saved = new Set(data.saved)
  const rejected = sent.filter((id) => !saved.has(id))
  if (rejected.length === 0) return null
  const locked = rejected.filter((id) => data.locked?.includes(id)).length
  const notFound = rejected.filter((id) => data.not_found?.includes(id)).length
  const other = rejected.length - locked - notFound
  const accepted = sent.length - rejected.length
  return [
    accepted > 0 && plural(accepted, 'palpite salvo.', 'palpites salvos.'),
    locked > 0 &&
      plural(locked, 'jogo já bloqueado ficou de fora.', 'jogos já bloqueados ficaram de fora.'),
    notFound > 0 &&
      plural(
        notFound,
        'jogo não foi encontrado neste campeonato.',
        'jogos não foram encontrados neste campeonato.',
      ),
    other > 0 && plural(other, 'palpite não foi salvo.', 'palpites não foram salvos.'),
    locked + notFound > 0 ? 'Recarregue a página para atualizar os jogos.' : 'Tente novamente.',
  ]
    .filter(Boolean)
    .join(' ')
}

function useBulkSaveStatus(selectedRound: string | undefined) {
  const [savingAll, setSavingAll] = useState(false)
  const [savedAll, setSavedAll] = useState(false)
  const [hasSavedPredictions, setHasSavedPredictions] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const savedAllTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearSavedAllTimer() {
    if (savedAllTimerRef.current) {
      clearTimeout(savedAllTimerRef.current)
      savedAllTimerRef.current = null
    }
  }

  const roundViewRef = useRef(0)

  useEffect(() => {
    roundViewRef.current += 1
    clearSavedAllTimer()
    setSavedAll(false)
    setBulkError(null)
  }, [selectedRound])

  useEffect(() => {
    return () => clearSavedAllTimer()
  }, [])

  function startSavedAllTimer() {
    setSavedAll(true)
    savedAllTimerRef.current = setTimeout(() => setSavedAll(false), 2500)
  }

  return {
    savingAll,
    setSavingAll,
    savedAll,
    setSavedAll,
    hasSavedPredictions,
    setHasSavedPredictions,
    bulkError,
    setBulkError,
    clearSavedAllTimer,
    startSavedAllTimer,
    roundViewRef,
  }
}

type BulkSaveInput = {
  groupId: string
  roundMatches: Match[]
  predictions: PredictionMap
  setPredictions: Dispatch<SetStateAction<PredictionMap>>
  confirmedRef: MutableRefObject<PredictionMap>
  saveSeqRef: MutableRefObject<Map<string, number>>
  scopeSeqRef: MutableRefObject<number>
  selectedRound: string | undefined
  allMatches: Match[]
  unsavedDrafts: UnsavedDrafts
  clearSubmittedDrafts: (submitted: Array<{ matchId: string; nextBase: string }>) => void
  rebaseDrafts: (rebases: Array<{ matchId: string; fromBase: string; toBase: string }>) => void
  onClearCardErrors?: (matchIds: string[]) => void
  onBulkSaved?: (matchIds: string[]) => void
}

export function usePredictionsBulkSave({
  groupId,
  roundMatches,
  predictions,
  setPredictions,
  confirmedRef,
  saveSeqRef,
  scopeSeqRef,
  selectedRound,
  allMatches,
  unsavedDrafts: { drafts, penaltyDrafts },
  clearSubmittedDrafts,
  rebaseDrafts,
  onClearCardErrors,
  onBulkSaved,
}: BulkSaveInput) {
  const queryClient = useQueryClient()
  const {
    savingAll,
    setSavingAll,
    savedAll,
    setSavedAll,
    hasSavedPredictions,
    setHasSavedPredictions,
    bulkError,
    setBulkError,
    clearSavedAllTimer,
    startSavedAllTimer,
    roundViewRef,
  } = useBulkSaveStatus(selectedRound)

  function markHasSaved() {
    setHasSavedPredictions(true)
  }

  function handleSaved(
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) {
    setHasSavedPredictions(true)
    setPredictions((prev) =>
      applyPredictionUpdates(prev, [{ matchId, home, away, penaltyWinner }], allMatches),
    )
  }

  function pendingDrafts() {
    return collectRoundDrafts({ roundMatches, drafts, penaltyDrafts, predictions })
  }

  function revertItems(
    items: PredictionUpdate[],
    tokens: Map<string, number>,
    bases: Map<string, string>,
  ) {
    const active = items.filter(
      (u) => saveSeqRef.current.get(u.matchId) === tokens.get(u.matchId),
    )
    if (active.length === 0) return
    rebaseDrafts(
      active.map((u) => ({
        matchId: u.matchId,
        fromBase: bases.get(u.matchId)!,
        toBase: savedBase(confirmedRef.current.get(u.matchId)),
      })),
    )
    setPredictions((prev) =>
      rollbackPredictions(
        prev,
        active.map((u) => u.matchId),
        confirmedRef.current,
        allMatches,
      ),
    )
  }

  async function handleSaveAll() {
    const toSave = pendingDrafts()
    if (toSave.length === 0) return
    trackEvent('click_predictions_salvar_todos', {
      count: toSave.length,
      round: selectedRound ?? '',
    })

    clearSavedAllTimer()
    setSavingAll(true)
    setSavedAll(false)
    setBulkError(null)
    const roundView = roundViewRef.current
    const scopeSeq = scopeSeqRef.current

    const updates: PredictionUpdate[] = toSave.map((p) => ({
      matchId: p.match_id,
      home: p.predicted_home_score,
      away: p.predicted_away_score,
      penaltyWinner: p.predicted_penalty_winner ?? null,
    }))
    const tokens = new Map<string, number>()
    const bases = new Map<string, string>()
    const submitted: Array<{ matchId: string; nextBase: string }> = []
    for (const u of updates) {
      const seq = (saveSeqRef.current.get(u.matchId) ?? 0) + 1
      saveSeqRef.current.set(u.matchId, seq)
      tokens.set(u.matchId, seq)
      const nextBase = predictionBase(u.home, u.away, u.penaltyWinner)
      bases.set(u.matchId, nextBase)
      submitted.push({ matchId: u.matchId, nextBase })
    }

    clearSubmittedDrafts(submitted)
    onClearCardErrors?.(updates.map((u) => u.matchId))
    setPredictions((prev) => applyPredictionUpdates(prev, updates, allMatches))

    try {
      const res = await apiFetch(buildApiUrl('/predictions/bulk'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId, predictions: toSave }),
      })
      if (scopeSeqRef.current !== scopeSeq) return

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Erro ao salvar palpites')
      }

      const data = (await res.json()) as BulkSaveResponse
      if (scopeSeqRef.current !== scopeSeq) return
      const savedSet = new Set(data.saved)
      const accepted = updates.filter((u) => savedSet.has(u.matchId))
      const rejectedItems = updates.filter((u) => !savedSet.has(u.matchId))

      if (accepted.length > 0) {
        confirmedRef.current = applyPredictionUpdates(confirmedRef.current, accepted, allMatches)
      }
      revertItems(rejectedItems, tokens, bases)

      invalidateGroupsList(queryClient)
      invalidateGroupPredictions(queryClient)
      if (data.saved.length > 0) onBulkSaved?.(data.saved)

      if (roundViewRef.current !== roundView) return
      if (accepted.length > 0) setHasSavedPredictions(true)
      const rejected = bulkRejectionMessage(toSave.map((p) => p.match_id), data)
      if (rejected) setBulkError(rejected)
      else startSavedAllTimer()
    } catch (e) {
      if (scopeSeqRef.current !== scopeSeq) return
      revertItems(updates, tokens, bases)
      if (roundViewRef.current === roundView) setBulkError((e as Error).message)
    } finally {
      setSavingAll(false)
    }
  }

  const pendingCount = pendingDrafts().length

  return {
    savingAll,
    savedAll,
    hasSavedPredictions,
    bulkError,
    pendingCount,
    handleSaveAll,
    handleSaved,
    markHasSaved,
  }
}
