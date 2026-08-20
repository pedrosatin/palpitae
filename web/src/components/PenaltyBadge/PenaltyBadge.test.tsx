import { render, screen, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PenaltyBadge, { BallIcon, TOOLTIP_TIMEOUT_MS } from './PenaltyBadge'

describe('BallIcon', () => {
  it('renders the ball icon', () => {
    render(<BallIcon />)
    expect(screen.getByText('⚽')).toBeInTheDocument()
    expect(screen.getByText('⚽')).toHaveAttribute('aria-hidden', 'true')
  })

  it('applies className when provided', () => {
    render(<BallIcon className="custom-class" />)
    const icon = screen.getByText('⚽')
    expect(icon).toHaveClass('custom-class')
  })
})

describe('PenaltyBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the team name and icon', () => {
    render(<PenaltyBadge team="BRA" tooltip="Brazil won" />)
    expect(screen.getByRole('button', { name: 'Pênaltis: BRA. Brazil won' })).toBeInTheDocument()
    expect(screen.getByText('BRA')).toBeInTheDocument()
    expect(screen.getByText('⚽')).toBeInTheDocument()
  })

  it('shows tooltip on hover and hides on unhover', () => {
    render(<PenaltyBadge team="BRA" tooltip="Brazil won" />)

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.mouseEnter(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Brazil won')

    fireEvent.mouseLeave(screen.getByRole('button'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows tooltip on focus and hides on blur', () => {
    render(<PenaltyBadge team="BRA" tooltip="Brazil won" />)

    fireEvent.focus(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.blur(screen.getByRole('button')) // blur
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('toggles tooltip on click', () => {
    render(<PenaltyBadge team="BRA" tooltip="Brazil won" />)
    const button = screen.getByRole('button')

    // We use fireEvent to simulate touch/click without hover side effects
    fireEvent.click(button)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.click(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it(`auto-dismisses tooltip after ${TOOLTIP_TIMEOUT_MS}ms`, () => {
    render(<PenaltyBadge team="BRA" tooltip="Brazil won" />)
    const button = screen.getByRole('button')

    fireEvent.click(button)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_TIMEOUT_MS - 1)
    })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('closes tooltip when clicking outside', () => {
    render(
      <div>
        <PenaltyBadge team="BRA" tooltip="Brazil won" />
        <div data-testid="outside">Outside</div>
      </div>,
    )

    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('calls onActivate on click instead of toggling if provided', () => {
    const onActivate = vi.fn()
    render(<PenaltyBadge team="BRA" tooltip="Brazil won" onActivate={onActivate} />)

    fireEvent.click(screen.getByRole('button'))
    expect(onActivate).toHaveBeenCalledOnce()
  })

  it('is disabled when disabled prop is true', () => {
    render(<PenaltyBadge team="BRA" tooltip="Brazil won" disabled={true} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
