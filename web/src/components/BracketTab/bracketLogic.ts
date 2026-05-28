import { MAX_PICKS_PER_GROUP_R32, PREV_ROUND } from './constants'
import type { AvailableTeamsResult, BracketData, BracketMatch, Pick, Round, SlotData, Team } from './types'

/**
 * The two child positions (in the previous round) that feed into `position`.
 * e.g. position 1 → [1, 2]; position 2 → [3, 4]; position 3 → [5, 6]
 */
export function getChildPositions(position: number): [number, number] {
  return [2 * position - 1, 2 * position]
}

/** Build a flat map: 'ROUND:position' → Pick, from all rounds data */
export function buildMyPicksMap(rounds: BracketData['rounds']): Map<string, Pick> {
  const map = new Map<string, Pick>()
  for (const [r, slots] of Object.entries(rounds) as [Round, SlotData[]][]) {
    for (const slot of slots ?? []) {
      if (slot.my_pick) map.set(`${r}:${slot.position}`, slot.my_pick)
    }
  }
  return map
}

/**
 * Compute which teams are available for a given slot, applying cascade constraints.
 *
 * - Match with determined teams: 2 duel buttons
 * - LAST_32 TBD: full grouped dropdown (capped at MAX_PICKS_PER_GROUP_R32 per group)
 * - R16+ with prev picks: up to 2 cascade buttons
 * - R16+ with no prev picks: waiting state (don't pick yet)
 */
export function getAvailableTeams(
  round: Round,
  position: number,
  match: BracketMatch | null,
  myPicksMap: Map<string, Pick>,
  allTeams: Team[],
  teamGroups: Record<string, string>,
): AvailableTeamsResult {
  // Match has determined teams → 2 duel buttons
  if (match?.home_team_id && match?.away_team_id) {
    const find = (id: string, name: string | null, short: string | null, logo: string | null): Team =>
      allTeams.find((t) => t.id === id) ?? { id, name: name ?? id, short_name: short ?? id, logo_url: logo }
    return {
      kind: 'match',
      teams: [
        find(match.home_team_id, match.home_team_name, match.home_team_short, match.home_team_logo),
        find(match.away_team_id, match.away_team_name, match.away_team_short, match.away_team_logo),
      ],
    }
  }

  if (round === 'LAST_32') {
    // Exclude teams already picked in other LAST_32 slots (each team only once)
    // and count picks per group to enforce the WC2026 cap: top 2 + best third.
    const usedTeamIds = new Set<string>()
    const picksPerGroup = new Map<string, number>()
    for (const [key, pick] of myPicksMap.entries()) {
      if (key.startsWith('LAST_32:') && key !== `LAST_32:${position}`) {
        usedTeamIds.add(pick.team_id)
        const g = teamGroups[pick.team_id]
        if (g) picksPerGroup.set(g, (picksPerGroup.get(g) ?? 0) + 1)
      }
    }

    const grouped = new Map<string, Team[]>()
    for (const t of allTeams) {
      if (usedTeamIds.has(t.id)) continue
      const g = teamGroups[t.id] ?? '—'
      if ((picksPerGroup.get(g) ?? 0) >= MAX_PICKS_PER_GROUP_R32) continue
      if (!grouped.has(g)) grouped.set(g, [])
      grouped.get(g)!.push(t)
    }
    return { kind: 'all', grouped: new Map([...grouped.entries()].sort()) }
  }

  // Third place is contested by the two SEMI *losers*, not the winners.
  // Each semi's loser is the QF pick that fed that semi but was NOT chosen as
  // the semi winner. Without this special case, THIRD_PLACE would cascade from
  // the same SEMI picks as FINAL and show an identical pair of teams.
  if (round === 'THIRD_PLACE') {
    const losers: Team[] = []
    for (const semiPos of [1, 2]) {
      const semiWinner = myPicksMap.get(`SEMI_FINALS:${semiPos}`)
      if (!semiWinner) continue // loser undetermined until the semi winner is picked
      const [q1, q2] = getChildPositions(semiPos)
      for (const qPick of [myPicksMap.get(`QUARTER_FINALS:${q1}`), myPicksMap.get(`QUARTER_FINALS:${q2}`)]) {
        if (!qPick || qPick.team_id === semiWinner.team_id) continue
        const t = allTeams.find((t) => t.id === qPick.team_id)
        if (t) losers.push(t)
      }
    }
    if (losers.length > 0) return { kind: 'cascade', teams: losers }
    return { kind: 'waiting' }
  }

  // Cascade from previous round picks
  const prevRound = PREV_ROUND[round]!
  const [c1, c2] = getChildPositions(position)
  const pick1 = myPicksMap.get(`${prevRound}:${c1}`)
  const pick2 = myPicksMap.get(`${prevRound}:${c2}`)

  const cascadeTeams: Team[] = []
  if (pick1) {
    const t = allTeams.find((t) => t.id === pick1.team_id)
    if (t) cascadeTeams.push(t)
  }
  if (pick2) {
    const t = allTeams.find((t) => t.id === pick2.team_id)
    if (t) cascadeTeams.push(t)
  }

  if (cascadeTeams.length > 0) return { kind: 'cascade', teams: cascadeTeams }
  return { kind: 'waiting' }
}

