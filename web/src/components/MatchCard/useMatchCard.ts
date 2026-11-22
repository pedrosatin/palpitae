import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { needsPenaltyPick } from '../../lib/predictedTie'
import { buildApiUrl } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import { invalidateGroupPredictions } from '../../lib/groupPredictions'
import { invalidateGroupsList } from '../../lib/groupsList'
import { buildOptimisticPrediction } from '../../lib/predictionOptimistic'
import { isMatchLocked } from '../../lib/predictionDrafts'
import { type Match, type Prediction, OUTCOMES, type Outcome } from './types'
import { predictionStatus } from './predictionStatus'

const SAVE_TIMEOUT_MS = 10_000

export interface UseMatchCardProps {
  match: Match
  prediction: Prediction | undefined
  leg1Prediction?: Prediction
  leg1Pending?: boolean
  groupId: string
  outcomeOnly?: boolean
  onSaved: (
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) => void
  onSave?: (
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) => Promise<boolean>
  onDraftChange?: (matchId: string, home: string, away: string) => void
  onPenaltyDraftChange?: (matchId: string, winner: 'home' | 'away' | null) => void
  draft?: { home: string; away: string }
  penaltyDraft?: 'home' | 'away' | null
  hasDraft?: boolean
  externalError?: string | null
  now?: number
}

type SubmittedSnapshot = {
  home: string
  away: string
  penaltyWinner: 'home' | 'away' | null
}

function useMatchStatus(match: Match, prediction: Prediction | undefined, now?: number) {
  const isPostponed = Boolean(match.postponed)
  const locked = isMatchLocked(match, prediction, now ?? Date.now())
  const isFinished = match.status === 'finished'
  const hasPrediction = prediction !== undefined

  return { isPostponed, locked, isFinished, hasPrediction }
}

function outcomeOf(home: number, away: number): Outcome {
  return home > away ? 'home' : home < away ? 'away' : 'draw'
}

