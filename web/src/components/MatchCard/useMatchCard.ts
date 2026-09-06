import { useEffect, useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import { type Match, type Prediction, OUTCOMES, type Outcome } from './types'

export interface UseMatchCardProps {
  match: Match
  prediction: Prediction | undefined
  groupId: string
  outcomeOnly?: boolean
  onSaved: (
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) => void
  onDraftChange?: (matchId: string, home: string, away: string) => void
  onPenaltyDraftChange?: (matchId: string, winner: 'home' | 'away' | null) => void
}

function useMatchStatus(match: Match, prediction: Prediction | undefined) {
  // Jogo adiado nunca trava: o `start_time` guardado ainda é o horário original
  // (já passou), então a checagem por data sozinha travaria o palpite para sempre.
  // Espelha a regra do servidor em api/src/matches/locking.ts.
  const isPostponed = Boolean(match.postponed)
  const locked =
    !isPostponed && (Boolean(prediction?.locked) || new Date() >= new Date(match.start_time))
  const isFinished = match.status === 'finished'
  const hasPrediction = prediction !== undefined

  return { isPostponed, locked, isFinished, hasPrediction }
}

function useMatchDraft(prediction: Prediction | undefined) {
  const [home, setHome] = useState<string>(
    prediction !== undefined ? String(prediction.predicted_home_score) : '0',
  )
  const [away, setAway] = useState<string>(
    prediction !== undefined ? String(prediction.predicted_away_score) : '0',
  )
  const [penaltyWinner, setPenaltyWinner] = useState<'home' | 'away' | null>(
    prediction?.predicted_penalty_winner ?? null,
  )
  const [pendingOutcome, setPendingOutcome] = useState<'home' | 'draw' | 'away' | null>(null)
  const [reopenPenalty, setReopenPenalty] = useState(false)

  useEffect(() => {
    if (prediction !== undefined) {
      setHome(String(prediction.predicted_home_score))
      setAway(String(prediction.predicted_away_score))
      setPenaltyWinner(prediction.predicted_penalty_winner ?? null)
    }
  }, [prediction])

  return {
    home,
    setHome,
    away,
    setAway,
    penaltyWinner,
    setPenaltyWinner,
    pendingOutcome,
    setPendingOutcome,
    reopenPenalty,
    setReopenPenalty,
  }
}

function useMatchPersistence(
  groupId: string,
  matchId: string,
  onSaved: (
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) => void,
) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function persist(homeScore: number, awayScore: number, penWinner: 'home' | 'away' | null) {
    setSaving(true)
    setError(null)
    setSaved(false)

    const res = await apiFetch(`${config.apiUrl}/predictions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: groupId,
        match_id: matchId,
        predicted_home_score: homeScore,
        predicted_away_score: awayScore,
        predicted_penalty_winner: penWinner,
      }),
    })

    setSaving(false)

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Erro ao salvar palpite')
      return
    }

    setSaved(true)
    onSaved(matchId, homeScore, awayScore, penWinner)
    setTimeout(() => setSaved(false), 2500)
  }

  return { saving, error, saved, persist }
}

export function useMatchCard({
  match,
  prediction,
  groupId,
  outcomeOnly = false,
  onSaved,
  onDraftChange,
  onPenaltyDraftChange,
}: UseMatchCardProps) {
  const { isPostponed, locked, isFinished, hasPrediction } = useMatchStatus(match, prediction)

  const {
    home,
    setHome,
    away,
    setAway,
    penaltyWinner,
    setPenaltyWinner,
    pendingOutcome,
    setPendingOutcome,
    reopenPenalty,
    setReopenPenalty,
  } = useMatchDraft(prediction)

  const { saving, saved, error, persist } = useMatchPersistence(groupId, match.id, onSaved)

  const selectedOutcome: Outcome | null =
    prediction !== undefined
      ? prediction.predicted_home_score > prediction.predicted_away_score
        ? 'home'
        : prediction.predicted_home_score < prediction.predicted_away_score
          ? 'away'
          : 'draw'
      : pendingOutcome

  const drawMarked = outcomeOnly
    ? selectedOutcome === 'draw'
    : home !== '' && away !== '' && Number(home) === Number(away)
  const showPenaltyPicker = !locked && Boolean(match.decides_on_penalties) && drawMarked

  const scoreChanged =
    prediction !== undefined
      ? Number(home) !== prediction.predicted_home_score ||
        Number(away) !== prediction.predicted_away_score
      : true
  const penaltyChanged = (penaltyWinner ?? null) !== (prediction?.predicted_penalty_winner ?? null)
  const hasChanged = scoreChanged || penaltyChanged
  const penaltyReady = !showPenaltyPicker || penaltyWinner !== null
  const canSave = !locked && home !== '' && away !== '' && !saving && hasChanged && penaltyReady

  async function handleSave() {
    if (!canSave) return
    trackEvent('click_matchcard_salvar', { match_id: match.id })
    await persist(Number(home), Number(away), showPenaltyPicker ? penaltyWinner : null)
  }

  async function selectOutcome(outcome: Outcome) {
    if (locked || saving) return
    if (outcome === selectedOutcome) return
    trackEvent('click_matchcard_resultado', { match_id: match.id, outcome })
    const { home: h, away: a } = OUTCOMES[outcome]
    setHome(String(h))
    setAway(String(a))
    setPendingOutcome(outcome)
    onDraftChange?.(match.id, String(h), String(a))

    if (outcome === 'draw' && match.decides_on_penalties) {
      return
    }
    if (penaltyWinner !== null) {
      setPenaltyWinner(null)
      onPenaltyDraftChange?.(match.id, null)
    }
    await persist(h, a, null)
  }

  async function selectPenaltyWinner(winner: 'home' | 'away') {
    if (locked || saving) return
    trackEvent('click_prediction_penalty_winner', {
      match_id: match.id,
      winner,
    })
    setPenaltyWinner(winner)
    setReopenPenalty(false)
    onPenaltyDraftChange?.(match.id, winner)
    if (outcomeOnly) {
      await persist(0, 0, winner)
    }
  }

  function clearPenaltyIfLeavingDraw(nextHome: string, nextAway: string) {
    const stillDraw = nextHome !== '' && nextAway !== '' && Number(nextHome) === Number(nextAway)
    if (!stillDraw && penaltyWinner !== null) {
      setPenaltyWinner(null)
      setReopenPenalty(false)
      onPenaltyDraftChange?.(match.id, null)
    }
  }

  function updateHome(v: string) {
    setHome(v)
    onDraftChange?.(match.id, v, away)
    clearPenaltyIfLeavingDraw(v, away)
  }

  function updateAway(v: string) {
    setAway(v)
    onDraftChange?.(match.id, home, v)
    clearPenaltyIfLeavingDraw(home, v)
  }

  function handleScoreInput(value: string, update: (v: string) => void) {
    if (value === '' || /^\d{1,2}$/.test(value)) update(value)
  }

  return {
    locked,
    isPostponed,
    isFinished,
    hasPrediction,
    saving,
    saved,
    error,
    canSave,
    home,
    away,
    penaltyWinner,
    reopenPenalty,
    selectedOutcome,
    showPenaltyPicker,
    setReopenPenalty,
    handleSave,
    selectOutcome,
    selectPenaltyWinner,
    updateHome,
    updateAway,
    handleScoreInput,
  }
}
