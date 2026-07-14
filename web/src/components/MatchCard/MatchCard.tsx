import { useEffect, useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import InfoHint from '../InfoHint/InfoHint'
import PenaltyBadge, { BallIcon } from '../PenaltyBadge'
import styles from './MatchCard.module.css'

export interface Match {
  id: string
  start_time: string
  status: 'scheduled' | 'finished'
  home_score: number | null
  away_score: number | null
  phase: string
  round: string
  /** Server-derived display label for the round (e.g. "Rodada 1", "Oitavas de final"). */
  round_label: string
  group_name: string | null
  home_team_id: string
  home_team_name: string
  home_team_short_name: string
  home_team_logo: string
  away_team_id: string
  away_team_name: string
  away_team_short_name: string
  away_team_logo: string
  /** Server-derived: this match decides on penalties in a single game. */
  decides_on_penalties?: boolean
  /** Actual shootout result (only set once a finished match went to penalties). */
  penalty_winner?: 'home' | 'away' | null
  home_penalty_goals?: number | null
  away_penalty_goals?: number | null
}

export interface Prediction {
  id: string
  match_id: string
  predicted_home_score: number
  predicted_away_score: number
  predicted_penalty_winner?: 'home' | 'away' | null
  points_awarded: number
  penalty_points?: number
  locked: boolean | 1 | 0
  updated_at: string
}

interface MatchCardProps {
  match: Match
  prediction: Prediction | undefined
  groupId: string
  /**
   * When true the group scores only the winner/draw (points_exact = 0), so the
   * card shows 3 outcome buttons (Casa / Empate / Fora) instead of score inputs.
   * The picks are still stored as scores: casa=(1,0), empate=(0,0), fora=(0,1).
   */
  outcomeOnly?: boolean
  onSaved: (
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) => void
  /** Reports the current input draft up so a parent can offer "Salvar todos". */
  onDraftChange?: (matchId: string, home: string, away: string) => void
  /** Reports the current penalty-winner draft so "Salvar todos" can include it. */
  onPenaltyDraftChange?: (matchId: string, winner: 'home' | 'away' | null) => void
}


function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

function ScoreStepper({
  teamName,
  score,
  onChange,
  disabled,
  id,
}: {
  teamName: string
  score: string
  onChange: (v: string) => void
  disabled: boolean
  id: string
}) {
  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    if (v === '' || /^\d{1,2}$/.test(v)) onChange(v)
  }
  function handleDec() {
    onChange(String(Math.max(0, (score === '' ? 0 : Number(score)) - 1)))
  }
  function handleInc() {
    onChange(String(Math.min(99, (score === '' ? 0 : Number(score)) + 1)))
  }

  return (
    <div className={styles.stepper}>
      <button
        className={`${styles.stepBtn} ${styles.stepBtnDec}`}
        onClick={handleDec}
        disabled={disabled}
        type="button"
        tabIndex={-1}
        aria-label={`Diminuir placar ${teamName}`}
      >
        −
      </button>
      <input
        className={styles.scoreInput}
        type="number"
        id={id}
        name={id}
        min={0}
        max={99}
        placeholder="0"
        value={score}
        onChange={handleInput}
        aria-label={`Placar ${teamName}`}
      />
      <button
        className={`${styles.stepBtn} ${styles.stepBtnInc}`}
        onClick={handleInc}
        disabled={disabled}
        type="button"
        tabIndex={-1}
        aria-label={`Aumentar placar ${teamName}`}
      >
        +
      </button>
    </div>
  )
}

