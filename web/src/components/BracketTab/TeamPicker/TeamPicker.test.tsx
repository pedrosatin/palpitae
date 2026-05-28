import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TeamPicker from './TeamPicker'
import type { AvailableTeamsResult, Team } from '../types'

// ─── Fixtures ──────────────────────────────────────────────────────────────

function team(id: string, name = id, short = id): Team {
  return { id, name, short_name: short, logo_url: null }
}

const teamsA: Team[] = [team('BRA', 'Brasil'), team('ARG', 'Argentina')]
const teamsB: Team[] = [team('FRA', 'França'), team('GER', 'Alemanha')]

// ─── Locked state ──────────────────────────────────────────────────────────

describe('TeamPicker – locked', () => {
  it('shows the picked team and a lock icon, no interactive controls', () => {
    const available: AvailableTeamsResult = { kind: 'cascade', teams: teamsA }
    render(<TeamPicker available={available} currentPick="BRA" onPick={vi.fn()} locked />)

    expect(screen.getByText('BRA')).toBeInTheDocument()
    expect(screen.getByText('🔒')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows a dash when locked with no pick', () => {
    const available: AvailableTeamsResult = { kind: 'cascade', teams: teamsA }
    render(<TeamPicker available={available} currentPick={null} onPick={vi.fn()} locked />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

// ─── Waiting state ─────────────────────────────────────────────────────────

describe('TeamPicker – waiting', () => {
  it('shows the waiting message when previous round has no picks', () => {
    render(
      <TeamPicker
        available={{ kind: 'waiting' }}
        currentPick={null}
        onPick={vi.fn()}
        locked={false}
      />,
    )
    expect(screen.getByText(/rodada anterior/i)).toBeInTheDocument()
  })
})

// ─── Duel mode (match / cascade) ───────────────────────────────────────────

describe('TeamPicker – duel buttons', () => {
  it('renders one button per team and calls onPick with the chosen team id', async () => {
    const onPick = vi.fn()
    const available: AvailableTeamsResult = { kind: 'cascade', teams: teamsA }
    render(<TeamPicker available={available} currentPick={null} onPick={onPick} locked={false} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'BRA' }))
    expect(onPick).toHaveBeenCalledWith('BRA')
  })

  it('marks the active button when its team matches currentPick', () => {
    const available: AvailableTeamsResult = { kind: 'cascade', teams: teamsA }
    render(<TeamPicker available={available} currentPick="ARG" onPick={vi.fn()} locked={false} />)

    const argBtn = screen.getByRole('button', { name: 'ARG' })
    expect(argBtn.className).toContain('pickerDuelBtnActive')
  })
})

// ─── Dropdown mode (LAST_32 all teams grouped) ─────────────────────────────

describe('TeamPicker – grouped dropdown', () => {
  function makeGrouped(): AvailableTeamsResult {
    return {
      kind: 'all',
      grouped: new Map([
        ['A', teamsA],
        ['B', teamsB],
      ]),
    }
  }

  it('renders a placeholder and opens the menu on click', async () => {
    render(
      <TeamPicker
        available={makeGrouped()}
        currentPick={null}
        onPick={vi.fn()}
        locked={false}
      />,
    )
    expect(screen.getByText(/Escolher time/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByPlaceholderText(/Buscar time/i)).toBeInTheDocument()
    expect(screen.getByText('Grupo A')).toBeInTheDocument()
    expect(screen.getByText('Grupo B')).toBeInTheDocument()
  })

  it('filters teams when typing in the search input', async () => {
    render(
      <TeamPicker
        available={makeGrouped()}
        currentPick={null}
        onPick={vi.fn()}
        locked={false}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    await userEvent.type(screen.getByPlaceholderText(/Buscar time/i), 'fra')

    expect(screen.queryByText('Grupo A')).toBeNull()
    expect(screen.getByText('França')).toBeInTheDocument()
    expect(screen.queryByText('Brasil')).toBeNull()
  })

  it('shows "Nenhum time encontrado" when the search has no matches', async () => {
    render(
      <TeamPicker
        available={makeGrouped()}
        currentPick={null}
        onPick={vi.fn()}
        locked={false}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    await userEvent.type(screen.getByPlaceholderText(/Buscar time/i), 'xyzzz')

    expect(screen.getByText(/Nenhum time encontrado/i)).toBeInTheDocument()
  })

  it('calls onPick and closes the menu when an option is chosen', async () => {
    const onPick = vi.fn()
    render(
      <TeamPicker
        available={makeGrouped()}
        currentPick={null}
        onPick={onPick}
        locked={false}
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    await userEvent.click(screen.getByRole('button', { name: /BRABrasil/i }))

    expect(onPick).toHaveBeenCalledWith('BRA')
    expect(screen.queryByPlaceholderText(/Buscar time/i)).toBeNull()
  })

  it('opens the menu upward when there is little space below the trigger', async () => {
    // Make getBoundingClientRect report a trigger near the bottom of the viewport
    const origInnerHeight = window.innerHeight
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 })
    const origRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        top: 480, bottom: 500, left: 0, right: 100, width: 100, height: 20, x: 0, y: 480,
        toJSON: () => ({}),
      } as DOMRect
    }

    render(
      <TeamPicker
        available={makeGrouped()}
        currentPick={null}
        onPick={vi.fn()}
        locked={false}
      />,
    )
    await userEvent.click(screen.getByRole('button'))

    const menu = document.querySelector('.pickerMenu')!
    expect(menu.className).toContain('pickerMenuUp')

    HTMLElement.prototype.getBoundingClientRect = origRect
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: origInnerHeight })
  })

  it('anchors the menu to the right when the trigger is near the right edge', async () => {
    const origInnerWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
    const origRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function () {
      // left=300 → spaceRight = 100 < 200 (menuMinWidth) → alignRight
      return {
        top: 50, bottom: 80, left: 300, right: 380, width: 80, height: 30, x: 300, y: 50,
        toJSON: () => ({}),
      } as DOMRect
    }

    render(
      <TeamPicker
        available={makeGrouped()}
        currentPick={null}
        onPick={vi.fn()}
        locked={false}
      />,
    )
    await userEvent.click(screen.getByRole('button'))

    const menu = document.querySelector('.pickerMenu')!
    expect(menu.className).toContain('pickerMenuRight')

    HTMLElement.prototype.getBoundingClientRect = origRect
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: origInnerWidth })
  })
})
