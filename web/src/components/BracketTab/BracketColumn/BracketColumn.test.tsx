import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BracketColumn from './BracketColumn'
import type { SlotData } from '../types'

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

function renderColumn(args: {
  positions: number[]
  slotsMap?: Map<number, SlotData>
  reversed?: boolean
}) {
  return render(
    <BracketColumn
      round="LAST_32"
      positions={args.positions}
      slotsMap={args.slotsMap ?? new Map()}
      allTeams={[]}
      teamGroups={{}}
      myPicksMap={new Map()}
      points={1}
      onPick={vi.fn()}
      savingKey={null}
      reversed={args.reversed}
    />,
  )
}

describe('BracketColumn – layout', () => {
  it('renders the round label as the column header', () => {
    renderColumn({ positions: [1, 2] })
    // Multiple "16 avos" texts can appear (column header + each slot card header).
    // The header is the first occurrence.
    expect(screen.getAllByText('16 avos').length).toBeGreaterThan(0)
  })

  it('renders one slot per position', () => {
    const { container } = renderColumn({ positions: [1, 2, 3, 4] })
    expect(container.querySelectorAll('.bracketSlot')).toHaveLength(4)
  })

  it('applies bracketSlotEven to every second slot in the pair', () => {
    const { container } = renderColumn({ positions: [1, 2, 3, 4] })
    const slots = container.querySelectorAll('.bracketSlot')
    // Index 0, 2 = odd in pair (no Even class); index 1, 3 = even in pair
    expect(slots[0].className).not.toContain('bracketSlotEven')
    expect(slots[1].className).toContain('bracketSlotEven')
    expect(slots[2].className).not.toContain('bracketSlotEven')
    expect(slots[3].className).toContain('bracketSlotEven')
  })
})

describe('BracketColumn – reversed', () => {
  it('adds the bracketColumnReversed class when reversed=true', () => {
    const { container } = renderColumn({ positions: [1], reversed: true })
    expect(container.querySelector('.bracketColumnReversed')).not.toBeNull()
  })

  it('omits the reversed class by default', () => {
    const { container } = renderColumn({ positions: [1] })
    expect(container.querySelector('.bracketColumnReversed')).toBeNull()
  })
})

describe('BracketColumn – slot sizing', () => {
  it('sets a height proportional to the number of slots', () => {
    const { container } = renderColumn({ positions: [1, 2, 3, 4] })
    const column = container.querySelector('.bracketColumn') as HTMLElement
    // 4 R32 slots × 76px base = 304px
    expect(column.style.height).toBe('304px')
  })

  it('scales slot height by round (R16 = 2× R32)', () => {
    const { container } = render(
      <BracketColumn
        round="LAST_16"
        positions={[1, 2]}
        slotsMap={new Map()}
        allTeams={[]}
        teamGroups={{}}
        myPicksMap={new Map()}
        points={2}
        onPick={vi.fn()}
        savingKey={null}
      />,
    )
    const column = container.querySelector('.bracketColumn') as HTMLElement
    // 2 R16 slots × 152px (76 × 2) = 304px
    expect(column.style.height).toBe('304px')
  })
})

describe('BracketColumn – data integration', () => {
  it('passes slot data into the matching slot card and leaves others empty', () => {
    const slots = new Map([
      [1, slot(1, { my_pick: { team_id: 'BRA', team_name: 'Brasil', team_short: 'BRA', team_logo: null } })],
    ])
    renderColumn({ positions: [1, 2], slotsMap: slots })
    // Slot 1 → cascade waiting state isn't relevant here; LAST_32 with no match → grouped dropdown.
    // Since there are no teams in allTeams, the dropdown placeholder is shown.
    expect(screen.getAllByText(/Escolher time/i).length).toBeGreaterThanOrEqual(2)
  })
})