function PenaltyInline({
  showPenaltyPicker,
  penaltyDecided,
  winnerShortName,
  saving,
  penaltyWinner,
  onActivate,
  onSelectWinner,
  homeShortName,
  awayShortName,
}: {
  showPenaltyPicker: boolean
  penaltyDecided: boolean
  winnerShortName: string | null
  saving: boolean
  penaltyWinner: 'home' | 'away' | null
  onActivate: () => void
  onSelectWinner: (winner: 'home' | 'away') => void
  homeShortName: string
  awayShortName: string
}) {
  if (!showPenaltyPicker) return null
  if (penaltyDecided) {
    return (
      <PenaltyBadge
        team={winnerShortName ?? ''}
        tooltip="Vencedor nos pênaltis. Toque para trocar"
        variant="accent"
        onActivate={onActivate}
        disabled={saving}
        className={styles.penaltyChipSlot}
      />
    )
  }
  return (
    <div
      className={styles.penaltyInline}
      role="radiogroup"
      aria-label="Quem vence nos pênaltis?"
    >
      <BallIcon className={styles.penaltyBall} />
      <button
        type="button"
        role="radio"
        className={`${styles.penaltyBtn} ${penaltyWinner === 'home' ? styles.penaltyBtnActive : ''}`}
        onClick={() => onSelectWinner('home')}
        disabled={saving}
        aria-checked={penaltyWinner === 'home'}
      >
        {homeShortName}
      </button>
      <button
        type="button"
        role="radio"
        className={`${styles.penaltyBtn} ${penaltyWinner === 'away' ? styles.penaltyBtnActive : ''}`}
        onClick={() => onSelectWinner('away')}
        disabled={saving}
        aria-checked={penaltyWinner === 'away'}
      >
        {awayShortName}
      </button>
    </div>
  )
}

const OUTCOMES = {
  home: { home: 1, away: 0, label: 'Casa' },
  draw: { home: 0, away: 0, label: 'Empate' },
  away: { home: 0, away: 1, label: 'Fora' },
} as const
type Outcome = keyof typeof OUTCOMES

function LockedPrediction({
  prediction,
  outcomeOnly,
  selectedOutcome,
  isFinished,
  match,
}: {
  prediction: Prediction
  outcomeOnly: boolean
  selectedOutcome: Outcome | null
  isFinished: boolean
  match: Match
}) {
  const total = prediction.points_awarded + (prediction.penalty_points ?? 0)
  return (
    <div className={styles.lockedPrediction}>
      <span className={styles.lockedLabel}>seu palpite</span>
      {outcomeOnly && selectedOutcome ? (
        <div className={styles.lockedScores}>
          <span className={styles.lockedScore}>
            {OUTCOMES[selectedOutcome].label}
          </span>
        </div>
      ) : (
        <div className={styles.lockedScores}>
          <span className={styles.lockedScore}>
            {prediction.predicted_home_score}
          </span>
          <span className={styles.lockedSep}>×</span>
          <span className={styles.lockedScore}>
            {prediction.predicted_away_score}
          </span>
        </div>
      )}
      {prediction.predicted_penalty_winner && (
        <span className={styles.lockedPenalty}>
          pênalti:{' '}
          {prediction.predicted_penalty_winner === 'home'
            ? match.home_team_short_name
            : match.away_team_short_name}
        </span>
      )}
      {isFinished && (
        <span
          className={`${styles.points} ${total > 0 ? styles.pointsGreen : styles.pointsZero}`}
        >
          {total} {total === 1 ? 'ponto' : 'pontos'}
          {(prediction.penalty_points ?? 0) > 0 && (
            <span className={styles.penaltyBonus}>
              {' '}
              (+{prediction.penalty_points} pênalti)
            </span>
          )}
        </span>
      )}
    </div>
  )
}

