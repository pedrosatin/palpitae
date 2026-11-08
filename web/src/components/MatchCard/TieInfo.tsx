import { predictedAggregateText, tieDateHint, tieSummary } from '../../lib/tieSummary'
import { type Match, type Prediction } from './types'
import styles from './MatchCard.module.css'

interface TieInfoProps {
  match: Match
  leg1Match?: Match
  leg2Match?: Match
  home: string
  away: string
  leg1Prediction?: Prediction
  locked: boolean
}

/** Placar da ida, agregado e dias da ida e da volta nos cards do mata-mata. */
export default function TieInfo({
  match,
  leg1Match,
  leg2Match,
  home,
  away,
  leg1Prediction,
  locked,
}: TieInfoProps) {
  const summary = tieSummary(match, leg1Match)
  const predictedAggregate = locked
    ? null
    : predictedAggregateText(match, home, away, leg1Prediction)
  const dateHint = tieDateHint(match, leg1Match, leg2Match)
  if (!summary && !predictedAggregate && !dateHint) return null

  return (
    <div className={styles.tieInfo}>
      {summary && <p>{summary.leg1}</p>}
      {summary?.aggregate && <p className={styles.tieAggregate}>{summary.aggregate}</p>}
      {dateHint && <p>{dateHint}</p>}
      {predictedAggregate && <p>{predictedAggregate}</p>}
    </div>
  )
}
