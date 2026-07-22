import InfoHint from "../InfoHint/InfoHint";
import PenaltyBadge, { BallIcon } from "../PenaltyBadge";
import styles from "./MatchCard.module.css";
import { useMatchCard } from "./useMatchCard";

export interface Match {
  id: string;
  start_time: string;
  status: "scheduled" | "finished";
  home_score: number | null;
  away_score: number | null;
  phase: string;
  round: string;
  /** Server-derived display label for the round (e.g. "Rodada 1", "Oitavas de final"). */
  round_label: string;
  group_name: string | null;
  home_team_id: string;
  home_team_name: string;
  home_team_short_name: string;
  home_team_logo: string;
  away_team_id: string;
  away_team_name: string;
  away_team_short_name: string;
  away_team_logo: string;
  /** Server-derived: this match decides on penalties in a single game. */
  decides_on_penalties?: boolean;
  /** Actual shootout result (only set once a finished match went to penalties). */
  penalty_winner?: "home" | "away" | null;
  home_penalty_goals?: number | null;
  away_penalty_goals?: number | null;
}

export interface Prediction {
  id: string;
  match_id: string;
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_penalty_winner?: "home" | "away" | null;
  points_awarded: number;
  penalty_points?: number;
  locked: boolean | 1 | 0;
  updated_at: string;
}

interface MatchCardProps {
  match: Match;
  prediction: Prediction | undefined;
  groupId: string;
  /**
   * When true the group scores only the winner/draw (points_exact = 0), so the
   * card shows 3 outcome buttons (Casa / Empate / Fora) instead of score inputs.
   * The picks are still stored as scores: casa=(1,0), empate=(0,0), fora=(0,1).
   */
  outcomeOnly?: boolean;
  onSaved: (
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: "home" | "away" | null,
  ) => void;
  /** Reports the current input draft up so a parent can offer "Salvar todos". */
  onDraftChange?: (matchId: string, home: string, away: string) => void;
  /** Reports the current penalty-winner draft so "Salvar todos" can include it. */
  onPenaltyDraftChange?: (
    matchId: string,
    winner: "home" | "away" | null,
  ) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

// Outcome-only groups store the pick as a score: casa=(1,0), empate=(0,0), fora=(0,1).
export const OUTCOMES = {
  home: { home: 1, away: 0, label: "Casa" },
  draw: { home: 0, away: 0, label: "Empate" },
  away: { home: 0, away: 1, label: "Fora" },
} as const;
export type Outcome = keyof typeof OUTCOMES;

export default function MatchCard(props: MatchCardProps) {
  const { match, prediction, outcomeOnly = false } = props;

  const {
    locked,
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
  } = useMatchCard(props);

  // Penalty winner pick — folded inline into the active control row, right
  // aligned beside the save button, so a draw-marked card stays the same height
  // as a locked/finished one. Once a winner is chosen the two team buttons
  // collapse to a ball chip; clicking it re-opens the choice.
  const winnerShortName =
    penaltyWinner === "home"
      ? match.home_team_short_name
      : penaltyWinner === "away"
        ? match.away_team_short_name
        : null;
  const penaltyDecided = penaltyWinner !== null && !reopenPenalty;

  const penaltyInline = !showPenaltyPicker ? null : penaltyDecided ? (
    <PenaltyBadge
      team={winnerShortName ?? ""}
      tooltip="Vencedor nos pênaltis. Toque para trocar"
      variant="accent"
      onActivate={() => setReopenPenalty(true)}
      disabled={saving}
      className={styles.penaltyChipSlot}
    />
  ) : (
    <div
      className={styles.penaltyInline}
      role="radiogroup"
      aria-label="Quem vence nos pênaltis?"
    >
      <BallIcon className={styles.penaltyBall} />
      <button
        type="button"
        role="radio"
        className={`${styles.penaltyBtn} ${penaltyWinner === "home" ? styles.penaltyBtnActive : ""}`}
        onClick={() => selectPenaltyWinner("home")}
        disabled={saving}
        aria-checked={penaltyWinner === "home"}
      >
        {match.home_team_short_name}
      </button>
      <button
        type="button"
        role="radio"
        className={`${styles.penaltyBtn} ${penaltyWinner === "away" ? styles.penaltyBtnActive : ""}`}
        onClick={() => selectPenaltyWinner("away")}
        disabled={saving}
        aria-checked={penaltyWinner === "away"}
      >
        {match.away_team_short_name}
      </button>
    </div>
  );

  return (
    <div
      className={`${styles.card} ${locked && !isFinished ? styles.lockedCard : ""}`}
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
  );
}

function MatchScoreRow({
  match,
  isFinished,
}: {
  match: Match;
  isFinished: boolean;
}) {
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
              <span>{match.home_score ?? "–"}</span>
              <span className={styles.scoreSep}>×</span>
              <span>{match.away_score ?? "–"}</span>
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
  );
}

