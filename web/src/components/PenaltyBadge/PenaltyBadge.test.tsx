import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TOOLTIP_TIMEOUT_MS } from '../../hooks/useAutoClose'
import PenaltyBadge, { BallIcon } from './PenaltyBadge'

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

  it('não abre o tooltip no hover nem no foco', () => {
    render(<PenaltyBadge team="BRA" tooltip="Brazil won" />)
    const button = screen.getByRole('button')

    fireEvent.mouseEnter(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.focus(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('abre com Enter e Espaço no botão focado', async () => {
    // userEvent trava com timers falsos; este teste não depende do fechamento automático.
    vi.useRealTimers()
    const user = userEvent.setup()
    render(<PenaltyBadge team="BRA" tooltip="Brazil won" />)

    await user.tab()
    expect(screen.getByRole('button')).toHaveFocus()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Brazil won')

    await user.keyboard(' ')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('fecha o tooltip com Escape', () => {
    render(<PenaltyBadge team="BRA" tooltip="Brazil won" />)

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('liga o botão ao tooltip com aria-expanded e aria-controls', () => {
    render(<PenaltyBadge team="BRA" tooltip="Brazil won" />)
    const button = screen.getByRole('button')

    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('aria-controls')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveAttribute('aria-controls', screen.getByRole('tooltip').id)
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

  it('com onActivate, não abre tooltip nem expõe aria-expanded', () => {
    render(<PenaltyBadge team="BRA" tooltip="Brazil won" onActivate={vi.fn()} />)
    const button = screen.getByRole('button')

    fireEvent.click(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(button).not.toHaveAttribute('aria-expanded')
  })

  it('is disabled when disabled prop is true', () => {
    render(<PenaltyBadge team="BRA" tooltip="Brazil won" disabled={true} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
