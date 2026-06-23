import { useEffect, useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { isKnockoutPhase } from '../../lib/phases'
import styles from './MatchCard.module.css'

export interface Match {
  id: string
  start_time: string
  status: 'scheduled' | 'live' | 'finished'
  home_score: number | null
  away_score: number | null
  phase: string | null
  round: string
  group_name: string | null
  home_team_id: string
  home_team_name: string
  home_team_short_name: string
  home_team_logo: string
  away_team_id: string
  away_team_name: string
  away_team_short_name: string
  away_team_logo: string
  penalty_winner_team_id?: string | null
  penalty_home_score?: number | null
  penalty_away_score?: number | null
}

export interface Prediction {
  id: string
  match_id: string
  predicted_home_score: number
  predicted_away_score: number
  predicted_penalty_winner_team_id?: string | null
  points_awarded: number
  penalty_bonus?: number
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
  /**
   * Whether the group uses penalty-winner picks. When true, a knockout match
   * predicted as a draw asks the user which team wins the shootout (+1 bonus).
   * Always false in outcomeOnly groups (penalty picks need points_exact > 0).
   */
  penaltyPicksEnabled?: boolean
  onSaved: (
    matchId: string,
    home: number,
    away: number,
    penaltyWinnerTeamId: string | null,
  ) => void
  /** Reports the current input draft up so a parent can offer "Salvar todos". */
  onDraftChange?: (
    matchId: string,
    home: string,
    away: string,
    penaltyWinnerTeamId: string | null,
  ) => void
}

function pointsLabel(pts: number, bonus: number): string {
  const total = pts + bonus
  if (bonus > 0) return `${pts} + ${bonus} pts`
  return `${total} ${total === 1 ? 'ponto' : 'pontos'}`
}

/** Short name of whichever team a penalty-winner id refers to in this match. */
export function penaltyWinnerShortName(
  match: Pick<Match, 'home_team_id' | 'home_team_short_name' | 'away_team_id' | 'away_team_short_name'>,
  winnerTeamId: string,
): string {
  if (winnerTeamId === match.home_team_id) return match.home_team_short_name
  if (winnerTeamId === match.away_team_id) return match.away_team_short_name
  return '?'
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

export default function MatchCard({
  match,
  prediction,
  groupId,
  outcomeOnly = false,
  penaltyPicksEnabled = false,
  onSaved,
  onDraftChange,
}: MatchCardProps) {
  const locked =
    Boolean(prediction?.locked) || new Date() >= new Date(match.start_time)

  const [home, setHome] = useState<string>(
    prediction !== undefined ? String(prediction.predicted_home_score) : '0',
  )
  const [away, setAway] = useState<string>(
    prediction !== undefined ? String(prediction.predicted_away_score) : '0',
  )
  const [penaltyWinner, setPenaltyWinner] = useState<string | null>(
    prediction?.predicted_penalty_winner_team_id ?? null,
  )
  const [homeTouched, setHomeTouched] = useState(false)
  const [awayTouched, setAwayTouched] = useState(false)

  useEffect(() => {
    if (prediction !== undefined) {
      setHome(String(prediction.predicted_home_score))
      setAway(String(prediction.predicted_away_score))
      setPenaltyWinner(prediction.predicted_penalty_winner_team_id ?? null)
    }
  }, [prediction])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pendingOutcome, setPendingOutcome] = useState<'home' | 'draw' | 'away' | null>(null)

  const isFinished = match.status === 'finished'
  const isLive = match.status === 'live'
  const hasPrediction = prediction !== undefined

  // The penalty-winner picker shows for a knockout match predicted as a draw, in
  // a group that uses penalty picks (never in the 1X2 outcomeOnly mode).
  const isDraw = home !== '' && away !== '' && Number(home) === Number(away)
  const showPenaltyPicker =
    !outcomeOnly && penaltyPicksEnabled && isKnockoutPhase(match.phase) && isDraw
  // What we actually persist: the pick only when the picker applies, else null.
  const penaltyToSend = showPenaltyPicker ? penaltyWinner : null

  const hasChanged = hasPrediction
    ? Number(home) !== prediction.predicted_home_score ||
      Number(away) !== prediction.predicted_away_score ||
      (penaltyToSend ?? null) !== (prediction.predicted_penalty_winner_team_id ?? null)
    : homeTouched || awayTouched || penaltyToSend !== null
  // A visible picker is mandatory before saving.
  const penaltyReady = !showPenaltyPicker || penaltyWinner !== null
  const canSave =
    !locked && home !== '' && away !== '' && !saving && hasChanged && penaltyReady

  async function persist(
    homeScore: number,
    awayScore: number,
    penaltyWinnerTeamId: string | null,
  ) {
    setSaving(true)
    setError(null)
    setSaved(false)

    const res = await fetch(`${config.apiUrl}/predictions`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: groupId,
        match_id: match.id,
        predicted_home_score: homeScore,
        predicted_away_score: awayScore,
        predicted_penalty_winner_team_id: penaltyWinnerTeamId,
      }),
    })

    setSaving(false)

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Erro ao salvar palpite')
      return
    }

    setSaved(true)
    onSaved(match.id, homeScore, awayScore, penaltyWinnerTeamId)
    setTimeout(() => setSaved(false), 2500)
  }

  async function handleSave() {
    if (!canSave) return
    trackEvent('click_matchcard_salvar', { match_id: match.id })
    await persist(Number(home), Number(away), penaltyToSend)
  }

  function selectPenaltyWinner(teamId: string) {
    if (locked || saving) return
    trackEvent('click_prediction_vencedor_penaltis', { match_id: match.id })
    setPenaltyWinner(teamId)
    onDraftChange?.(match.id, home, away, teamId)
  }

  // Outcome-only groups store the pick as a score: casa=(1,0), empate=(0,0), fora=(0,1).
  const OUTCOMES = {
    home: { home: 1, away: 0, label: 'Casa' },
    draw: { home: 0, away: 0, label: 'Empate' },
    away: { home: 0, away: 1, label: 'Fora' },
  } as const
  type Outcome = keyof typeof OUTCOMES

  const selectedOutcome: Outcome | null = hasPrediction
    ? prediction.predicted_home_score > prediction.predicted_away_score
      ? 'home'
      : prediction.predicted_home_score < prediction.predicted_away_score
        ? 'away'
        : 'draw'
    : pendingOutcome

  async function selectOutcome(outcome: Outcome) {
    if (locked || saving) return
    if (outcome === selectedOutcome) return
    trackEvent('click_matchcard_resultado', { match_id: match.id, outcome })
    const { home: h, away: a } = OUTCOMES[outcome]
    setHome(String(h))
    setAway(String(a))
    setPendingOutcome(outcome)
    onDraftChange?.(match.id, String(h), String(a), null)
    await persist(h, a, null)
  }

  function updateHome(v: string) {
    setHomeTouched(true)
    setHome(v)
    onDraftChange?.(match.id, v, away, penaltyWinner)
  }

  function updateAway(v: string) {
    setAwayTouched(true)
    setAway(v)
    onDraftChange?.(match.id, home, v, penaltyWinner)
  }

  function handleScoreInput(value: string, update: (v: string) => void) {
    if (value === '' || /^\d{1,2}$/.test(value)) update(value)
  }

  return (
    <div
      className={`${styles.card} ${isLive ? styles.live : ''} ${locked && !isFinished ? styles.lockedCard : ''}`}
    >
      {/* Status badge */}
      <div className={styles.meta}>
        <span className={styles.date}>{formatDate(match.start_time)}</span>
        {isLive && <span className={styles.badgeLive}>ao vivo</span>}
        {isFinished && <span className={styles.badgeFinished}>encerrado</span>}
        {locked && !isFinished && !isLive && (
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
          {isFinished || isLive ? (
            <div className={styles.finalScoreWrap}>
              <div className={styles.finalScore}>
                <span>{match.home_score ?? '–'}</span>
                <span className={styles.scoreSep}>×</span>
                <span>{match.away_score ?? '–'}</span>
              </div>
              {match.penalty_winner_team_id != null &&
                match.penalty_home_score != null &&
                match.penalty_away_score != null && (
                  <span className={styles.penaltyResult}>
                    pên. {match.penalty_home_score} × {match.penalty_away_score} (
                    {penaltyWinnerShortName(match, match.penalty_winner_team_id)}
                    )
                  </span>
                )}
            </div>
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
        {locked ? (
          hasPrediction ? (
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
              {prediction.predicted_penalty_winner_team_id != null && (
                <span className={styles.lockedPenalty}>
                  pênaltis:{' '}
                  {penaltyWinnerShortName(match, prediction.predicted_penalty_winner_team_id)}
                </span>
              )}
              {isFinished && (
                <span
                  className={`${styles.points} ${prediction.points_awarded + (prediction.penalty_bonus ?? 0) > 0 ? styles.pointsGreen : styles.pointsZero}`}
                >
                  {pointsLabel(prediction.points_awarded, prediction.penalty_bonus ?? 0)}
                </span>
              )}
            </div>
          ) : (
            <p className={styles.noPrediction}>sem palpite registrado</p>
          )
        ) : outcomeOnly ? (
          <div className={styles.outcomeRow}>
            {(['home', 'draw', 'away'] as const).map((outcome) => (
              <button
                key={outcome}
                type="button"
                className={`${styles.outcomeBtn} ${selectedOutcome === outcome ? styles.outcomeBtnActive : ''}`}
                onClick={() => selectOutcome(outcome)}
                disabled={saving}
                aria-pressed={selectedOutcome === outcome}
              >
                {OUTCOMES[outcome].label}
              </button>
            ))}
            {saved && <span className={styles.outcomeSaved}>Salvo!</span>}
          </div>
        ) : (
          <div className={styles.inputRow}>
            <div className={styles.stepper}>
              <button
                className={`${styles.stepBtn} ${styles.stepBtnDec}`}
                onClick={() =>
                  updateHome(
                    String(Math.max(0, (home === '' ? 0 : Number(home)) - 1)),
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
                    String(Math.min(99, (home === '' ? 0 : Number(home)) + 1)),
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
                    String(Math.max(0, (away === '' ? 0 : Number(away)) - 1)),
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
                    String(Math.min(99, (away === '' ? 0 : Number(away)) + 1)),
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
        )}
        {showPenaltyPicker && !locked && (
          <div className={styles.penaltyPicker}>
            <span className={styles.penaltyLabel}>
              Empate no mata-mata — quem vence nos pênaltis? <span className={styles.penaltyBonus}>+1</span>
            </span>
            <div className={styles.penaltyOptions}>
              {(
                [
                  { id: match.home_team_id, name: match.home_team_short_name },
                  { id: match.away_team_id, name: match.away_team_short_name },
                ] as const
              ).map((team) => (
                <button
                  key={team.id}
                  type="button"
                  className={`${styles.penaltyBtn} ${penaltyWinner === team.id ? styles.penaltyBtnActive : ''}`}
                  onClick={() => selectPenaltyWinner(team.id)}
                  disabled={saving}
                  aria-pressed={penaltyWinner === team.id}
                >
                  {team.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {error && <p className={styles.errorMsg}>{error}</p>}
      </div>
    </div>
  )
}
