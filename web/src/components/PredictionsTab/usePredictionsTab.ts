import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { useMatchRounds } from '../../hooks/useMatchRounds'
import { apiFetch } from '../../lib/api'
import { invalidateApiCache } from '../../lib/api-cache'
import { applyDefaultRoundFromMatches, fetchCompetitionMatches } from '../../lib/competitionMatches'
import type { Match, Prediction } from '../MatchCard'
import { usePredictionsBulkSave } from './usePredictionsBulkSave'

type PredictionMap = Map<string, Prediction>

function usePredictionsFetch(groupId: string, competitionId: string) {
  const [matches, setMatches] = useState<Match[]>([])
  const [predictions, setPredictions] = useState<PredictionMap>(new Map())
  const [importCompleted, setImportCompleted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roundIndex, setRoundIndex] = useState(0)

  useEffect(() => {
    let active = true
    setImportCompleted(false)
    setLoading(true)
    setError(null)

    Promise.all([
      fetchCompetitionMatches(competitionId),
      apiFetch(`${config.apiUrl}/predictions?group_id=${encodeURIComponent(groupId)}`).then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar palpites')
        return r.json() as Promise<{ predictions: Prediction[]; import_completed?: boolean }>
      }),
    ])
      .then(([matchesData, predictionsData]) => {
        if (!active) return
        setImportCompleted(predictionsData.import_completed === true)
        setMatches(matchesData.matches)
        const map = new Map<string, Prediction>()
        for (const p of predictionsData.predictions) map.set(p.match_id, p)
        setPredictions(map)

        applyDefaultRoundFromMatches(matchesData.matches, matchesData.default_round, setRoundIndex)
      })
      .catch((e: Error) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [groupId, competitionId])

  return {
    matches,
    predictions,
    setPredictions,
    loading,
    error,
    roundIndex,
    setRoundIndex,
    importCompleted,
    setImportCompleted,
  }
}

function usePredictionsImport(
  groupId: string,
  competitionId: string,
  setPredictions: Dispatch<SetStateAction<PredictionMap>>,
  setImportCompleted: Dispatch<SetStateAction<boolean>>,
) {
  const scope = useRef({ active: true })
  const [importExpanded, setImportExpanded] = useState(false)
  const [otherGroups, setOtherGroups] = useState<{ id: string; name: string }[]>([])
  const [importSourceId, setImportSourceId] = useState<string>('')
  const [importing, setImporting] = useState(false)
  const [importFeedback, setImportFeedback] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  useEffect(() => {
    const current = { active: true }
    scope.current = current
    setOtherGroups([])
    setImportSourceId('')
    setImporting(false)
    setImportFeedback(null)
    setImportExpanded(false)
    apiFetch(`${config.apiUrl}/groups`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar grupos')
        return r.json() as Promise<{
          groups: Array<{ id: string; name: string; competition_id: string }>
        }>
      })
      .then((data) => {
        if (!current.active) return
        const siblings = data.groups.filter(
          (g) => g.competition_id === competitionId && g.id !== groupId,
        )
        setOtherGroups(siblings)
        if (siblings.length > 0) setImportSourceId(siblings[0].id)
      })
      .catch(() => {})
    return () => {
      current.active = false
    }
  }, [groupId, competitionId])

  async function handleImport() {
    const current = scope.current
    if (!importSourceId || !current.active) return
    trackEvent('click_predictions_importar')
    setImporting(true)
    setImportFeedback(null)
    try {
      const res = await apiFetch(`${config.apiUrl}/predictions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_group_id: importSourceId,
          target_group_id: groupId,
        }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        imported?: number
        locked_skipped?: number
      }
      if (!res.ok) throw new Error(data.error ?? 'Erro ao importar palpites')

      if (!current.active) return
      const imported = data.imported ?? 0
      const skipped = data.locked_skipped ?? 0
      const msg =
        skipped > 0
          ? `${imported} palpite(s) importado(s). ${skipped} já bloqueado(s) foram ignorados.`
          : `${imported} palpite(s) importado(s) com sucesso!`
      if (imported > 0) {
        setImportCompleted(true)
        setImportExpanded(false)
        // Import altera pending_predictions do grupo alvo na home.
        invalidateApiCache('groups:')
      }
      setImportFeedback({ ok: true, message: msg })
      try {
        const predsRes = await apiFetch(
          `${config.apiUrl}/predictions?group_id=${encodeURIComponent(groupId)}`,
        )
        if (!predsRes.ok) throw new Error('Erro ao atualizar palpites')
        const predsData = (await predsRes.json()) as { predictions: Prediction[] }
        const map = new Map<string, Prediction>()
        for (const p of predsData.predictions) map.set(p.match_id, p)
        if (current.active) setPredictions(map)
      } catch {
        if (current.active)
          setImportFeedback({
            ok: false,
            message: `${msg} Não foi possível atualizar os palpites na tela. Recarregue a página.`,
          })
      }
    } catch (e) {
      if (current.active) setImportFeedback({ ok: false, message: (e as Error).message })
    } finally {
      if (current.active) setImporting(false)
    }
  }

  return {
    importExpanded,
    setImportExpanded,
    otherGroups,
    importSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    handleImport,
  }
}

export function usePredictionsTab(groupId: string, competitionId: string) {
  const {
    matches,
    predictions,
    setPredictions,
    loading,
    error,
    roundIndex,
    setRoundIndex,
    importCompleted,
    setImportCompleted,
  } = usePredictionsFetch(groupId, competitionId)

  const {
    importExpanded,
    setImportExpanded,
    otherGroups,
    importSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    handleImport,
  } = usePredictionsImport(groupId, competitionId, setPredictions, setImportCompleted)

  const {
    roundKeys,
    safeIndex,
    selectedRound,
    roundMatches,
    labelFor,
    postponedByRound,
    prev,
    next,
  } = useMatchRounds(matches, roundIndex, setRoundIndex, {
    prev: 'click_predictions_rodada_anterior',
    next: 'click_predictions_proxima_rodada',
  })

  const {
    drafts,
    savingAll,
    savedAll,
    hasSavedPredictions,
    bulkError,
    pendingCount,
    handleSaveAll,
    handleSaved,
    handleDraftChange,
    handlePenaltyDraftChange,
  } = usePredictionsBulkSave(
    groupId,
    roundMatches,
    predictions,
    setPredictions,
    selectedRound,
    matches,
  )

  return {
    importCompleted,
    drafts,
    matches,
    predictions,
    loading,
    error,
    roundKeys,
    safeIndex,
    selectedRound,
    roundMatches,
    labelFor,
    postponedByRound,
    prev,
    next,
    setRoundIndex,
    savingAll,
    savedAll,
    hasSavedPredictions,
    bulkError,
    pendingCount,
    handleSaveAll,
    importExpanded,
    setImportExpanded,
    otherGroups,
    importSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    handleImport,
    handleSaved,
    handleDraftChange,
    handlePenaltyDraftChange,
  }
}
