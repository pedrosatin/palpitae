import { describe, expect, it } from 'vitest'
import {
  buildMyPicksMap,
  clearInvalidatedPicks,
  getAvailableTeams,
  getChildPositions,
} from './bracketLogic'
import type { BracketData, BracketMatch, Pick, Round, SlotData, Team } from './types'

// ─── Fixtures ──────────────────────────────────────────────────────────────

function team(id: string, name = id, short = id): Team {
  return { id, name, short_name: short, logo_url: null }
}

function pick(teamId: string): Pick {
  return { team_id: teamId, team_name: teamId, team_short: teamId, team_logo: null }
}

function slot(position: number, overrides: Partial<SlotData> = {}): SlotData {
  return {
    position,
    match: null,
    locked: false,
    my_pick: null,
    members_picks: [],
    ...overrides,
  }
}

function match(homeId: string | null, awayId: string | null): BracketMatch {
  return {
    id: `m-${homeId}-${awayId}`,
    start_time: '2026-06-28T20:00:00Z',
    status: 'scheduled',
    home_score: null,
    away_score: null,
    home_team_id: homeId,
    home_team_name: homeId,
    home_team_short: homeId,
    home_team_logo: null,
    away_team_id: awayId,
    away_team_name: awayId,
    away_team_short: awayId,
    away_team_logo: null,
  }
}

// ─── getChildPositions ─────────────────────────────────────────────────────

describe('getChildPositions', () => {
  it('returns adjacent odd/even positions for the previous round', () => {
    expect(getChildPositions(1)).toEqual([1, 2])
    expect(getChildPositions(2)).toEqual([3, 4])
    expect(getChildPositions(5)).toEqual([9, 10])
  })
})

// ─── buildMyPicksMap ───────────────────────────────────────────────────────

describe('buildMyPicksMap', () => {
  it('keys picks by ROUND:position and skips empty slots', () => {
    const rounds: BracketData['rounds'] = {
      LAST_32: [slot(1, { my_pick: pick('BRA') }), slot(2)],
      LAST_16: [slot(1, { my_pick: pick('ARG') })],
    }
    const map = buildMyPicksMap(rounds)
    expect(map.get('LAST_32:1')?.team_id).toBe('BRA')
    expect(map.get('LAST_32:2')).toBeUndefined()
    expect(map.get('LAST_16:1')?.team_id).toBe('ARG')
    expect(map.size).toBe(2)
  })
})

// ─── getAvailableTeams ─────────────────────────────────────────────────────

describe('getAvailableTeams – match with determined teams', () => {
  it('returns duel buttons when both home/away are known', () => {
    const teams = [team('BRA'), team('ARG')]
    const result = getAvailableTeams('LAST_16', 1, match('BRA', 'ARG'), new Map(), teams, {})
    expect(result.kind).toBe('match')
    if (result.kind === 'match') {
      expect(result.teams.map((t) => t.id)).toEqual(['BRA', 'ARG'])
    }
  })
})

describe('getAvailableTeams – LAST_32 group quota', () => {
  const teamGroups: Record<string, string> = {
    A1: 'A', A2: 'A', A3: 'A', A4: 'A',
    B1: 'B', B2: 'B', B3: 'B', B4: 'B',
  }
  const allTeams: Team[] = [
    team('A1'), team('A2'), team('A3'), team('A4'),
    team('B1'), team('B2'), team('B3'), team('B4'),
  ]

  it('groups remaining teams by group letter when no picks exist', () => {
    const result = getAvailableTeams('LAST_32', 1, null, new Map(), allTeams, teamGroups)
    expect(result.kind).toBe('all')
    if (result.kind === 'all') {
      expect(result.grouped.get('A')?.map((t) => t.id)).toEqual(['A1', 'A2', 'A3', 'A4'])
      expect(result.grouped.get('B')?.map((t) => t.id)).toEqual(['B1', 'B2', 'B3', 'B4'])
    }
  })

  it('hides a group entirely once it reaches MAX_PICKS_PER_GROUP_R32 (3) in other slots', () => {
    const picks = new Map<string, Pick>([
      ['LAST_32:1', pick('A1')],
      ['LAST_32:2', pick('A2')],
      ['LAST_32:3', pick('A3')],
    ])
    // Editing slot 4 → group A already has 3 picks elsewhere, must be hidden
    const result = getAvailableTeams('LAST_32', 4, null, picks, allTeams, teamGroups)
    expect(result.kind).toBe('all')
    if (result.kind === 'all') {
      expect(result.grouped.has('A')).toBe(false)
      expect(result.grouped.get('B')?.length).toBe(4)
    }
  })

  it('keeps the group available when re-editing a slot whose own pick belongs to it', () => {
    const picks = new Map<string, Pick>([
      ['LAST_32:1', pick('A1')],
      ['LAST_32:2', pick('A2')],
      ['LAST_32:3', pick('A3')], // editing this slot
    ])
    // From slot 3's perspective: only slots 1, 2 count toward A's quota → 2 < 3 → A still open
    const result = getAvailableTeams('LAST_32', 3, null, picks, allTeams, teamGroups)
    expect(result.kind).toBe('all')
    if (result.kind === 'all') {
      // A1, A2 are used in OTHER slots → excluded. A3 is this slot's current pick,
      // so it doesn't count toward the quota and remains pickable alongside A4.
      expect(result.grouped.get('A')?.map((t) => t.id)).toEqual(['A3', 'A4'])
    }
  })

  it('excludes teams already used in other LAST_32 slots', () => {
    const picks = new Map<string, Pick>([['LAST_32:1', pick('B1')]])
    const result = getAvailableTeams('LAST_32', 2, null, picks, allTeams, teamGroups)
    if (result.kind === 'all') {
      expect(result.grouped.get('B')?.map((t) => t.id)).toEqual(['B2', 'B3', 'B4'])
    }
  })
})

