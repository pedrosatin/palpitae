import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import { fetchCachedJson } from '../../lib/api-cache'
import { applyDefaultRound } from '../../lib/rounds'
import type { Match, Prediction } from '../MatchCard'

type PredictionMap = Map<string, Prediction>

function usePredictionsFetch(groupId: string, competitionId: string) {
  const [matches, setMatches] = useState<Match[]>([])
  const [predictions, setPredictions] = useState<PredictionMap>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roundIndex, setRoundIndex] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)

    Promise.all([
      fetchCachedJson(
        `matches:${competitionId}`,
        () =>
          apiFetch(
            `${config.apiUrl}/matches?competition_id=${encodeURIComponent(competitionId)}`,
          ).then((r) => {
            if (!r.ok) throw new Error('Erro ao carregar jogos')
            return r.json() as Promise<{
              matches: Match[]
              default_round: string | null
            }>
          }),
        30_000,
      ),
      apiFetch(`${config.apiUrl}/predictions?group_id=${encodeURIComponent(groupId)}`).then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar palpites')
        return r.json() as Promise<{ predictions: Prediction[] }>
      }),
    ])
      .then(([matchesData, predictionsData]) => {
        setMatches(matchesData.matches)
        const map = new Map<string, Prediction>()
        for (const p of predictionsData.predictions) map.set(p.match_id, p)
        setPredictions(map)

        const keys = [...new Set(matchesData.matches.map((m) => m.round))]
        applyDefaultRound(matchesData.default_round, keys, setRoundIndex)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId, competitionId])

  return { matches, predictions, setPredictions, loading, error, roundIndex, setRoundIndex }
}

function usePredictionsImport(
  groupId: string,
  competitionId: string,
  setPredictions: Dispatch<SetStateAction<PredictionMap>>,
) {
  const [otherGroups, setOtherGroups] = useState<{ id: string; name: string }[]>([])
  const [importSourceId, setImportSourceId] = useState<string>('')
  const [importing, setImporting] = useState(false)
  const [importFeedback, setImportFeedback] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  useEffect(() => {
    fetchCachedJson(
      'groups:list',
      () =>
        apiFetch(`${config.apiUrl}/groups`).then((r) => {
          if (!r.ok) throw new Error('Erro ao carregar grupos')
          return r.json() as Promise<{
            groups: Array<{
              id: string
              name: string
              competition_id: string
            }>
          }>
        }),
      30_000,
    )
      .then((data) => {
        const siblings = data.groups.filter(
          (g) => g.competition_id === competitionId && g.id !== groupId,
        )
        setOtherGroups(siblings)
        if (siblings.length > 0) setImportSourceId(siblings[0].id)
      })
      .catch(() => {})
  }, [groupId, competitionId])

  async function handleImport() {
    if (!importSourceId) return
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

      const predsRes = await apiFetch(
        `${config.apiUrl}/predictions?group_id=${encodeURIComponent(groupId)}`,
      )
      const predsData = (await predsRes.json()) as {
        predictions: Prediction[]
      }
      const map = new Map<string, Prediction>()
      for (const p of predsData.predictions) map.set(p.match_id, p)
      setPredictions(map)

      const imported = data.imported ?? 0
      const skipped = data.locked_skipped ?? 0
      const msg =
        skipped > 0
          ? `${imported} palpite(s) importado(s). ${skipped} já bloqueado(s) foram ignorados.`
          : `${imported} palpite(s) importado(s) com sucesso!`
      setImportFeedback({ ok: true, message: msg })
      setTimeout(() => setImportFeedback(null), 4000)
    } catch (e) {
      setImportFeedback({ ok: false, message: (e as Error).message })
    } finally {
      setImporting(false)
    }
  }

  return {
    otherGroups,
    importSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    handleImport,
  }
}

