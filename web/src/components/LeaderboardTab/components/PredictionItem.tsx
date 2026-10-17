import styles from '../LeaderboardTab.module.css'
import type { UserPrediction } from '../types'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

interface PredictionItemProps {
  prediction: UserPrediction
}

export function PredictionItem({ prediction: p }: PredictionItemProps) {
  const isFinished = p.match_status === 'finished'
  const hasPrediction = p.predicted_home_score !== null
  const isScheduled = p.match_status === 'scheduled'
  const totalPoints = (p.points_awarded ?? 0) + (p.penalty_points ?? 0) + (p.classified_points ?? 0)
  const classifiedTeam =
    p.predicted_classified === 'home'
      ? p.home_team_short_name
      : p.predicted_classified === 'away'
        ? p.away_team_short_name
        : null

  return (
    <li className={styles.predItem}>
      <div className={styles.predMatch}>
        <span className={styles.predTeam}>
          <img
            src={p.home_team_logo}
            alt={p.home_team_short_name}
            className={styles.predCrest}
            loading="lazy"
          />
          {p.home_team_short_name}
        </span>
        <span className={styles.predVs}>×</span>
        <span className={`${styles.predTeam} ${styles.predTeamAway}`}>
          {p.away_team_short_name}
          <img
            src={p.away_team_logo}
            alt={p.away_team_short_name}
            className={styles.predCrest}
            loading="lazy"
          />
        </span>
      </div>
      {hasPrediction ? (
        <>
          <div className={styles.predScores}>
            <span className={styles.predLabel}>Palpite</span>
            <span className={styles.predScore}>
              {p.predicted_home_score} × {p.predicted_away_score}
            </span>
            {isFinished && (
              <>
                <span className={styles.predLabel}>Resultado</span>
                <span className={styles.predScore}>
                  {p.home_score ?? '–'} × {p.away_score ?? '–'}
                </span>
              </>
            )}
          </div>
          {classifiedTeam && (
            <p className={styles.predNone}>Classificado previsto: {classifiedTeam}</p>
          )}
          <div className={styles.predMeta}>
            <span className={styles.predDate}>{formatDate(p.match_start_time)}</span>
            {isFinished && (
              <span className={totalPoints > 0 ? styles.predPointsGreen : styles.predPointsZero}>
                {totalPoints} pt
                {(p.classified_points ?? 0) > 0 && ` (+${p.classified_points} classificado)`}
                {(p.penalty_points ?? 0) > 0 && ` (+${p.penalty_points} pênalti)`}
              </span>
            )}
          </div>
        </>
      ) : (
        <p className={styles.predNone}>
          {isScheduled ? formatDate(p.match_start_time) : 'Sem palpite'}
        </p>
      )}
    </li>
  )
}
