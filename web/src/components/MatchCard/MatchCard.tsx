import InfoHint from '../InfoHint/InfoHint'
import PenaltyBadge, { BallIcon } from '../PenaltyBadge'
import styles from './MatchCard.module.css'
import { useMatchCard } from './useMatchCard'
import { ScoreStepper } from './ScoreStepper'
import { type Match, type Prediction, OUTCOMES, type Outcome } from './types'

// Re-exported for backwards compatibility with consumers importing from './MatchCard'.
export { OUTCOMES }
export type { Match, Prediction, Outcome }

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

export default function MatchCard(props: MatchCardProps) {
  const { match, prediction, outcomeOnly = false } = props

  const {
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
  } = useMatchCard(props)

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

  const penaltyInline = !showPenaltyPicker ? null : penaltyDecided ? (
    <PenaltyBadge
      team={winnerShortName ?? ''}
      tooltip="Vencedor nos pênaltis. Toque para trocar"
      variant="accent"
      onActivate={() => setReopenPenalty(true)}
      disabled={saving}
      className={styles.penaltyChipSlot}
    />
  ) : (
    <div className={styles.penaltyInline} role="radiogroup" aria-label="Quem vence nos pênaltis?">
      <BallIcon className={styles.penaltyBall} />
      <button
        type="button"
        role="radio"
        className={`${styles.penaltyBtn} ${penaltyWinner === 'home' ? styles.penaltyBtnActive : ''}`}
        onClick={() => selectPenaltyWinner('home')}
        disabled={saving}
        aria-checked={penaltyWinner === 'home'}
      >
        {match.home_team_short_name}
      </button>
      <button
        type="button"
        role="radio"
        className={`${styles.penaltyBtn} ${penaltyWinner === 'away' ? styles.penaltyBtnActive : ''}`}
        onClick={() => selectPenaltyWinner('away')}
        disabled={saving}
        aria-checked={penaltyWinner === 'away'}
      >
        {match.away_team_short_name}
      </button>
    </div>
  )

  return (
    <div className={`${styles.card} ${locked && !isFinished ? styles.lockedCard : ''}`}>
      {/* Status badge */}
      <div className={styles.meta}>
        <span className={styles.date}>
          {isPostponed ? 'data a definir' : formatDate(match.start_time)}
        </span>
        {isFinished && <span className={styles.badgeFinished}>encerrado</span>}
        {isPostponed && <span className={styles.badgePostponed}>adiado</span>}
        {locked && !isFinished && !isPostponed && (
          <span className={styles.badgeLocked}>bloqueado</span>
        )}
      </div>

      {/* Teams + scores */}
      <MatchScoreRow match={match} isFinished={isFinished} />

      {/* Prediction area */}
      <div className={styles.predictionArea}>
        {match.decides_on_penalties && (
          <InfoHint
            label="fase eliminatória"
            text="Empate no palpite vale para tempo regulamentar + prorrogação. Em caso de empate, o palpite de pênaltis é obrigatório."
          />
        )}
        {locked ? (
          <LockedPredictionView
            hasPrediction={hasPrediction}
            prediction={prediction}
            match={match}
            outcomeOnly={outcomeOnly}
            selectedOutcome={selectedOutcome}
            isFinished={isFinished}
          />
        ) : outcomeOnly ? (
          <OutcomePickerView
            selectedOutcome={selectedOutcome}
            saving={saving}
            saved={saved}
            penaltyInline={penaltyInline}
            selectOutcome={selectOutcome}
          />
        ) : (
          <ScoreInputView
            home={home}
            away={away}
            match={match}
            locked={locked}
            saving={saving}
            saved={saved}
            canSave={canSave}
            hasPrediction={hasPrediction}
            penaltyInline={penaltyInline}
            updateHome={updateHome}
            updateAway={updateAway}
            handleScoreInput={handleScoreInput}
            handleSave={handleSave}
          />
        )}
        {error && <p className={styles.errorMsg}>{error}</p>}
      </div>
    </div>
  )
}