function useMatchDraft(
  prediction: Prediction | undefined,
  draft?: { home: string; away: string },
  penaltyDraft?: 'home' | 'away' | null,
  hasDraft?: boolean,
  submittedRef?: React.MutableRefObject<SubmittedSnapshot | null>,
  rollbackSeq = 0,
) {
  const [home, setHome] = useState<string>(
    draft?.home ?? (prediction !== undefined ? String(prediction.predicted_home_score) : ''),
  )
  const [away, setAway] = useState<string>(
    draft?.away ?? (prediction !== undefined ? String(prediction.predicted_away_score) : ''),
  )
  const [penaltyWinner, setPenaltyWinner] = useState<'home' | 'away' | null>(
    penaltyDraft !== undefined ? penaltyDraft : (prediction?.predicted_penalty_winner ?? null),
  )
  const [pendingOutcome, setPendingOutcome] = useState<'home' | 'draw' | 'away' | null>(() =>
    draft && draft.home !== '' && draft.away !== ''
      ? outcomeOf(Number(draft.home), Number(draft.away))
      : null,
  )
  const [reopenPenalty, setReopenPenalty] = useState(false)

  const persistedHome = prediction?.predicted_home_score
  const persistedAway = prediction?.predicted_away_score
  const persistedPenalty = prediction?.predicted_penalty_winner ?? null
  const persistedKey = `${persistedHome}:${persistedAway}:${persistedPenalty}`
  const lastPersisted = useRef({
    key: persistedKey,
    home: persistedHome !== undefined ? String(persistedHome) : '',
    away: persistedAway !== undefined ? String(persistedAway) : '',
    penaltyWinner: persistedPenalty,
  })
  const lastRollbackSeq = useRef(rollbackSeq)
  const activeDraft = hasDraft ?? (draft !== undefined || penaltyDraft !== undefined)
  useEffect(() => {
    const rolledBack = lastRollbackSeq.current !== rollbackSeq
    lastRollbackSeq.current = rollbackSeq
    const prev = lastPersisted.current
    if (prev.key === persistedKey && !rolledBack) return
    lastPersisted.current = {
      key: persistedKey,
      home: persistedHome !== undefined ? String(persistedHome) : '',
      away: persistedAway !== undefined ? String(persistedAway) : '',
      penaltyWinner: persistedPenalty,
    }
    const submitted = submittedRef?.current
    if (submittedRef) submittedRef.current = null
    if (activeDraft) return
    const matchesSubmitted =
      submitted !== null &&
      submitted !== undefined &&
      home === submitted.home &&
      away === submitted.away &&
      penaltyWinner === submitted.penaltyWinner
    if (
      submitted &&
      !matchesSubmitted
    ) {
      return
    }
    const matchesPrev =
      home === prev.home && away === prev.away && penaltyWinner === prev.penaltyWinner
    if (hasDraft === undefined && !matchesSubmitted && !matchesPrev) {
      return
    }
    if (persistedHome !== undefined && persistedAway !== undefined) {
      setHome(String(persistedHome))
      setAway(String(persistedAway))
      setPenaltyWinner(persistedPenalty)
      setPendingOutcome(null)
    } else {
      setHome('')
      setAway('')
      setPenaltyWinner(null)
      setPendingOutcome(null)
    }
  }, [
    persistedKey,
    persistedHome,
    persistedAway,
    persistedPenalty,
    activeDraft,
    home,
    away,
    penaltyWinner,
    submittedRef,
    rollbackSeq,
  ])

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

function useMatchPersistence({
  groupId,
  match,
  prediction,
  leg1Prediction,
  outcomeOnly,
  onSaved,
  onSave,
  submittedRef,
}: {
  groupId: string
  match: Match
  prediction: Prediction | undefined
  leg1Prediction: Prediction | undefined
  outcomeOnly: boolean
  onSaved: (
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) => void
  onSave?: (
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) => Promise<boolean>
  submittedRef: React.MutableRefObject<SubmittedSnapshot | null>
}) {
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [rollbackSeq, setRollbackSeq] = useState(0)
  const [optimisticPrediction, setOptimisticPrediction] = useState<Prediction | undefined>(undefined)
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const request = useRef<AbortController | null>(null)
  const saveSeq = useRef(0)
  const mounted = useRef(true)
  const lastPropPrediction = useRef(prediction)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(savedTimer.current)
      request.current = null
    }
  }, [])

  useEffect(() => {
    if (lastPropPrediction.current === prediction) return
    lastPropPrediction.current = prediction
    if (!saving) setOptimisticPrediction(undefined)
  }, [prediction, saving])

  async function persist(homeScore: number, awayScore: number, penWinner: 'home' | 'away' | null) {
    const seq = ++saveSeq.current
    clearTimeout(savedTimer.current)
    submittedRef.current = {
      home: String(homeScore),
      away: String(awayScore),
      penaltyWinner: penWinner,
    }
    setError(null)
    if (outcomeOnly) setSaved(true)

    if (onSave) {
      request.current?.abort()
      request.current = null
      setSaving(true)
      const ok = await onSave(match.id, homeScore, awayScore, penWinner)
      if (!mounted.current || saveSeq.current !== seq) return
      setSaving(false)
      if (!ok) {
        setSaved(false)
        setRollbackSeq((n) => n + 1)
        return
      }
      setSaved(true)
      savedTimer.current = setTimeout(() => setSaved(false), 2500)
      return
    }

    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS)
    setSaving(true)
    setOptimisticPrediction(
      buildOptimisticPrediction(
        prediction,
        match,
        homeScore,
        awayScore,
        penWinner,
        leg1Prediction,
      ),
    )

    let res: Response | null = null
    try {
      res = await apiFetch(buildApiUrl('/predictions'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: groupId,
          match_id: match.id,
          predicted_home_score: homeScore,
          predicted_away_score: awayScore,
          predicted_penalty_winner: penWinner,
        }),
        signal: controller.signal,
      })
    } catch {
    } finally {
      clearTimeout(timeout)
    }

    if (request.current !== controller) return
    setSaving(false)

    if (!res) {
      setOptimisticPrediction(undefined)
      setSaved(false)
      setRollbackSeq((n) => n + 1)
      setError('Erro de conexão. Tente novamente.')
      return
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (request.current !== controller) return
      setOptimisticPrediction(undefined)
      setSaved(false)
      setRollbackSeq((n) => n + 1)
      setError(data.error ?? 'Erro ao salvar palpite')
      return
    }

    void invalidateGroupsList(queryClient)
    void invalidateGroupPredictions(queryClient)
    setSaved(true)
    onSaved(match.id, homeScore, awayScore, penWinner)
    savedTimer.current = setTimeout(() => setSaved(false), 2500)
  }

  return {
    saving,
    error,
    saved,
    rollbackSeq,
    optimisticPrediction,
    persist,
  }
}

