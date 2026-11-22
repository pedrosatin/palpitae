import { formatMatchDate } from '../../lib/matchTime'
import { isResultOverdue } from '../../lib/resultOverdue'
import { pickPoints, pointsLabel } from '../../lib/roundSummary'
import TieInfo from './TieInfo'
import CheckIcon from '../CheckIcon'
import InfoHint from '../InfoHint/InfoHint'
import PenaltyBadge, { BallIcon } from '../PenaltyBadge'
import styles from './MatchCard.module.css'
import { PREDICTION_STATUS_LABEL, type PredictionStatus } from './predictionStatus'
import { useMatchCard, type UseMatchCardProps } from './useMatchCard'
import { teamShortName, type Match, type Prediction, OUTCOMES, type Outcome } from './types'

export { OUTCOMES }
export type { Match, Prediction }

interface MatchCardProps extends UseMatchCardProps {
  leg1Match?: Match
  leg2Match?: Match
}

const STATUS_CLASS: Record<PredictionStatus, string> = {
  empty: styles.statusEmpty,
  saved: styles.statusSaved,
  dirty: styles.statusDirty,
  penalty: styles.statusEmpty,
}

function stateLabel(
  locked: boolean,
  isFinished: boolean,
  status: PredictionStatus,
  resultPending: boolean,
) {
  if (resultPending) return 'resultado pendente'
  if (!locked) return PREDICTION_STATUS_LABEL[status]
  if (isFinished) return 'encerrado'
  return 'bloqueado'
}

function saveButtonLabel(saveDone: boolean, hasPrediction: boolean) {
  if (saveDone) {
    return (
      <>
        <CheckIcon />
        Salvo
      </>
    )
  }
  if (hasPrediction) return 'Atualizar'
  return 'Salvar'
}