describe('getAvailableTeams – cascade from previous round', () => {
  const teams = [team('BRA'), team('ARG'), team('FRA'), team('GER')]

  it('returns waiting when no picks in the feeding slots', () => {
    const result = getAvailableTeams('LAST_16', 1, null, new Map(), teams, {})
    expect(result.kind).toBe('waiting')
  })

  it('returns cascade with both feeding teams when both prev picks exist', () => {
    const picks = new Map<string, Pick>([
      ['LAST_32:1', pick('BRA')],
      ['LAST_32:2', pick('ARG')],
    ])
    const result = getAvailableTeams('LAST_16', 1, null, picks, teams, {})
    expect(result.kind).toBe('cascade')
    if (result.kind === 'cascade') {
      expect(result.teams.map((t) => t.id)).toEqual(['BRA', 'ARG'])
    }
  })

  it('returns cascade with a single team when only one prev pick exists', () => {
    const picks = new Map<string, Pick>([['LAST_32:1', pick('BRA')]])
    const result = getAvailableTeams('LAST_16', 1, null, picks, teams, {})
    expect(result.kind).toBe('cascade')
    if (result.kind === 'cascade') {
      expect(result.teams.map((t) => t.id)).toEqual(['BRA'])
    }
  })
})

// ─── clearInvalidatedPicks ─────────────────────────────────────────────────

describe('clearInvalidatedPicks', () => {
  it('clears a downstream pick when its team no longer advanced from the changed slot', () => {
    // R32 slot 1 had BRA, R16 slot 1 picked BRA. Now R32 slot 1 changes to ARG → R16 must clear.
    const rounds: BracketData['rounds'] = {
      LAST_32: [
        slot(1, { my_pick: pick('BRA') }),
        slot(2, { my_pick: pick('FRA') }),
      ],
      LAST_16: [slot(1, { my_pick: pick('BRA') })],
    }
    const updated = clearInvalidatedPicks(rounds, 'LAST_32', 1, 'ARG')
    expect(updated.LAST_16?.[0].my_pick).toBeNull()
  })

  it('keeps a downstream pick when it still matches one of the feeding picks', () => {
    const rounds: BracketData['rounds'] = {
      LAST_32: [
        slot(1, { my_pick: pick('BRA') }),
        slot(2, { my_pick: pick('FRA') }),
      ],
      LAST_16: [slot(1, { my_pick: pick('FRA') })],
    }
    const updated = clearInvalidatedPicks(rounds, 'LAST_32', 1, 'ARG')
    expect(updated.LAST_16?.[0].my_pick?.team_id).toBe('FRA')
  })

  it('cascades invalidation through multiple rounds', () => {
    // R32 slot 1 changes from BRA to ARG → R16 slot 1's pick (BRA) clears → QF slot 1's pick (BRA) also clears
    const rounds: BracketData['rounds'] = {
      LAST_32: [
        slot(1, { my_pick: pick('BRA') }),
        slot(2, { my_pick: pick('FRA') }),
        slot(3, { my_pick: pick('GER') }),
        slot(4, { my_pick: pick('ITA') }),
      ],
      LAST_16: [
        slot(1, { my_pick: pick('BRA') }),
        slot(2, { my_pick: pick('GER') }),
      ],
      QUARTER_FINALS: [slot(1, { my_pick: pick('BRA') })],
    }
    const updated = clearInvalidatedPicks(rounds, 'LAST_32', 1, 'ARG')
    expect(updated.LAST_16?.[0].my_pick).toBeNull()
    expect(updated.LAST_16?.[1].my_pick?.team_id).toBe('GER')
    expect(updated.QUARTER_FINALS?.[0].my_pick).toBeNull()
  })

  it('does not clear when prev round has no picks at all (initial editing)', () => {
    const rounds: BracketData['rounds'] = {
      LAST_32: [], // no LAST_32 picks
      LAST_16: [slot(1, { my_pick: pick('BRA') })],
    }
    const updated = clearInvalidatedPicks(rounds, 'LAST_16', 1, 'BRA')
    expect(updated.LAST_16?.[0].my_pick?.team_id).toBe('BRA')
  })
})

// suppress unused-import warning for SlotData (it's only used as a type)
export type _Unused = Round