function ActivePrediction({
  outcomeOnly,
  selectedOutcome,
  selectOutcome,
  saving,
  saved,
  penaltyInline,
  home,
  away,
  updateHome,
  updateAway,
  locked,
  handleSave,
  canSave,
  hasPrediction,
  matchId,
  homeTeamName,
  awayTeamName,
}: {
  outcomeOnly: boolean
  selectedOutcome: Outcome | null
  selectOutcome: (outcome: Outcome) => void
  saving: boolean
  saved: boolean
  penaltyInline: React.ReactNode
  home: string
  away: string
  updateHome: (v: string) => void
  updateAway: (v: string) => void
  locked: boolean
  handleSave: () => void
  canSave: boolean
  hasPrediction: boolean
  matchId: string
  homeTeamName: string
  awayTeamName: string
}) {
  if (outcomeOnly) {
    return (
      <div className={styles.outcomeRow}>
        <div
          className={styles.outcomeButtons}
          role="radiogroup"
          aria-label="Resultado"
        >
          {(['home', 'draw', 'away'] as const).map((outcome) => (
            <button
              key={outcome}
              type="button"
              role="radio"
              className={`${styles.outcomeBtn} ${selectedOutcome === outcome ? styles.outcomeBtnActive : ''}`}
              onClick={() => selectOutcome(outcome)}
              disabled={saving}
              aria-checked={selectedOutcome === outcome}
            >
              {OUTCOMES[outcome].label}
            </button>
          ))}
        </div>
        {penaltyInline}
        {saved && <span className={styles.outcomeSaved}>Salvo!</span>}
      </div>
    )
  }

  return (
    <div className={styles.inputRow}>
      <ScoreStepper
        id={`home-score-${matchId}`}
        teamName={homeTeamName}
        score={home}
        onChange={updateHome}
        disabled={locked}
      />
      <span className={styles.inputSep}>×</span>
      <ScoreStepper
        id={`away-score-${matchId}`}
        teamName={awayTeamName}
        score={away}
        onChange={updateAway}
        disabled={locked}
      />
      {penaltyInline}
      <button
        className={`${styles.saveBtn} ${saved ? styles.saveBtnSaved : ''}`}
        onClick={handleSave}
        disabled={!canSave}
      >
        {saving
          ? '...'
          : saved
            ? 'Salvo!'
            : hasPrediction
              ? 'Atualizar'
              : 'Salvar'}
      </button>
    </div>
  )
}



async function persistPrediction(
  groupId: string,
  matchId: string,
  homeScore: number,
  awayScore: number,
  penWinner: 'home' | 'away' | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
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

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: data.error ?? 'Erro ao salvar palpite' }
    }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: 'Erro de rede' }
  }
}

function computeSelectedOutcome(
  hasPrediction: boolean,
  prediction: Prediction | undefined,
  pendingOutcome: 'home' | 'draw' | 'away' | null
): Outcome | null {
  if (!hasPrediction || !prediction) return pendingOutcome
  if (prediction.predicted_home_score > prediction.predicted_away_score) return 'home'
  if (prediction.predicted_home_score < prediction.predicted_away_score) return 'away'
  return 'draw'
}

