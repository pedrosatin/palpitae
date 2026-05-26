import { useState } from 'react'
import { config } from '../../config'
import styles from './MatchCard.module.css'

export interface Match {
  id: string
  start_time: string
  status: 'scheduled' | 'live' | 'finished'
  home_score: number | null
  away_score: number | null
  phase: string
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
}

export interface Prediction {
  id: string
  match_id: string
  predicted_home_score: number
  predicted_away_score: number
  points_awarded: number
  locked: boolean | 1 | 0
  updated_at: string
}

interface MatchCardProps {
  match: Match
  prediction: Prediction | undefined
  groupId: string
  onSaved: (matchId: string, home: number, away: number) => void
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
  onSaved,
}: MatchCardProps) {
  const locked =
    Boolean(prediction?.locked) || new Date() >= new Date(match.start_time)

  const [home, setHome] = useState<string>(
    prediction !== undefined ? String(prediction.predicted_home_score) : '',
  )
  const [away, setAway] = useState<string>(
    prediction !== undefined ? String(prediction.predicted_away_score) : '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const isFinished = match.status === 'finished'
  const isLive = match.status === 'live'
  const hasPrediction = prediction !== undefined
  const hasChanged =
    !hasPrediction ||
    Number(home) !== prediction.predicted_home_score ||
    Number(away) !== prediction.predicted_away_score
  const canSave = !locked && home !== '' && away !== '' && !saving && hasChanged

  async function handleSave() {
    if (!canSave) return
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
        predicted_home_score: Number(home),
        predicted_away_score: Number(away),
      }),
    })

    setSaving(false)

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Erro ao salvar palpite')
      return
    }

    setSaved(true)
    onSaved(match.id, Number(home), Number(away))
    setTimeout(() => setSaved(false), 2500)
  }

  function handleScoreInput(value: string, setter: (v: string) => void) {
    if (value === '' || /^\d{1,2}$/.test(value)) setter(value)
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
            <div className={styles.finalScore}>
              <span>{match.home_score ?? '–'}</span>
              <span className={styles.scoreSep}>×</span>
              <span>{match.away_score ?? '–'}</span>
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
              <div className={styles.lockedScores}>
                <span className={styles.lockedScore}>
                  {prediction.predicted_home_score}
                </span>
                <span className={styles.lockedSep}>×</span>
                <span className={styles.lockedScore}>
                  {prediction.predicted_away_score}
                </span>
              </div>
              {isFinished && (
                <span
                  className={`${styles.points} ${prediction.points_awarded > 0 ? styles.pointsGreen : styles.pointsZero}`}
                >
                  {prediction.points_awarded}{' '}
                  {prediction.points_awarded === 1 ? 'ponto' : 'pontos'}
                </span>
              )}
            </div>
          ) : (
            <p className={styles.noPrediction}>sem palpite registrado</p>
          )
        ) : (
          <div className={styles.inputRow}>
            <div className={styles.stepper}>
              <button
                className={`${styles.stepBtn} ${styles.stepBtnDec}`}
                onClick={() =>
                  setHome(
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
                min={0}
                max={99}
                placeholder="0"
                value={home}
                onChange={(e) => handleScoreInput(e.target.value, setHome)}
                aria-label={`Placar ${match.home_team_name}`}
              />
              <button
                className={`${styles.stepBtn} ${styles.stepBtnInc}`}
                onClick={() =>
                  setHome(
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
                  setAway(
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
                min={0}
                max={99}
                placeholder="0"
                value={away}
                onChange={(e) => handleScoreInput(e.target.value, setAway)}
                aria-label={`Placar ${match.away_team_name}`}
              />
              <button
                className={`${styles.stepBtn} ${styles.stepBtnInc}`}
                onClick={() =>
                  setAway(
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
        {error && <p className={styles.errorMsg}>{error}</p>}
      </div>
    </div>
  )
}
