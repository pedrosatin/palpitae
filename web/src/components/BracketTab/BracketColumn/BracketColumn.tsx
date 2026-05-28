import { getAvailableTeams } from '../bracketLogic'
import BracketSlotCard from '../BracketSlotCard'
import { ROUND_LABELS, SLOT_BASE_HEIGHT } from '../constants'
import type { Pick, Round, SlotData, Team } from '../types'
import styles from './BracketColumn.module.css'

interface BracketColumnProps {
  round: Round
  positions: number[] // which positions this column shows (1-based)
  slotsMap: Map<number, SlotData>
  allTeams: Team[]
  teamGroups: Record<string, string>
  myPicksMap: Map<string, Pick>
  points: number
  onPick: (position: number, round: Round, teamId: string) => void
  savingKey: string | null
  reversed?: boolean
}

// roundIndex: 0=R32, 1=R16, 2=QF, 3=SF
const ROUND_INDEX: Record<Round, number> = {
  LAST_32: 0,
  LAST_16: 1,
  QUARTER_FINALS: 2,
  SEMI_FINALS: 3,
  FINAL: 4,
  THIRD_PLACE: 4,
}

export default function BracketColumn({
  round,
  positions,
  slotsMap,
  allTeams,
  teamGroups,
  myPicksMap,
  points,
  onPick,
  savingKey,
  reversed = false,
}: BracketColumnProps) {
  const slotHeight = SLOT_BASE_HEIGHT * Math.pow(2, ROUND_INDEX[round])
  const totalHeight = positions.length * slotHeight

  return (
    <div
      className={`${styles.bracketColumn} ${reversed ? styles.bracketColumnReversed : ''}`}
      style={{ height: totalHeight }}
    >
      <div className={styles.bracketColumnLabel}>{ROUND_LABELS[round]}</div>
      {positions.map((pos, idx) => {
        const slot = slotsMap.get(pos) ?? null
        const isSaving = savingKey === `${round}:${pos}`
        const availableTeams = getAvailableTeams(
          round,
          pos,
          slot?.match ?? null,
          myPicksMap,
          allTeams,
          teamGroups,
        )
        return (
          <div
            key={pos}
            className={`${styles.bracketSlot} ${idx % 2 === 1 ? styles.bracketSlotEven : ''}`}
            style={{ height: slotHeight }}
          >
            <div className={styles.bracketSlotInner}>
              <BracketSlotCard
                slot={slot}
                position={pos}
                round={round}
                availableTeams={availableTeams}
                points={points}
                onPick={onPick}
                saving={isSaving}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