export default function MatchCard(props: MatchCardProps) {
  const { match, outcomeOnly = false } = props

  const {
    locked,
    isPostponed,
    isFinished,
    hasPrediction,
    saving,
    saved,
    error,
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
  } = useMatchCard(props)

  const resultPending = isResultOverdue(match, props.now ?? Date.now())

  const penaltyInline = (
    <PenaltyPicker
      match={match}
      show={showPenaltyPicker}
      penaltyWinner={penaltyWinner}
      reopenPenalty={reopenPenalty}
      onReopen={() => setReopenPenalty(true)}
      onSelect={selectPenaltyWinner}
    />
  )

  const groupLabel = `${match.home_team_name} contra ${match.away_team_name}, ${stateLabel(locked, isFinished, status, resultPending)}`

  return (
    <div
      role="group"
      aria-label={groupLabel}
      aria-busy={saving}
      className={`${styles.card} ${locked && !isFinished ? styles.lockedCard : ''}`}
    >
      <span className="sr-only" aria-live="polite">
        {saving ? 'Salvando palpite...' : ''}
      </span>
      <div className={styles.meta}>
        <span className={styles.date}>
          {isPostponed ? 'data a definir' : formatMatchDate(match.start_time)}
        </span>
        {isFinished && <span className={styles.badgeFinished}>encerrado</span>}
        {isPostponed && <span className={styles.badgePostponed}>adiado</span>}
        {resultPending && (
          <span className={styles.badgePending} title="Placar ainda não confirmado pelo provedor">
            resultado pendente
          </span>
        )}
        {locked && !isFinished && !isPostponed && !resultPending && (
          <span className={styles.badgeLocked}>bloqueado</span>
        )}
        {!locked && (
          <span className={`${styles.status} ${STATUS_CLASS[status]}`}>
            {status === 'saved' && <CheckIcon />}
            {PREDICTION_STATUS_LABEL[status]}
          </span>
        )}
      </div>

      <MatchScoreRow match={match} isFinished={isFinished} />

      <div className={styles.predictionArea}>
        {match.decides_on_penalties && (
          <InfoHint
            label="fase eliminatória"
            text="O placar considera tempo regulamentar + prorrogação. Na volta, os pênaltis dependem do agregado dos seus dois palpites."
          />
        )}
        <TieInfo
          match={match}
          leg1Match={props.leg1Match}
          leg2Match={props.leg2Match}
          home={home}
          away={away}
          leg1Prediction={props.leg1Prediction}
          locked={locked}
        />
        {locked ? (
          <LockedPredictionView
            hasPrediction={hasPrediction}
            prediction={effectivePrediction}
            match={match}
            outcomeOnly={outcomeOnly}
            selectedOutcome={selectedOutcome}
            isFinished={isFinished}
          />
        ) : outcomeOnly ? (
          <OutcomePickerView
            selectedOutcome={selectedOutcome}
            saved={saved}
            penaltyInline={penaltyInline}
            selectOutcome={selectOutcome}
          />
        ) : (
          <ScoreInputView
            home={home}
            away={away}
            match={match}
            canSave={canSave}
            saveDone={saveDone}
            hasPrediction={hasPrediction}
            penaltyInline={penaltyInline}
            updateHome={updateHome}
            updateAway={updateAway}
            handleScoreInput={handleScoreInput}
            handleSave={handleSave}
          />
        )}
        {!locked && (
          <PickedTeamLine
            label="classificado"
            match={match}
            side={effectivePrediction?.predicted_classified}
          />
        )}
        {props.leg1Pending && (
          <p className={styles.lockedPenalty}>
            Salve o palpite da ida antes da volta ou use Salvar todos.
          </p>
        )}
        {error && (
          <p role="alert" className={styles.errorMsg}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

function PickedTeamLine({
  label,
  match,
  side,
}: {
  label: string
  match: Match
  side: 'home' | 'away' | null | undefined
}) {
  const team = teamShortName(match, side)
  if (team === null) return null
  return (
    <span className={styles.lockedPenalty}>
      {label}: {team}
    </span>
  )
}

function PenaltyPicker({
  match,
  show,
  penaltyWinner,
  reopenPenalty,
  onReopen,
  onSelect,
}: {
  match: Match
  show: boolean
  penaltyWinner: 'home' | 'away' | null
  reopenPenalty: boolean
  onReopen: () => void
  onSelect: (winner: 'home' | 'away') => void
}) {
  if (!show) return null

  const winnerShortName = teamShortName(match, penaltyWinner)
  if (winnerShortName !== null && !reopenPenalty) {
    return (
      <PenaltyBadge
        team={winnerShortName}
        tooltip="Vencedor nos pênaltis. Toque para trocar"
        variant="accent"
        onActivate={onReopen}
        className={styles.penaltyChipSlot}
      />
    )
  } else {
    return (
      <div className={styles.penaltyInline} role="radiogroup" aria-label="Quem vence nos pênaltis?">
        <BallIcon className={styles.penaltyBall} />
        {(['home', 'away'] as const).map((side) => (
          <button
            key={side}
            type="button"
            role="radio"
            className={`${styles.penaltyBtn} ${penaltyWinner === side ? styles.penaltyBtnActive : ''}`}
            onClick={() => onSelect(side)}
            aria-checked={penaltyWinner === side}
          >
            {teamShortName(match, side)}
          </button>
        ))}
      </div>
    )
  }
}

function MatchScoreRow({ match, isFinished }: { match: Match; isFinished: boolean }) {
  return (
    <div className={styles.matchRow}>
      <div className={styles.team}>
        <img
          className={styles.crest}
          src={match.home_team_logo}
          alt={match.home_team_short_name}
          loading="lazy"
        />
        <span className={styles.teamName}>{match.home_team_name}</span>
      </div>

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

  const total = pickPoints(prediction)

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
      <PickedTeamLine label="classificado" match={match} side={prediction.predicted_classified} />
      <PickedTeamLine label="pênalti" match={match} side={prediction.predicted_penalty_winner} />
      {isFinished && (
        <span className={`${styles.points} ${total > 0 ? styles.pointsGreen : styles.pointsZero}`}>
          {pointsLabel(total)}
          {(prediction.classified_points ?? 0) > 0 && (
            <span className={styles.penaltyBonus}>
              {' '}
              (+{prediction.classified_points} classificado)
            </span>
          )}
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
  saved,
  penaltyInline,
  selectOutcome,
}: {
  selectedOutcome: Outcome | null
  saved: boolean
  penaltyInline: React.ReactNode
  selectOutcome: (outcome: Outcome) => void
}) {
  return (
    <div className={styles.outcomeRow}>
      <div className={styles.outcomeButtons} role="radiogroup" aria-label="Resultado">
        {(['home', 'draw', 'away'] as const).map((outcome) => (
          <button
            key={outcome}
            type="button"
            role="radio"
            className={`${styles.outcomeBtn} ${selectedOutcome === outcome ? styles.outcomeBtnActive : ''}`}
            onClick={() => selectOutcome(outcome)}
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

function ScoreStepper({
  side,
  matchId,
  teamName,
  value,
  onUpdate,
  onScoreInput,
}: {
  side: 'home' | 'away'
  matchId: string
  teamName: string
  value: string
  onUpdate: (v: string) => void
  onScoreInput: (value: string, update: (v: string) => void) => void
}) {
  const inputId = `${side}-score-${matchId}`
  const step = (delta: -1 | 1) => {
    const current = value === '' ? 0 : Number(value)
    onUpdate(String(Math.max(0, Math.min(99, current + delta))))
  }

  return (
    <div className={styles.stepper}>
      <button
        className={`${styles.stepBtn} ${styles.stepBtnDec}`}
        onClick={() => step(-1)}
        type="button"
        tabIndex={-1}
        aria-label={`Diminuir placar ${teamName}`}
      >
        −
      </button>
      <input
        className={styles.scoreInput}
        type="number"
        id={inputId}
        name={inputId}
        min={0}
        max={99}
        placeholder="–"
        value={value}
        onChange={(e) => onScoreInput(e.target.value, onUpdate)}
        aria-label={`Placar ${teamName}`}
      />
      <button
        className={`${styles.stepBtn} ${styles.stepBtnInc}`}
        onClick={() => step(1)}
        type="button"
        tabIndex={-1}
        aria-label={`Aumentar placar ${teamName}`}
      >
        +
      </button>
    </div>
  )
}

function ScoreInputView({
  home,
  away,
  match,
  canSave,
  saveDone,
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
  canSave: boolean
  saveDone: boolean
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
        side="home"
        matchId={match.id}
        teamName={match.home_team_name}
        value={home}
        onUpdate={updateHome}
        onScoreInput={handleScoreInput}
      />
      <span className={styles.inputSep}>×</span>
      <ScoreStepper
        side="away"
        matchId={match.id}
        teamName={match.away_team_name}
        value={away}
        onUpdate={updateAway}
        onScoreInput={handleScoreInput}
      />
      {penaltyInline}
      <button
        type="button"
        className={`${styles.saveBtn} ${saveDone ? styles.saveBtnDone : ''}`}
        onClick={handleSave}
        disabled={!canSave && !saveDone}
        aria-disabled={saveDone || undefined}
      >
        {saveButtonLabel(saveDone, hasPrediction)}
      </button>
    </div>
  )
}
