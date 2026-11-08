import { predictedAggregateText, tieSummary } from '../../lib/tieSummary'
import { type Match, type Prediction } from './types'
import styles from './MatchCard.module.css'

interface TieInfoProps {
  match: Match
  leg1Match?: Match
  home: string
  away: string
  leg1Prediction?: Prediction
  locked: boolean
}

/** Placar da ida, agregado real e agregado previsto no card do jogo de volta. */
export default function TieInfo({
  match,
  leg1Match,
  home,
  away,
  leg1Prediction,
  locked,
}: TieInfoProps) {
  const summary = tieSummary(match, leg1Match)
  const predictedAggregate = locked
    ? null
    : predictedAggregateText(match, home, away, leg1Prediction)
  if (!summary && !predictedAggregate) return null

  return (
    <div className={styles.tieInfo}>
      {summary && <p>{summary.leg1}</p>}
      {summary?.aggregate && <p className={styles.tieAggregate}>{summary.aggregate}</p>}
      {predictedAggregate && <p>{predictedAggregate}</p>}
    </div>
  )
}
