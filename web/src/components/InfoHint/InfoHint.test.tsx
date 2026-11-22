import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { TOOLTIP_TIMEOUT_MS } from '../../hooks/useAutoClose'
import Modal from '../Modal'
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

  it(`closes tooltip automatically after ${TOOLTIP_TIMEOUT_MS / 1000} seconds`, () => {
    vi.useFakeTimers()
    render(<InfoHint label="Help" text="This is a tooltip" />)

    fireEvent.click(screen.getByText('Help'))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_TIMEOUT_MS)
    })

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('calls onOpen callback only when opening', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<InfoHint label="Help" text="This is a tooltip" onOpen={onOpen} />)

    await user.click(screen.getByText('Help'))
    expect(onOpen).toHaveBeenCalledTimes(1)

    await user.click(screen.getByText('Help'))
    expect(onOpen).toHaveBeenCalledTimes(1)

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

  it('liga o botão do ícone ao tooltip com aria-expanded e aria-controls', async () => {
    const user = userEvent.setup()
    render(<InfoHint label="Help" text="This is a tooltip" />)
    const icon = screen.getByRole('button', { name: 'Help', expanded: false })

    expect(icon).not.toHaveAttribute('aria-controls')

    await user.click(icon)
    expect(icon).toHaveAttribute('aria-expanded', 'true')
    expect(icon).toHaveAttribute('aria-controls', screen.getByRole('tooltip').id)
  })

  it('abre com Enter no botão focado e fecha com Escape', async () => {
    const user = userEvent.setup()
    render(<InfoHint label="Help" text="This is a tooltip" />)

    await user.tab()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('tooltip')).toHaveTextContent('This is a tooltip')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('abre com Espaço no botão focado', async () => {
    const user = userEvent.setup()
    render(<InfoHint label="Help" text="This is a tooltip" />)

    await user.tab()
    await user.keyboard(' ')
    expect(screen.getByRole('tooltip')).toHaveTextContent('This is a tooltip')
  })

  it('com o tooltip aberto, o texto vira a descrição acessível do botão', async () => {
    const user = userEvent.setup()
    render(<InfoHint label="Help" text="This is a tooltip" />)

    await user.click(screen.getByText('Help'))
    expect(screen.getByRole('button', { name: 'Help', expanded: true })).toHaveAccessibleDescription(
      'This is a tooltip',
    )
  })

  it('dentro de um modal, o primeiro Escape fecha só o tooltip e o segundo fecha o modal', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal isOpen onClose={onClose} title="Criar grupo" analyticsId="criar_grupo">
        <InfoHint label="Help" text="This is a tooltip" />
      </Modal>,
    )

    await user.click(screen.getByText('Help'))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('não abre o tooltip no hover', async () => {
    const user = userEvent.setup()
    render(<InfoHint label="Help" text="This is a tooltip" />)

    await user.hover(screen.getByRole('button', { name: 'Help', expanded: false }))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