function useMatchCardState(
  match: Match,
  prediction: Prediction | undefined,
  groupId: string,
  outcomeOnly: boolean,
  onSaved: MatchCardProps['onSaved'],
  onDraftChange?: MatchCardProps['onDraftChange'],
  onPenaltyDraftChange?: MatchCardProps['onPenaltyDraftChange'],
) {
  const locked =
    Boolean(prediction?.locked) || new Date() >= new Date(match.start_time)

  const [home, setHome] = useState<string>(
    prediction !== undefined ? String(prediction.predicted_home_score) : '0',
  )
  const [away, setAway] = useState<string>(
    prediction !== undefined ? String(prediction.predicted_away_score) : '0',
  )
  const [penaltyWinner, setPenaltyWinner] = useState<'home' | 'away' | null>(
    prediction?.predicted_penalty_winner ?? null,
  )

  useEffect(() => {
    if (prediction !== undefined) {
      setHome(String(prediction.predicted_home_score))
      setAway(String(prediction.predicted_away_score))
      setPenaltyWinner(prediction.predicted_penalty_winner ?? null)
    }
  }, [prediction])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pendingOutcome, setPendingOutcome] = useState<'home' | 'draw' | 'away' | null>(null)
  // Once a penalty winner is picked the two team buttons collapse to a compact
  // chip; clicking it re-opens the choice. Keeps the control row short enough to
  // stay on one line beside the score and the save button.
  const [reopenPenalty, setReopenPenalty] = useState(false)
  const isFinished = match.status === 'finished'
  const hasPrediction = prediction !== undefined

  const selectedOutcome = computeSelectedOutcome(hasPrediction, prediction, pendingOutcome)

  // The penalty winner pick is required for a DRAW prediction in a match that
  // decides on penalties. Shown whenever the current score is a draw.
  const drawMarked = outcomeOnly
    ? selectedOutcome === 'draw'
    : home !== '' && away !== '' && Number(home) === Number(away)
  const showPenaltyPicker = !locked && Boolean(match.decides_on_penalties) && drawMarked

  const scoreChanged = hasPrediction
    ? Number(home) !== prediction.predicted_home_score ||
      Number(away) !== prediction.predicted_away_score
    : true
  const penaltyChanged =
    (penaltyWinner ?? null) !== (prediction?.predicted_penalty_winner ?? null)
  const hasChanged = scoreChanged || penaltyChanged
  // A draw in a shootout match can't be saved until its winner is picked.
  const penaltyReady = !showPenaltyPicker || penaltyWinner !== null
  const canSave =
    !locked && home !== '' && away !== '' && !saving && hasChanged && penaltyReady

  async function persist(
    homeScore: number,
    awayScore: number,
    penWinner: 'home' | 'away' | null,
  ) {
    setSaving(true)
    setError(null)
    setSaved(false)

    const res = await persistPrediction(
      groupId,
      match.id,
      homeScore,
      awayScore,
      penWinner,
    )

    setSaving(false)

    if (!res.ok) {
      setError(res.error ?? 'Erro ao salvar palpite')
      return
    }

    setSaved(true)
    onSaved(match.id, homeScore, awayScore, penWinner)
    setTimeout(() => setSaved(false), 2500)
  }

  async function handleSave() {
    if (!canSave) return
    trackEvent('click_matchcard_salvar', { match_id: match.id })
    // A non-draw / non-eligible pick never carries a penalty winner.
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
      // Need a penalty winner first — show the picker and wait for the choice;
      // selectPenaltyWinner persists once the user picks. Keep any prior winner.
      return
    }
    // Decisive outcome (or a draw with no penalties) carries no winner.
    if (penaltyWinner !== null) {
      setPenaltyWinner(null)
      onPenaltyDraftChange?.(match.id, null)
    }
    await persist(h, a, null)
  }

  async function selectPenaltyWinner(winner: 'home' | 'away') {
    if (locked || saving) return
    trackEvent('click_prediction_penalty_winner', { match_id: match.id, winner })
    setPenaltyWinner(winner)
    setReopenPenalty(false)
    onPenaltyDraftChange?.(match.id, winner)
    // Outcome mode persists immediately (mirrors selectOutcome); score mode waits
    // for the explicit Save button so the user can still tweak the score.
    if (outcomeOnly) {
      await persist(0, 0, winner)
    }
  }

  function clearPenaltyIfLeavingDraw(nextHome: string, nextAway: string) {
    const stillDraw =
      nextHome !== '' && nextAway !== '' && Number(nextHome) === Number(nextAway)
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


  // Penalty winner pick — folded inline into the active control row, right
  // aligned beside the save button, so a draw-marked card stays the same height
  // as a locked/finished one. Once a winner is chosen the two team buttons
  // collapse to a ball chip; clicking it re-opens the choice.
  const winnerShortName =
    penaltyWinner === 'home'
      ? match.home_team_short_name
      : penaltyWinner === 'away'
        ? match.away_team_short_name
        : null
  const penaltyDecided = penaltyWinner !== null && !reopenPenalty

  return {
    locked,
    isFinished,
    hasPrediction,
    saving,
    error,
    saved,
    home,
    away,
    penaltyWinner,
    selectedOutcome,
    showPenaltyPicker,
    canSave,
    winnerShortName,
    penaltyDecided,
    handleSave,
    selectOutcome,
    selectPenaltyWinner,
    updateHome,
    updateAway,
    setReopenPenalty,
  }
}

