import { useState, useRef, useEffect, Dispatch, SetStateAction } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import { collectRoundDrafts } from '../../lib/predictionDrafts'
import type { Match, Prediction } from '../MatchCard'

type PredictionMap = Map<string, Prediction>

export function usePredictionsBulkSave(
  groupId: string,
  roundMatches: Match[],
  predictions: PredictionMap,
  setPredictions: Dispatch<SetStateAction<PredictionMap>>,
  selectedRound: string | undefined,
) {
  const [drafts, setDrafts] = useState<Map<string, { home: string; away: string }>>(new Map())
  const [penaltyDrafts, setPenaltyDrafts] = useState<Map<string, 'home' | 'away' | null>>(new Map())

  const [savingAll, setSavingAll] = useState(false)
  const [savedAll, setSavedAll] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const savedAllTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearSavedAllTimer() {
    if (savedAllTimerRef.current) {
      clearTimeout(savedAllTimerRef.current)
      savedAllTimerRef.current = null
    }
  }

  // Cancel the savedAll feedback timer and reset savedAll when the round changes,
  // and on unmount — otherwise a stale timeout can fire after a second save,
  // flipping savedAll back off (or on) at the wrong time.
  useEffect(() => {
    clearSavedAllTimer()
    setSavedAll(false)
  }, [selectedRound])

  useEffect(() => {
    return () => clearSavedAllTimer()
  }, [])

  function handleSaved(
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) {
    setPredictions((prev) => {
      const next = new Map(prev)
      const existing = prev.get(matchId)
      next.set(matchId, {
        id: existing?.id ?? '',
        match_id: matchId,
        predicted_home_score: home,
        predicted_away_score: away,
        predicted_penalty_winner: penaltyWinner,
        points_awarded: existing?.points_awarded ?? 0,
        penalty_points: existing?.penalty_points ?? 0,
        locked: 0,
        updated_at: new Date().toISOString(),
      })
      return next
    })
  }

  function handleDraftChange(matchId: string, home: string, away: string) {
    setDrafts((prev) => {
      const next = new Map(prev)
      next.set(matchId, { home, away })
      return next
    })
  }

  function handlePenaltyDraftChange(matchId: string, winner: 'home' | 'away' | null) {
    setPenaltyDrafts((prev) => {
      const next = new Map(prev)
      next.set(matchId, winner)
      return next
    })
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

      const data = (await res.json()) as { saved: string[] }
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

      setSavedAll(true)
      savedAllTimerRef.current = setTimeout(() => setSavedAll(false), 2500)
    } catch (e) {
      setBulkError((e as Error).message)
    } finally {
      setSavingAll(false)
    }
  }

  const pendingCount = pendingDrafts().length

  return {
    savingAll,
    savedAll,
    bulkError,
    pendingCount,
    handleSaveAll,
    handleSaved,
    handleDraftChange,
    handlePenaltyDraftChange,
  }
}
