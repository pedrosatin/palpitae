import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, afterEach } from 'vitest'
import InfoHint from './InfoHint'

describe('InfoHint', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders label and icon correctly', () => {
    render(<InfoHint label="Help" text="This is a tooltip" />)
    expect(screen.getByText('Help')).toBeInTheDocument()

    const buttons = screen.getAllByRole('button', { name: 'Help' })
    expect(buttons.length).toBeGreaterThan(0)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('opens tooltip on click', async () => {
    // using regular timers for standard clicks
    const user = userEvent.setup()
    render(<InfoHint label="Help" text="This is a tooltip" />)

    await user.click(screen.getByText('Help'))

    expect(screen.getByRole('tooltip')).toHaveTextContent('This is a tooltip')
  })

  it('closes tooltip on clicking outside', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <InfoHint label="Help" text="This is a tooltip" />
      </div>,
    )

    await user.click(screen.getByText('Help'))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    await user.click(screen.getByTestId('outside'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('closes tooltip automatically after 4 seconds', () => {
    vi.useFakeTimers()
    render(<InfoHint label="Help" text="This is a tooltip" />)

    // Using fireEvent instead of userEvent when using fake timers to avoid hanging
    fireEvent.click(screen.getByText('Help'))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    // Advance timers by 4000ms
    act(() => {
      vi.advanceTimersByTime(4000)
    })

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('calls onOpen callback only when opening', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<InfoHint label="Help" text="This is a tooltip" onOpen={onOpen} />)

    // Open
    await user.click(screen.getByText('Help'))
    expect(onOpen).toHaveBeenCalledTimes(1)

    // Close
    await user.click(screen.getByText('Help'))
    expect(onOpen).toHaveBeenCalledTimes(1)

    // Open again
    await user.click(screen.getByText('Help'))
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('renders label as <label> when htmlFor is provided', () => {
    render(<InfoHint label="Help" text="This is a tooltip" htmlFor="my-input" />)

    const labelEl = screen.getByText('Help')
    expect(labelEl.tagName).toBe('LABEL')
    expect(labelEl).toHaveAttribute('for', 'my-input')
  })

  it('renders label as <button> when htmlFor is not provided', () => {
    render(<InfoHint label="Help" text="This is a tooltip" />)

    const labelEl = screen.getByText('Help')
    expect(labelEl.tagName).toBe('BUTTON')
    expect(labelEl).toHaveAttribute('type', 'button')
  })

  it('toggles tooltip when label is clicked', async () => {
    const user = userEvent.setup()
    render(<InfoHint label="Help" text="This is a tooltip" />)

    await user.click(screen.getByText('Help'))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    await user.click(screen.getByText('Help'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
