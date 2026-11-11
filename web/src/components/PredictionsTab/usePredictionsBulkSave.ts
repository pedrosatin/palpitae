import { useState, useRef, useEffect, Dispatch, SetStateAction } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import { invalidateApiCache } from '../../lib/api-cache'
import { predictedClassified } from '../../lib/predictedTie'
import { collectRoundDrafts, type UnsavedDrafts } from '../../lib/predictionDrafts'
import type { Match, Prediction } from '../MatchCard'

type PredictionMap = Map<string, Prediction>

function applyPredictionUpdate(
  prev: PredictionMap,
  matchId: string,
  home: number,
  away: number,
  penaltyWinner: 'home' | 'away' | null,
  allMatches: Match[],
): PredictionMap {
  const next = new Map(prev)
  const existing = prev.get(matchId)
  const match = allMatches.find((m) => m.id === matchId)
  next.set(matchId, {
    id: existing?.id ?? '',
    match_id: matchId,
    predicted_home_score: home,
    predicted_away_score: away,
    predicted_penalty_winner: penaltyWinner,
    classified_points: existing?.classified_points ?? 0,
    predicted_classified: match
      ? predictedClassified(
          match,
          home,
          away,
          penaltyWinner,
          match.leg1_match_id ? prev.get(match.leg1_match_id) : undefined,
        )
      : null,
    points_awarded: existing?.points_awarded ?? 0,
    penalty_points: existing?.penalty_points ?? 0,
    locked: 0,
    updated_at: new Date().toISOString(),
  })
  for (const context of allMatches) {
    const pick = next.get(context.id)
    if (!pick) continue
    next.set(context.id, {
      ...pick,
      predicted_classified: predictedClassified(
        context,
        pick.predicted_home_score,
        pick.predicted_away_score,
        pick.predicted_penalty_winner ?? null,
        context.leg1_match_id ? next.get(context.leg1_match_id) : undefined,
      ),
    })
  }
  return next
}

type BulkSaveResponse = { saved: string[]; locked?: string[]; not_found?: string[] }

function count(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`
}

/**
 * Aviso de um "Salvar todos" em que algum jogo enviado não voltou entre os salvos:
 * quantos foram salvos, o motivo de cada recusa e o que fazer. Jogo travado ou
 * fora do campeonato só sai da tela depois de recarregar a lista de jogos. Sem
 * motivo na resposta, vale tentar de novo. `null` quando todos foram salvos.
 */
function bulkRejectionMessage(sent: string[], data: BulkSaveResponse): string | null {
  const saved = new Set(data.saved)
  const rejected = sent.filter((id) => !saved.has(id))
  if (rejected.length === 0) return null
  const locked = rejected.filter((id) => data.locked?.includes(id)).length
  const notFound = rejected.filter((id) => data.not_found?.includes(id)).length
  const other = rejected.length - locked - notFound
  const accepted = sent.length - rejected.length
  return [
    accepted > 0 && count(accepted, 'palpite salvo.', 'palpites salvos.'),
    locked > 0 &&
      count(locked, 'jogo já bloqueado ficou de fora.', 'jogos já bloqueados ficaram de fora.'),
    notFound > 0 &&
      count(
        notFound,
        'jogo não foi encontrado neste campeonato.',
        'jogos não foram encontrados neste campeonato.',
      ),
    other > 0 && count(other, 'palpite não foi salvo.', 'palpites não foram salvos.'),
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

  // Cada rodada exibida ganha um número. O envio guarda o número da rodada em que
  // começou, e a resposta que volta depois da troca não mostra aviso na rodada nova.
  const roundViewRef = useRef(0)

  // Cancel the savedAll feedback timer and reset savedAll when the round changes,
  // and on unmount — otherwise a stale timeout can fire after a second save,
  // flipping savedAll back off (or on) at the wrong time. O aviso de erro ou de
  // palpite recusado também é da rodada anterior e sai junto.
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

export function usePredictionsBulkSave(
  groupId: string,
  roundMatches: Match[],
  predictions: PredictionMap,
  setPredictions: Dispatch<SetStateAction<PredictionMap>>,
  selectedRound: string | undefined,
  allMatches: Match[],
  { drafts, penaltyDrafts }: UnsavedDrafts,
  /** Chamado com os jogos gravados depois de um "Salvar todos". */
  onBulkSaved?: (matchIds: string[]) => void,
) {
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

  function handleSaved(
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) {
    setHasSavedPredictions(true)
    setPredictions((prev) =>
      applyPredictionUpdate(prev, matchId, home, away, penaltyWinner, allMatches)
    )
  }

  function pendingDrafts() {
    return collectRoundDrafts({ roundMatches, drafts, penaltyDrafts, predictions })
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

    try {
      const res = await apiFetch(`${config.apiUrl}/predictions/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId, predictions: toSave }),
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Erro ao salvar palpites')
      }

      const data = (await res.json()) as BulkSaveResponse
      const savedSet = new Set(data.saved)
      for (const p of toSave) {
        if (savedSet.has(p.match_id)) {
          handleSaved(
            p.match_id,
            p.predicted_home_score,
            p.predicted_away_score,
            p.predicted_penalty_winner ?? null,
          )
        }
      }

      // Home cards leem pending_predictions via fetchCachedJson (TTL 30s).
      // Sem invalidar, voltar à dashboard dentro do TTL mostra N antigo.
      invalidateApiCache('groups:')
      if (data.saved.length > 0) onBulkSaved?.(data.saved)

      if (roundViewRef.current !== roundView) return
      const rejected = bulkRejectionMessage(toSave.map((p) => p.match_id), data)
      if (rejected) setBulkError(rejected)
      else startSavedAllTimer()
    } catch (e) {
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
  }
}
