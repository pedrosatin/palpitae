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
  // user_id of the member whose bracket is being viewed; null = my own (editable)
  const [viewedMember, setViewedMember] = useState<string | null>(null)
  // When true, the bracket renders as a full-viewport overlay so the wide
  // knockout grid has room to breathe without the page container's padding.
  const [expanded, setExpanded] = useState(false)

  // Close the overlay with Esc and lock background scroll while it's open.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [expanded])

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
    if (!data || viewedMember !== null) return
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

  const { teams, team_groups, rounds: rawRounds, round_points } = data
  const viewingOther = viewedMember !== null

  // Distinct members who have at least one pick (excluding myself) — the people
  // whose brackets can be viewed.
  const memberOptions = (() => {
    const byId = new Map<string, string>()
    for (const slots of Object.values(rawRounds)) {
      for (const slot of slots ?? []) {
        for (const mp of slot.members_picks) {
          if (mp.user_id !== data.self_user_id) byId.set(mp.user_id, mp.user_display)
        }
      }
    }
    return [...byId.entries()]
      .map(([user_id, display]) => ({ user_id, display }))
      .sort((a, b) => a.display.localeCompare(b.display))
  })()

  const viewedDisplay = memberOptions.find((m) => m.user_id === viewedMember)?.display

  // When viewing another member, project their picks onto each slot's `my_pick`
  // and force the slot locked (read-only). The whole cascade/render pipeline then
  // works unchanged, since it reads `my_pick`/`locked`.
  const rounds: BracketData['rounds'] = viewingOther
    ? Object.fromEntries(
        (Object.entries(rawRounds) as [Round, SlotData[]][]).map(([round, slots]) => [
          round,
          slots.map((slot) => {
            const mp = slot.members_picks.find((m) => m.user_id === viewedMember)
            return {
              ...slot,
              locked: true,
              my_pick: mp
                ? {
                    team_id: mp.team_id,
                    team_name: mp.team_name,
                    team_short: mp.team_short,
                    team_logo: mp.team_logo,
                  }
                : null,
            }
          }),
        ]),
      )
    : rawRounds

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
    <div className={`${styles.root} ${expanded ? styles.rootExpanded : ''}`}>
      {saveError && <div className={styles.saveError}>{saveError}</div>}

      {memberOptions.length > 0 && (
        <div className={styles.viewBar}>
          <label className={styles.viewLabel} htmlFor="bracket-view-member">
            Ver chaveamento de:
          </label>
          <select
            id="bracket-view-member"
            className={styles.viewSelect}
            value={viewedMember ?? ''}
            onChange={(e) => setViewedMember(e.target.value || null)}
          >
            <option value="">Meu chaveamento (editável)</option>
            {memberOptions.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display}
              </option>
            ))}
          </select>
        </div>
      )}

      {viewingOther && (
        <div className={styles.viewNotice}>
          Visualizando o chaveamento de <strong>{viewedDisplay}</strong> — somente
          leitura.
        </div>
      )}

      <div className={styles.info}>
        <span>
          Pontuação: 16 avos 1pt · Oitavas 2pt · Quartas 4pt · Semi 8pt · Final
          16pt
        </span>
        <button
          type="button"
          className={styles.expandBtn}
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Sair da tela cheia (Esc)' : 'Expandir chaveamento'}
          aria-label={expanded ? 'Sair da tela cheia' : 'Expandir chaveamento'}
          aria-pressed={expanded}
        >
          {expanded ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9 9H4m5 0V4m0 5L4 4m11 5h5m-5 0V4m0 5l5-5M9 15H4m5 0v5m0-5l-5 5m11-5h5m-5 0v5m0-5l5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <span className={styles.expandBtnLabel}>
            {expanded ? 'Reduzir' : 'Tela cheia'}
          </span>
        </button>
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
              readOnly={viewingOther}
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
              readOnly={viewingOther}
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
              readOnly={viewingOther}
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
              readOnly={viewingOther}
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
