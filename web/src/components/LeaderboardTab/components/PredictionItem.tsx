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
          <div className={styles.predMeta}>
            <span className={styles.predDate}>{formatDate(p.match_start_time)}</span>
            {isFinished && (
              <span
                className={
                  (p.points_awarded ?? 0) > 0 ? styles.predPointsGreen : styles.predPointsZero
                }
              >
                {p.points_awarded} pt
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