export default function MatchCard({
  match,
  prediction,
  groupId,
  outcomeOnly = false,
  onSaved,
  onDraftChange,
  onPenaltyDraftChange,
}: MatchCardProps) {
  const {
    locked,
    isFinished,
    hasPrediction,
    saving,
    error,
    saved,
    home,
    away,
    penaltyWinner,
    selectedOutcome,
    showPenaltyPicker,
    canSave,
    winnerShortName,
    penaltyDecided,
    handleSave,
    selectOutcome,
    selectPenaltyWinner,
    updateHome,
    updateAway,
    setReopenPenalty,
  } = useMatchCardState(
    match,
    prediction,
    groupId,
    outcomeOnly,
    onSaved,
    onDraftChange,
    onPenaltyDraftChange,
  )

  const penaltyInline = (
    <PenaltyInline
      showPenaltyPicker={showPenaltyPicker}
      penaltyDecided={penaltyDecided}
      winnerShortName={winnerShortName}
      saving={saving}
      penaltyWinner={penaltyWinner}
      onActivate={() => setReopenPenalty(true)}
      onSelectWinner={selectPenaltyWinner}
      homeShortName={match.home_team_short_name}
      awayShortName={match.away_team_short_name}
    />
  )

  return (
    <div
      className={`${styles.card} ${locked && !isFinished ? styles.lockedCard : ''}`}
    >
      {/* Status badge */}
      <div className={styles.meta}>
        <span className={styles.date}>{formatDate(match.start_time)}</span>
        {isFinished && <span className={styles.badgeFinished}>encerrado</span>}
        {locked && !isFinished && (
          <span className={styles.badgeLocked}>bloqueado</span>
        )}
      </div>

      {/* Teams + scores */}
      <div className={styles.matchRow}>
        {/* Home team */}
        <div className={styles.team}>
          <img
            className={styles.crest}
            src={match.home_team_logo}
            alt={match.home_team_short_name}
            loading="lazy"
          />
          <span className={styles.teamName}>{match.home_team_name}</span>
        </div>

        {/* Score area */}
        <div className={styles.scoreArea}>
          {isFinished ? (
            <>
              <div className={styles.finalScore}>
                <span>{match.home_score ?? '–'}</span>
                <span className={styles.scoreSep}>×</span>
                <span>{match.away_score ?? '–'}</span>
              </div>
              {match.penalty_winner && (
                <span className={styles.penaltyResult}>
                  ({match.home_penalty_goals}-{match.away_penalty_goals} pênaltis)
                </span>
              )}
            </>
          ) : (
            <span className={styles.vs}>vs</span>
          )}
        </div>

        {/* Away team */}
        <div className={`${styles.team} ${styles.teamAway}`}>
          <span className={styles.teamName}>{match.away_team_name}</span>
          <img
            className={styles.crest}
            src={match.away_team_logo}
            alt={match.away_team_short_name}
            loading="lazy"
          />
        </div>
      </div>

      {/* Prediction area */}
      <div className={styles.predictionArea}>
        {match.decides_on_penalties && (
          <InfoHint
            label="fase eliminatória"
            text="Empate no palpite vale para tempo regulamentar + prorrogação. Em caso de empate, o palpite de pênaltis é obrigatório."
          />
        )}
        {locked ? (
          prediction !== undefined ? (
            <LockedPrediction
              prediction={prediction}
              outcomeOnly={outcomeOnly}
              selectedOutcome={selectedOutcome}
              isFinished={isFinished}
              match={match}
            />
          ) : (
            <p className={styles.noPrediction}>sem palpite registrado</p>
          )
        ) : (
          <ActivePrediction
            outcomeOnly={outcomeOnly}
            selectedOutcome={selectedOutcome}
            selectOutcome={selectOutcome}
            saving={saving}
            saved={saved}
            penaltyInline={penaltyInline}
            home={home}
            away={away}
            updateHome={updateHome}
            updateAway={updateAway}
            locked={locked}
            handleSave={handleSave}
            canSave={canSave}
            hasPrediction={hasPrediction}
            matchId={match.id}
            homeTeamName={match.home_team_name}
            awayTeamName={match.away_team_name}
          />
        )}
        {error && <p className={styles.errorMsg}>{error}</p>}
      </div>
    </div>
  )
}