/**
 * After a pick change, clear any downstream picks that are no longer valid
 * (i.e., the team can't have advanced because they weren't picked in the feeding slot).
 */
export function clearInvalidatedPicks(
  rounds: BracketData['rounds'],
  changedRound: Round,
  changedPosition: number,
  changedTeamId: string,
): BracketData['rounds'] {
  // Build working picks map including the newly changed pick
  const picks = new Map<string, string>()
  for (const [r, slots] of Object.entries(rounds) as [Round, SlotData[]][]) {
    for (const slot of slots ?? []) {
      if (slot.my_pick) picks.set(`${r}:${slot.position}`, slot.my_pick.team_id)
    }
  }
  picks.set(`${changedRound}:${changedPosition}`, changedTeamId)

  // Validate in cascade order (early rounds first). THIRD_PLACE is handled
  // separately below since it derives from semi *losers*, not winners.
  const VALIDATION_ORDER: Round[] = ['LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'FINAL']
  const updated = { ...rounds }

  for (const round of VALIDATION_ORDER) {
    const prevRound = PREV_ROUND[round]
    if (!prevRound) continue
    const slots = updated[round]
    if (!slots) continue

    updated[round] = slots.map((slot) => {
      if (!slot.my_pick) return slot
      const [c1, c2] = getChildPositions(slot.position)
      const p1 = picks.get(`${prevRound}:${c1}`)
      const p2 = picks.get(`${prevRound}:${c2}`)
      // If prev round has no picks for either child, don't clear (not cascading yet)
      if (!p1 && !p2) return slot
      const validIds = new Set([p1, p2].filter(Boolean) as string[])
      if (!validIds.has(slot.my_pick.team_id)) {
        picks.delete(`${round}:${slot.position}`)
        return { ...slot, my_pick: null }
      }
      return slot
    })
  }

  // THIRD_PLACE: valid teams are the two semi losers (a QF pick that fed a semi
  // but wasn't picked as that semi's winner).
  const thirdSlots = updated['THIRD_PLACE']
  if (thirdSlots) {
    updated['THIRD_PLACE'] = thirdSlots.map((slot) => {
      if (!slot.my_pick) return slot
      const validLosers = new Set<string>()
      for (const semiPos of [1, 2]) {
        const semiWinner = picks.get(`SEMI_FINALS:${semiPos}`)
        const [q1, q2] = getChildPositions(semiPos)
        for (const qPick of [picks.get(`QUARTER_FINALS:${q1}`), picks.get(`QUARTER_FINALS:${q2}`)]) {
          if (!qPick || qPick === semiWinner) continue
          validLosers.add(qPick)
        }
      }
      // Nothing to validate against yet → leave the pick untouched
      if (validLosers.size === 0) return slot
      if (!validLosers.has(slot.my_pick.team_id)) {
        picks.delete(`THIRD_PLACE:${slot.position}`)
        return { ...slot, my_pick: null }
      }
      return slot
    })
  }

  return updated
}
