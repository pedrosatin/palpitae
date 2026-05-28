import { ROUND_LABELS } from '../constants'
import TeamPicker from '../TeamPicker'
import type { AvailableTeamsResult, Round, SlotData } from '../types'
import styles from './BracketSlotCard.module.css'

interface BracketSlotCardProps {
  slot: SlotData | null
  position: number
  round: Round
  availableTeams: AvailableTeamsResult
  points: number
  onPick: (position: number, round: Round, teamId: string) => void
  saving: boolean
}

export default function BracketSlotCard({
  slot,
  position,
  round,
  availableTeams,
  points,
  onPick,
  saving,
}: BracketSlotCardProps) {
  const match = slot?.match ?? null
  const locked = slot?.locked ?? false
  const myPick = slot?.my_pick ?? null
  const membersCount = slot?.members_picks.length ?? 0

  return (
    <div className={`${styles.slotCard} ${saving ? styles.slotCardSaving : ''}`}>
      <div className={styles.slotHeader}>
        <span className={styles.slotRound}>{ROUND_LABELS[round]}</span>
        <span className={styles.slotPoints}>{points}pt</span>
      </div>

      {match && (
        <div className={styles.slotMatchInfo}>
          {match.status === 'finished' && match.home_score != null ? (
            <span className={styles.slotScore}>
              {match.home_team_short ?? '?'} {match.home_score}–{match.away_score}{' '}
              {match.away_team_short ?? '?'}
            </span>
          ) : (
            <span className={styles.slotDate}>
              {new Date(match.start_time).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
              })}
            </span>
          )}
        </div>
      )}

      <TeamPicker
        available={availableTeams}
        currentPick={myPick?.team_id ?? null}
        onPick={(teamId) => onPick(position, round, teamId)}
        locked={locked}
      />

      {membersCount > 0 && (
        <div className={styles.slotPicksCount}>
          {membersCount} palpite{membersCount > 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}