function LockedPredictionView({
  hasPrediction,
  prediction,
  match,
  outcomeOnly,
  selectedOutcome,
  isFinished,
}: {
  hasPrediction: boolean;
  prediction: Prediction | undefined;
  match: Match;
  outcomeOnly: boolean;
  selectedOutcome: Outcome | null;
  isFinished: boolean;
}) {
  if (!hasPrediction || !prediction) {
    return <p className={styles.noPrediction}>sem palpite registrado</p>;
  }

  // Total = base + penalty bonus; both are surfaced as one figure.
  const total = prediction.points_awarded + (prediction.penalty_points ?? 0);

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
          pênalti:{" "}
          {prediction.predicted_penalty_winner === "home"
            ? match.home_team_short_name
            : match.away_team_short_name}
        </span>
      )}
      {isFinished && (
        <span
          className={`${styles.points} ${total > 0 ? styles.pointsGreen : styles.pointsZero}`}
        >
          {total} {total === 1 ? "ponto" : "pontos"}
          {(prediction.penalty_points ?? 0) > 0 && (
            <span className={styles.penaltyBonus}>
              {" "}
              (+{prediction.penalty_points} pênalti)
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function OutcomePickerView({
  selectedOutcome,
  saving,
  saved,
  penaltyInline,
  selectOutcome,
}: {
  selectedOutcome: Outcome | null;
  saving: boolean;
  saved: boolean;
  penaltyInline: React.ReactNode;
  selectOutcome: (outcome: Outcome) => void;
}) {
  return (
    <div className={styles.outcomeRow}>
      {/* display:contents wrapper — keeps the three buttons as flex
          children of .outcomeRow while giving them their own radiogroup,
          so the penalty radiogroup below is a sibling, never nested. */}
      <div
        className={styles.outcomeButtons}
        role="radiogroup"
        aria-label="Resultado"
      >
        {(["home", "draw", "away"] as const).map((outcome) => (
          <button
            key={outcome}
            type="button"
            role="radio"
            className={`${styles.outcomeBtn} ${selectedOutcome === outcome ? styles.outcomeBtnActive : ""}`}
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
  );
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
  home: string;
  away: string;
  match: Match;
  locked: boolean;
  saving: boolean;
  saved: boolean;
  canSave: boolean;
  hasPrediction: boolean;
  penaltyInline: React.ReactNode;
  updateHome: (v: string) => void;
  updateAway: (v: string) => void;
  handleScoreInput: (value: string, update: (v: string) => void) => void;
  handleSave: () => void;
}) {
  return (
    <div className={styles.inputRow}>
      <div className={styles.stepper}>
        <button
          className={`${styles.stepBtn} ${styles.stepBtnDec}`}
          onClick={() =>
            updateHome(
              String(Math.max(0, (home === "" ? 0 : Number(home)) - 1)),
            )
          }
          disabled={locked}
          type="button"
          tabIndex={-1}
          aria-label={`Diminuir placar ${match.home_team_name}`}
        >
          −
        </button>
        <input
          className={styles.scoreInput}
          type="number"
          id={`home-score-${match.id}`}
          name={`home-score-${match.id}`}
          min={0}
          max={99}
          placeholder="0"
          value={home}
          onChange={(e) => handleScoreInput(e.target.value, updateHome)}
          aria-label={`Placar ${match.home_team_name}`}
        />
        <button
          className={`${styles.stepBtn} ${styles.stepBtnInc}`}
          onClick={() =>
            updateHome(
              String(Math.min(99, (home === "" ? 0 : Number(home)) + 1)),
            )
          }
          disabled={locked}
          type="button"
          tabIndex={-1}
          aria-label={`Aumentar placar ${match.home_team_name}`}
        >
          +
        </button>
      </div>
      <span className={styles.inputSep}>×</span>
      <div className={styles.stepper}>
        <button
          className={`${styles.stepBtn} ${styles.stepBtnDec}`}
          onClick={() =>
            updateAway(
              String(Math.max(0, (away === "" ? 0 : Number(away)) - 1)),
            )
          }
          disabled={locked}
          type="button"
          tabIndex={-1}
          aria-label={`Diminuir placar ${match.away_team_name}`}
        >
          −
        </button>
        <input
          className={styles.scoreInput}
          type="number"
          id={`away-score-${match.id}`}
          name={`away-score-${match.id}`}
          min={0}
          max={99}
          placeholder="0"
          value={away}
          onChange={(e) => handleScoreInput(e.target.value, updateAway)}
          aria-label={`Placar ${match.away_team_name}`}
        />
        <button
          className={`${styles.stepBtn} ${styles.stepBtnInc}`}
          onClick={() =>
            updateAway(
              String(Math.min(99, (away === "" ? 0 : Number(away)) + 1)),
            )
          }
          disabled={locked}
          type="button"
          tabIndex={-1}
          aria-label={`Aumentar placar ${match.away_team_name}`}
        >
          +
        </button>
      </div>
      {penaltyInline}
      <button
        className={`${styles.saveBtn} ${saved ? styles.saveBtnSaved : ""}`}
        onClick={handleSave}
        disabled={!canSave}
      >
        {saving
          ? "..."
          : saved
            ? "Salvo!"
            : hasPrediction
              ? "Atualizar"
              : "Salvar"}
      </button>
    </div>
  );
}