function usePredictionsRounds(
  matches: Match[],
  roundIndex: number,
  setRoundIndex: Dispatch<SetStateAction<number>>,
) {
  // Group matches by round
  const rounds = new Map<string, Match[]>()
  for (const m of matches) {
    const key = m.round
    if (!rounds.has(key)) rounds.set(key, [])
    rounds.get(key)!.push(m)
  }

  const roundKeys = Array.from(rounds.keys())
  const labelFor = (r: string) => rounds.get(r)?.[0]?.round_label ?? r
  const safeIndex = Math.min(roundIndex, roundKeys.length - 1)
  const selectedRound = roundKeys[safeIndex]
  const roundMatches = rounds.get(selectedRound) ?? []

  function prev() {
    trackEvent('click_predictions_rodada_anterior', {
      round: roundKeys[Math.max(0, safeIndex - 1)],
    })
    setRoundIndex((i) => Math.max(0, i - 1))
  }

  function next() {
    trackEvent('click_predictions_proxima_rodada', {
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
    prev,
    next,
  }
}

function usePredictionsBulkSave(
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

  function isLocked(match: Match): boolean {
    const p = predictions.get(match.id)
    return Boolean(p?.locked) || new Date() >= new Date(match.start_time)
  }

  function collectRoundDrafts() {
    const out: Array<{
      match_id: string
      predicted_home_score: number
      predicted_away_score: number
      predicted_penalty_winner?: 'home' | 'away' | null
    }> = []
    for (const m of roundMatches) {
      if (isLocked(m)) continue
      const d = drafts.get(m.id)
      const hasPenaltyDraft = penaltyDrafts.has(m.id)
      if (!d && !hasPenaltyDraft) continue
      const p = predictions.get(m.id)
      const homeStr = d?.home ?? (p ? String(p.predicted_home_score) : '0')
      const awayStr = d?.away ?? (p ? String(p.predicted_away_score) : '0')
      if (homeStr === '' || awayStr === '') continue
      const home = Number(homeStr)
      const away = Number(awayStr)

      const eligibleDraw = home === away && Boolean(m.decides_on_penalties)
      const penaltyWinner: 'home' | 'away' | null = eligibleDraw
        ? hasPenaltyDraft
          ? (penaltyDrafts.get(m.id) ?? null)
          : (p?.predicted_penalty_winner ?? null)
        : null
      if (eligibleDraw && penaltyWinner === null) continue

      const scoreChanged = !p || home !== p.predicted_home_score || away !== p.predicted_away_score
      const penaltyChanged = penaltyWinner !== (p?.predicted_penalty_winner ?? null)
      if (scoreChanged || penaltyChanged) {
        out.push({
          match_id: m.id,
          predicted_home_score: home,
          predicted_away_score: away,
          predicted_penalty_winner: penaltyWinner,
        })
      }
    }
    return out
  }

  async function handleSaveAll() {
    const toSave = collectRoundDrafts()
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

  const pendingCount = collectRoundDrafts().length

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

export function usePredictionsTab(groupId: string, competitionId: string) {
  const { matches, predictions, setPredictions, loading, error, roundIndex, setRoundIndex } =
    usePredictionsFetch(groupId, competitionId)

  const {
    otherGroups,
    importSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    handleImport,
  } = usePredictionsImport(groupId, competitionId, setPredictions)

  const { roundKeys, safeIndex, selectedRound, roundMatches, labelFor, prev, next } =
    usePredictionsRounds(matches, roundIndex, setRoundIndex)

  const {
    savingAll,
    savedAll,
    bulkError,
    pendingCount,
    handleSaveAll,
    handleSaved,
    handleDraftChange,
    handlePenaltyDraftChange,
  } = usePredictionsBulkSave(groupId, roundMatches, predictions, setPredictions, selectedRound)

  return {
    matches,
    predictions,
    loading,
    error,
    roundKeys,
    safeIndex,
    selectedRound,
    roundMatches,
    labelFor,
    prev,
    next,
    setRoundIndex,
    savingAll,
    savedAll,
    bulkError,
    pendingCount,
    handleSaveAll,
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
