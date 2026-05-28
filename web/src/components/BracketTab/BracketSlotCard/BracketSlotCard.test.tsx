import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import BracketSlotCard from './BracketSlotCard'
import type { AvailableTeamsResult, BracketMatch, SlotData, Team } from '../types'

// ─── Fixtures ──────────────────────────────────────────────────────────────

function team(id: string): Team {
  return { id, name: id, short_name: id, logo_url: null }
}

function slot(overrides: Partial<SlotData> = {}): SlotData {
  return {
    position: 1,
    match: null,
    locked: false,
    my_pick: null,
    members_picks: [],
    ...overrides,
  }
}

function match(overrides: Partial<BracketMatch> = {}): BracketMatch {
  return {
    id: 'm1',
    start_time: '2026-06-28T20:00:00Z',
    status: 'scheduled',
    home_score: null,
    away_score: null,
    home_team_id: 'BRA',
    home_team_name: 'Brasil',
    home_team_short: 'BRA',
    home_team_logo: null,
    away_team_id: 'ARG',
    away_team_name: 'Argentina',
    away_team_short: 'ARG',
    away_team_logo: null,
    ...overrides,
  }
}

const cascadeAvailable: AvailableTeamsResult = {
  kind: 'cascade',
  teams: [team('BRA'), team('ARG')],
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('BracketSlotCard – header', () => {
  it('renders the round label and points', () => {
    render(
      <BracketSlotCard
        slot={null}
        position={1}
        round="LAST_32"
        availableTeams={cascadeAvailable}
        points={1}
        onPick={vi.fn()}
        saving={false}
      />,
    )
    expect(screen.getByText('16 avos')).toBeInTheDocument()
    expect(screen.getByText('1pt')).toBeInTheDocument()
  })
})

describe('BracketSlotCard – match info', () => {
  it('shows the formatted start date for scheduled matches', () => {
    render(
      <BracketSlotCard
        slot={slot({ match: match() })}
        position={1}
        round="LAST_32"
        availableTeams={cascadeAvailable}
        points={1}
        onPick={vi.fn()}
        saving={false}
      />,
    )
    // 2026-06-28 → "28/06" in pt-BR
    expect(screen.getByText('28/06')).toBeInTheDocument()
  })

  it('shows the score when the match is finished', () => {
    render(
      <BracketSlotCard
        slot={slot({ match: match({ status: 'finished', home_score: 2, away_score: 1 }) })}
        position={1}
        round="LAST_32"
        availableTeams={cascadeAvailable}
        points={1}
        onPick={vi.fn()}
        saving={false}
      />,
    )
    expect(screen.getByText(/BRA 2.+1.+ARG/)).toBeInTheDocument()
  })
})

describe('BracketSlotCard – picker interaction', () => {
  it('forwards the pick to onPick along with position and round', async () => {
    const onPick = vi.fn()
    render(
      <BracketSlotCard
        slot={slot({ position: 3 })}
        position={3}
        round="LAST_16"
        availableTeams={cascadeAvailable}
        points={2}
        onPick={onPick}
        saving={false}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'BRA' }))
    expect(onPick).toHaveBeenCalledWith(3, 'LAST_16', 'BRA')
  })
})

describe('BracketSlotCard – members count', () => {
  it('hides the count when zero', () => {
    render(
      <BracketSlotCard
        slot={slot({ members_picks: [] })}
        position={1}
        round="LAST_32"
        availableTeams={cascadeAvailable}
        points={1}
        onPick={vi.fn()}
        saving={false}
      />,
    )
    expect(screen.queryByText(/palpite/i)).toBeNull()
  })

  it('shows singular "palpite" when count is 1', () => {
    const memberPick = {
      user_id: 'u1', user_display: 'X', team_id: 'BRA',
      team_name: 'Brasil', team_short: 'BRA', team_logo: null,
    }
    render(
      <BracketSlotCard
        slot={slot({ members_picks: [memberPick] })}
        position={1}
        round="LAST_32"
        availableTeams={cascadeAvailable}
        points={1}
        onPick={vi.fn()}
        saving={false}
      />,
    )
    expect(screen.getByText('1 palpite')).toBeInTheDocument()
  })

  it('shows plural "palpites" when count > 1', () => {
    const mp = {
      user_id: 'u', user_display: 'X', team_id: 'BRA',
      team_name: 'B', team_short: 'B', team_logo: null,
    }
    render(
      <BracketSlotCard
        slot={slot({ members_picks: [mp, { ...mp, user_id: 'u2' }, { ...mp, user_id: 'u3' }] })}
        position={1}
        round="LAST_32"
        availableTeams={cascadeAvailable}
        points={1}
        onPick={vi.fn()}
        saving={false}
      />,
    )
    expect(screen.getByText('3 palpites')).toBeInTheDocument()
  })
})

describe('BracketSlotCard – saving state', () => {
  it('applies the saving modifier class when saving=true', () => {
    const { container } = render(
      <BracketSlotCard
        slot={slot()}
        position={1}
        round="LAST_32"
        availableTeams={cascadeAvailable}
        points={1}
        onPick={vi.fn()}
        saving
      />,
    )
    expect(container.querySelector('.slotCardSaving')).not.toBeNull()
  })
})