function MatchScoreRow({ match, isFinished }: { match: Match; isFinished: boolean }) {
  return (
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
  )
}

function LockedPredictionView({
  hasPrediction,
  prediction,
  match,
  outcomeOnly,
  selectedOutcome,
  isFinished,
}: {
  hasPrediction: boolean
  prediction: Prediction | undefined
  match: Match
  outcomeOnly: boolean
  selectedOutcome: Outcome | null
  isFinished: boolean
}) {
  if (!hasPrediction || !prediction) {
    return <p className={styles.noPrediction}>sem palpite registrado</p>
  }

  // Total = base + penalty bonus; both are surfaced as one figure.
  const total = prediction.points_awarded + (prediction.penalty_points ?? 0)

  return (
    <div className={styles.lockedPrediction}>
      <span className={styles.lockedLabel}>seu palpite</span>
      {outcomeOnly && selectedOutcome ? (
        <div className={styles.lockedScores}>
          <span className={styles.lockedScore}>{OUTCOMES[selectedOutcome].label}</span>
        </div>
      ) : (
        <div className={styles.lockedScores}>
          <span className={styles.lockedScore}>{prediction.predicted_home_score}</span>
          <span className={styles.lockedSep}>×</span>
          <span className={styles.lockedScore}>{prediction.predicted_away_score}</span>
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
        <span className={`${styles.points} ${total > 0 ? styles.pointsGreen : styles.pointsZero}`}>
          {total} {total === 1 ? 'ponto' : 'pontos'}
          {(prediction.penalty_points ?? 0) > 0 && (
            <span className={styles.penaltyBonus}> (+{prediction.penalty_points} pênalti)</span>
          )}
        </span>
      )}
    </div>
  )
}

function OutcomePickerView({
  selectedOutcome,
  saving,
  saved,
  penaltyInline,
  selectOutcome,
}: {
  selectedOutcome: Outcome | null
  saving: boolean
  saved: boolean
  penaltyInline: React.ReactNode
  selectOutcome: (outcome: Outcome) => void
}) {
  return (
    <div className={styles.outcomeRow}>
      {/* display:contents wrapper — keeps the three buttons as flex
          children of .outcomeRow while giving them their own radiogroup,
          so the penalty radiogroup below is a sibling, never nested. */}
      <div className={styles.outcomeButtons} role="radiogroup" aria-label="Resultado">
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

function ScoreInputView({
  home,
  away,
  match,
  locked,
  saving,
  saved,
  canSave,
  hasPrediction,
  penaltyInline,
  updateHome,
  updateAway,
  handleScoreInput,
  handleSave,
}: {
  home: string
  away: string
  match: Match
  locked: boolean
  saving: boolean
  saved: boolean
  canSave: boolean
  hasPrediction: boolean
  penaltyInline: React.ReactNode
  updateHome: (v: string) => void
  updateAway: (v: string) => void
  handleScoreInput: (value: string, update: (v: string) => void) => void
  handleSave: () => void
}) {
  return (
    <div className={styles.inputRow}>
      <ScoreStepper
        teamName={match.home_team_name}
        score={home}
        locked={locked}
        matchId={match.id}
        prefix="home"
        updateScore={updateHome}
        handleScoreInput={handleScoreInput}
      />
      <span className={styles.inputSep}>×</span>
      <ScoreStepper
        teamName={match.away_team_name}
        score={away}
        locked={locked}
        matchId={match.id}
        prefix="away"
        updateScore={updateAway}
        handleScoreInput={handleScoreInput}
      />
      {penaltyInline}
      <button
        className={`${styles.saveBtn} ${saved ? styles.saveBtnSaved : ''}`}
        onClick={handleSave}
        disabled={!canSave}
      >
        {saving ? '...' : saved ? 'Salvo!' : hasPrediction ? 'Atualizar' : 'Salvar'}
      </button>
    </div>
  )
}