function matchControls({
  match,
  prediction,
  leg1Prediction,
  leg1Pending = false,
  home,
  away,
  penaltyWinner,
  pendingOutcome,
  locked,
}: {
  match: Match
  prediction?: Prediction
  leg1Prediction?: Prediction
  leg1Pending?: boolean
  home: string
  away: string
  penaltyWinner: 'home' | 'away' | null
  pendingOutcome: Outcome | null
  locked: boolean
}) {
  const selectedOutcome: Outcome | null =
    pendingOutcome ??
    (prediction !== undefined
      ? outcomeOf(prediction.predicted_home_score, prediction.predicted_away_score)
      : null)

  const showPenaltyPicker =
    !locked &&
    home !== '' &&
    away !== '' &&
    needsPenaltyPick(match, Number(home), Number(away), leg1Prediction)

  const status = predictionStatus({ prediction, home, away, penaltyWinner, showPenaltyPicker })
  const penaltyReady = !showPenaltyPicker || penaltyWinner !== null
  const canSave =
    !leg1Pending &&
    !locked &&
    home !== '' &&
    away !== '' &&
    status !== 'saved' &&
    penaltyReady
  const saveDone = status === 'saved'
  return { selectedOutcome, showPenaltyPicker, canSave, status, saveDone }
}

export function useMatchCard({
  match,
  prediction,
  leg1Prediction,
  leg1Pending = false,
  groupId,
  outcomeOnly = false,
  onSaved,
  onSave,
  onDraftChange,
  onPenaltyDraftChange,
  draft,
  penaltyDraft,
  hasDraft,
  externalError,
  now,
}: UseMatchCardProps) {
  const submittedRef = useRef<SubmittedSnapshot | null>(null)
  const { saving, saved, rollbackSeq, error: localError, optimisticPrediction, persist } =
    useMatchPersistence({
      groupId,
      match,
      prediction,
      leg1Prediction,
      outcomeOnly,
      onSaved,
      onSave,
      submittedRef,
    })

  const effectivePrediction = onSave ? prediction : (optimisticPrediction ?? prediction)
  const { isPostponed, locked, isFinished, hasPrediction } = useMatchStatus(
    match,
    effectivePrediction,
    now,
  )

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
  } = useMatchDraft(effectivePrediction, draft, penaltyDraft, hasDraft, submittedRef, rollbackSeq)

  const { selectedOutcome, showPenaltyPicker, canSave, status, saveDone } = matchControls({
    match,
    prediction: effectivePrediction,
    leg1Prediction,
    leg1Pending,
    home,
    away,
    penaltyWinner,
    pendingOutcome,
    locked,
  })

  async function handleSave() {
    if (!canSave) return
    trackEvent('click_matchcard_salvar', { match_id: match.id })
    await persist(Number(home), Number(away), showPenaltyPicker ? penaltyWinner : null)
  }

  async function selectOutcome(outcome: Outcome) {
    if (locked) return
    if (outcome === selectedOutcome && status === 'saved') return
    trackEvent('click_matchcard_resultado', { match_id: match.id, outcome })
    const { home: h, away: a } = OUTCOMES[outcome]
    setHome(String(h))
    setAway(String(a))
    setPendingOutcome(outcome)
    onDraftChange?.(match.id, String(h), String(a))

    if (needsPenaltyPick(match, h, a, leg1Prediction)) {
      return
    }
    if (penaltyWinner !== null) {
      setPenaltyWinner(null)
      onPenaltyDraftChange?.(match.id, null)
    }
    if (!leg1Pending) await persist(h, a, null)
  }

  async function selectPenaltyWinner(winner: 'home' | 'away') {
    if (locked) return
    trackEvent('click_prediction_penalty_winner', {
      match_id: match.id,
      winner,
    })
    setPenaltyWinner(winner)
    setReopenPenalty(false)
    onPenaltyDraftChange?.(match.id, winner)
    if (outcomeOnly && !leg1Pending && home !== '' && away !== '') {
      await persist(Number(home), Number(away), winner)
    }
  }

  function clearPenaltyIfLeavingDraw(nextHome: string, nextAway: string) {
    const stillDraw =
      nextHome !== '' &&
      nextAway !== '' &&
      needsPenaltyPick(match, Number(nextHome), Number(nextAway), leg1Prediction)
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
    error: onSave ? (externalError ?? null) : localError,
    effectivePrediction,
    canSave,
    status,
    saveDone,
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
