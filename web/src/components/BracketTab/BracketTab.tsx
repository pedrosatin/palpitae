import { useEffect, useState } from 'react'
import { config } from '../../config'
import {
  buildMyPicksMap,
  clearInvalidatedPicks,
  getAvailableTeams,
} from './bracketLogic'
import BracketColumn from './BracketColumn'
import BracketSlotCard from './BracketSlotCard'
import {
  HALF_SLOTS,
  LEFT_BRACKET_ROUNDS,
  RIGHT_BRACKET_ROUNDS,
  ROUND_LABELS,
} from './constants'
import styles from './BracketTab.module.css'
import type { BracketData, Pick, Round, SlotData } from './types'

interface BracketTabProps {
  groupId: string
  competitionId: string
}

export default function BracketTab({
  groupId,
  competitionId,
}: BracketTabProps) {
  const [data, setData] = useState<BracketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(
      `${config.apiUrl}/bracket?competition_id=${encodeURIComponent(competitionId)}&group_id=${encodeURIComponent(groupId)}`,
      { credentials: 'include' },
    )
      .then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar o chaveamento')
        return r.json() as Promise<BracketData>
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId, competitionId])

  async function handlePick(position: number, round: Round, teamId: string) {
    if (!data) return
    const key = `${round}:${position}`
    setSavingKey(key)
    setSaveError(null)

    try {
      const res = await fetch(`${config.apiUrl}/bracket`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: groupId,
          competition_id: competitionId,
          round,
          position,
          team_id: teamId,
        }),
      })

      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Erro ao salvar')
      }

      const { pick } = (await res.json()) as { pick: Pick }

      // Update local state and cascade-clear any now-invalid downstream picks
      setData((prev) => {
        if (!prev) return prev
        let rounds = { ...prev.rounds }
        const slots = rounds[round] ? [...rounds[round]!] : []
        const idx = slots.findIndex((s) => s.position === position)
        if (idx >= 0) {
          slots[idx] = { ...slots[idx], my_pick: pick }
        } else {
          slots.push({
            position,
            match: null,
            locked: false,
            my_pick: pick,
            members_picks: [],
          })
          slots.sort((a, b) => a.position - b.position)
        }
        rounds[round] = slots
        rounds = clearInvalidatedPicks(rounds, round, position, teamId)
        return { ...prev, rounds }
      })
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSavingKey(null)
    }
  }

  if (loading)
    return <div className={styles.message}>Carregando chaveamento...</div>
  if (error) return <div className={styles.errorMessage}>{error}</div>
  if (!data) return null

  const { teams, team_groups, rounds, round_points } = data
  const myPicksMap = buildMyPicksMap(rounds)

  function buildSlotMap(round: Round): Map<number, SlotData> {
    const map = new Map<number, SlotData>()
    for (const s of rounds[round] ?? []) map.set(s.position, s)
    return map
  }

  function leftPositions(round: Round): number[] {
    const n = HALF_SLOTS[round] ?? 0
    return Array.from({ length: n }, (_, i) => i + 1)
  }

  function rightPositions(round: Round): number[] {
    const half = HALF_SLOTS[round] ?? 0
    return Array.from({ length: half }, (_, i) => half + i + 1)
  }

  const finalSlot = buildSlotMap('FINAL').get(1) ?? null
  const thirdSlot = buildSlotMap('THIRD_PLACE').get(1) ?? null
  const finalAvailable = getAvailableTeams(
    'FINAL',
    1,
    finalSlot?.match ?? null,
    myPicksMap,
    teams,
    team_groups,
  )
  const thirdAvailable = getAvailableTeams(
    'THIRD_PLACE',
    1,
    thirdSlot?.match ?? null,
    myPicksMap,
    teams,
    team_groups,
  )

  return (
    <div className={styles.root}>
      {saveError && <div className={styles.saveError}>{saveError}</div>}

      <div className={styles.info}>
        <span>
          Pontuação: 16 avos 1pt · Oitavas 2pt · Quartas 4pt · Semi 8pt · Final
          16pt
        </span>
      </div>

      <div className={styles.bracketWrapper}>
        <div className={styles.half}>
          {LEFT_BRACKET_ROUNDS.map((round) => (
            <BracketColumn
              key={round}
              round={round}
              positions={leftPositions(round)}
              slotsMap={buildSlotMap(round)}
              allTeams={teams}
              teamGroups={team_groups}
              myPicksMap={myPicksMap}
              points={round_points[round]}
              onPick={handlePick}
              savingKey={savingKey}
            />
          ))}
        </div>

        <div className={styles.finalSection}>
          <div className={styles.finalLabel}>{ROUND_LABELS['FINAL']}</div>
          <div className={styles.finalSlot}>
            <BracketSlotCard
              slot={finalSlot}
              position={1}
              round="FINAL"
              availableTeams={finalAvailable}
              points={round_points['FINAL']}
              onPick={handlePick}
              saving={savingKey === 'FINAL:1'}
            />
          </div>
          <div className={styles.thirdPlaceSection}>
            <div className={styles.thirdPlaceLabel}>
              {ROUND_LABELS['THIRD_PLACE']}
            </div>
            <BracketSlotCard
              slot={thirdSlot}
              position={1}
              round="THIRD_PLACE"
              availableTeams={thirdAvailable}
              points={round_points['THIRD_PLACE']}
              onPick={handlePick}
              saving={savingKey === 'THIRD_PLACE:1'}
            />
          </div>
        </div>

        <div className={`${styles.half} ${styles.halfRight}`}>
          {RIGHT_BRACKET_ROUNDS.map((round) => (
            <BracketColumn
              key={round}
              round={round}
              positions={rightPositions(round)}
              slotsMap={buildSlotMap(round)}
              allTeams={teams}
              teamGroups={team_groups}
              myPicksMap={myPicksMap}
              points={round_points[round]}
              onPick={handlePick}
              savingKey={savingKey}
              reversed
            />
          ))}
        </div>
      </div>

      {teams.length === 0 && (
        <div className={styles.emptyState}>
          <p>O bracket estará disponível quando os times forem definidos.</p>
          <p className={styles.emptySubtitle}>
            Enquanto isso, você pode antecipar seus palpites — mas nenhum time
            está disponível ainda.
          </p>
        </div>
      )}
    </div>
  )
}
