import { useEffect, useRef, useState } from 'react'
import { needsPenaltyPick } from '../../lib/predictedTie'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import { invalidateApiCache } from '../../lib/api-cache'
import { isMatchLocked } from '../../lib/predictionDrafts'
import { type Match, type Prediction, OUTCOMES, type Outcome } from './types'
import { predictionStatus } from './predictionStatus'

/** Prazo do PUT do card. Sem resposta até lá, o envio vira erro de conexão. */
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
  onDraftChange?: (matchId: string, home: string, away: string) => void
  onPenaltyDraftChange?: (matchId: string, winner: 'home' | 'away' | null) => void
  draft?: { home: string; away: string }
  penaltyDraft?: 'home' | 'away' | null
  now?: number
}

function useMatchStatus(match: Match, prediction: Prediction | undefined, now?: number) {
  // A mesma regra dos rascunhos e do "Salvar todos", que espelha a da API em
  // api/src/matches/locking.ts. O `locked` que a API devolveu no palpite também trava.
  const isPostponed = Boolean(match.postponed)
  const locked = isMatchLocked(match, prediction, now ?? Date.now())
  const isFinished = match.status === 'finished'
  const hasPrediction = prediction !== undefined

  return { isPostponed, locked, isFinished, hasPrediction }
}

function outcomeOf(home: number, away: number): Outcome {
  return home > away ? 'home' : home < away ? 'away' : 'draw'
}

/**
 * Estado dos campos do card. Começa pelo rascunho guardado (`draft`,
 * `penaltyDraft`), se houver, senão pelo palpite salvo; depois segue o palpite
 * salvo sempre que ele muda (salvar, importar). Jogo sem palpite começa com os
 * dois campos vazios, e um 0×0 só aparece quando o usuário escolhe.
 */
function useMatchDraft(
  prediction: Prediction | undefined,
  draft?: { home: string; away: string },
  penaltyDraft?: 'home' | 'away' | null,
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
  // Só reage quando o palpite salvo muda. Na montagem, o valor inicial pode ser
  // um rascunho restaurado, e o efeito não deve sobrescrevê-lo.
  const persistedKey = `${persistedHome}:${persistedAway}:${persistedPenalty}`
  const lastPersistedKey = useRef(persistedKey)
  useEffect(() => {
    if (lastPersistedKey.current === persistedKey) return
    lastPersistedKey.current = persistedKey
    if (persistedHome !== undefined && persistedAway !== undefined) {
      setHome(String(persistedHome))
      setAway(String(persistedAway))
      setPenaltyWinner(persistedPenalty)
      setPendingOutcome(null)
    }
  }, [persistedKey, persistedHome, persistedAway, persistedPenalty])

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
  // O "salvo" de um envio anterior não apaga o de um envio novo.
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Envio em andamento. Fica nulo quando o card sai da tela. O PUT segue até o
  // servidor e a resposta dele é ignorada, porque o pai pode já ter uma edição
  // mais nova deste jogo.
  const request = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      clearTimeout(savedTimer.current)
      request.current = null
    },
    [],
  )

  async function persist(homeScore: number, awayScore: number, penWinner: 'home' | 'away' | null) {
    clearTimeout(savedTimer.current)
    const controller = new AbortController()
    request.current = controller
    // Sem resposta no prazo, o envio é abortado e cai no erro de conexão.
    const timeout = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS)
    setSaving(true)
    setError(null)
    setSaved(false)

    let res: Response | null = null
    try {
      res = await apiFetch(`${config.apiUrl}/predictions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: groupId,
          match_id: matchId,
          predicted_home_score: homeScore,
          predicted_away_score: awayScore,
          predicted_penalty_winner: penWinner,
        }),
        signal: controller.signal,
      })
    } catch {
      // Rede fora ou prazo esgotado. Segue sem resposta.
    } finally {
      clearTimeout(timeout)
    }

    if (request.current !== controller) return
    setSaving(false)

    if (!res) {
      // Sem resposta, o placar fica na tela e o botão volta para outra tentativa.
      setError('Erro de conexão. Tente novamente.')
      return
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Erro ao salvar palpite')
      return
    }

    // Inclui placar e pênalti no mesmo PUT. Invalida só após sucesso para a
    // home refetchar pending_predictions sem N stale do TTL de 30s.
    invalidateApiCache('groups:')
    setSaved(true)
    onSaved(matchId, homeScore, awayScore, penWinner)
    savedTimer.current = setTimeout(() => setSaved(false), 2500)
  }

  return { saving, error, saved, persist }
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
  saving,
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
  saving: boolean
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

  // Sem a escolha na tela, o salvamento manda pênalti nulo. Um vencedor escolhido
  // antes de o empate se desfazer não conta como mudança.
  const status = predictionStatus({ prediction, home, away, penaltyWinner, showPenaltyPicker })
  const penaltyReady = !showPenaltyPicker || penaltyWinner !== null
  const canSave =
    !leg1Pending &&
    !locked &&
    home !== '' &&
    away !== '' &&
    !saving &&
    status !== 'saved' &&
    penaltyReady
  // Palpite salvo que agora pede o vencedor nos pênaltis, por mudança na ida, tem o
  // estado "falta pênalti" e segue com "Atualizar" desabilitado.
  const saveDone = status === 'saved' && !saving
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
  onDraftChange,
  onPenaltyDraftChange,
  draft,
  penaltyDraft,
  now,
}: UseMatchCardProps) {
  const { isPostponed, locked, isFinished, hasPrediction } = useMatchStatus(match, prediction, now)

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
  } = useMatchDraft(prediction, draft, penaltyDraft)

  const { saving, saved, error, persist } = useMatchPersistence(groupId, match.id, onSaved)

  const { selectedOutcome, showPenaltyPicker, canSave, status, saveDone } = matchControls({
    match,
    prediction,
    leg1Prediction,
    leg1Pending,
    home,
    away,
    penaltyWinner,
    pendingOutcome,
    locked,
    saving,
  })

  async function handleSave() {
    if (!canSave) return
    trackEvent('click_matchcard_salvar', { match_id: match.id })
    await persist(Number(home), Number(away), showPenaltyPicker ? penaltyWinner : null)
  }

  async function selectOutcome(outcome: Outcome) {
    if (locked || saving) return
    // A opção já salva não reenvia. Depois de uma falha, tocar nela de novo é a nova tentativa.
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
    if (locked || saving) return
    trackEvent('click_prediction_penalty_winner', {
      match_id: match.id,
      winner,
    })
    setPenaltyWinner(winner)
    setReopenPenalty(false)
    onPenaltyDraftChange?.(match.id, winner)
    // Campo vazio viraria 0 em `Number('')` e gravaria um 0×0 que ninguém escolheu.
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
    error,
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
