import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import RoundHeader from './RoundHeader'

describe('RoundHeader', () => {
  const defaultProps = {
    roundKeys: ['1', '2', '3'],
    safeIndex: 1,
    selectedRound: '2',
    labelFor: (r: string) => `Rodada ${r}`,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onSelect: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders correctly', () => {
    render(<RoundHeader {...defaultProps} />)

    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rodada anterior' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Próxima rodada' })).toBeInTheDocument()
  })

  it('calls onPrev when previous button is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RoundHeader {...defaultProps} />)

    const prevButton = screen.getByRole('button', { name: 'Rodada anterior' })
    await user.click(prevButton)

    expect(defaultProps.onPrev).toHaveBeenCalledOnce()
  })

  it('calls onNext when next button is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RoundHeader {...defaultProps} />)

    const nextButton = screen.getByRole('button', { name: 'Próxima rodada' })
    await user.click(nextButton)

    expect(defaultProps.onNext).toHaveBeenCalledOnce()
  })

  it('calls onSelect when a round is selected', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RoundHeader {...defaultProps} />)

    const select = screen.getByRole('combobox')
    await user.selectOptions(select, '3')

    expect(defaultProps.onSelect).toHaveBeenCalledWith('3')
  })

  it('disables previous button when safeIndex is 0', () => {
    render(<RoundHeader {...defaultProps} safeIndex={0} />)

    const prevButton = screen.getByRole('button', { name: 'Rodada anterior' })
    expect(prevButton).toBeDisabled()
  })

  it('disables next button when safeIndex is at the end', () => {
    render(<RoundHeader {...defaultProps} safeIndex={2} />)

    const nextButton = screen.getByRole('button', { name: 'Próxima rodada' })
    expect(nextButton).toBeDisabled()
  })

  it('renders without optgroups when only group stage rounds are provided', () => {
    render(<RoundHeader {...defaultProps} />)

    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Rodada 1' })).toBeInTheDocument()
  })

  it('keeps group-stage rounds ungrouped and groups knockout rounds', () => {
    const props = {
      ...defaultProps,
      roundKeys: ['1', '2', 'round_of_16', 'quarter_finals'],
      knockoutRounds: new Set(['round_of_16', 'quarter_finals']),
    }
    render(<RoundHeader {...props} />)

    expect(screen.getByRole('option', { name: 'Rodada 1' }).closest('optgroup')).toBeNull()

    const knockoutOptgroup = screen.getByRole('group', { name: 'Mata-mata' })
    expect(knockoutOptgroup).toBeInTheDocument()
  })

  it('renders only knockout optgroup when only knockout rounds are provided', () => {
    const props = {
      ...defaultProps,
      roundKeys: ['round_of_16', 'quarter_finals'],
      knockoutRounds: new Set(['round_of_16', 'quarter_finals']),
    }
    render(<RoundHeader {...props} />)

    expect(screen.queryByRole('group', { name: 'Fase de grupos' })).not.toBeInTheDocument()

    const knockoutOptgroup = screen.getByRole('group', { name: 'Mata-mata' })
    expect(knockoutOptgroup).toBeInTheDocument()
  })

  it('preserva a ordem das preliminares e só agrupa fases eliminatórias', () => {
    const keys = ['FIRST_STAGE', 'GROUP_STAGE', 'REGULAR_SEASON', 'TACA_GUANABARA', 'LAST_16']
    render(
      <RoundHeader
        roundKeys={keys}
        safeIndex={1}
        selectedRound="GROUP_STAGE"
        labelFor={(r) => r}
        onPrev={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        knockoutRounds={new Set(['FIRST_STAGE', 'LAST_16'])}
      />,
    )
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(keys)
    for (const key of keys.slice(1, 4)) {
      expect(screen.getByRole('option', { name: key }).closest('optgroup')).toBeNull()
    }
    expect(screen.getAllByRole('group', { name: 'Mata-mata' })).toHaveLength(2)
  })
})

describe('RoundHeader – rodada com jogo adiado', () => {
  const baseProps = {
    roundKeys: ['21', '22', '23'],
    safeIndex: 1,
    selectedRound: '22',
    labelFor: (r: string) => `Rodada ${r}`,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onSelect: vi.fn(),
  }

  it('marca a opção da rodada adiada com a contagem', () => {
    render(<RoundHeader {...baseProps} postponedByRound={new Map([['21', 4]])} />)

    expect(screen.getByRole('option', { name: 'Rodada 21 · 4 adiados' })).toBeInTheDocument()
    // As demais ficam intactas.
    expect(screen.getByRole('option', { name: 'Rodada 22' })).toBeInTheDocument()
  })

  it('usa singular quando é um jogo só', () => {
    render(<RoundHeader {...baseProps} postponedByRound={new Map([['21', 1]])} />)

    expect(screen.getByRole('option', { name: 'Rodada 21 · 1 adiado' })).toBeInTheDocument()
  })

  it('sem a prop, nenhum rótulo é alterado', () => {
    render(<RoundHeader {...baseProps} />)

    expect(screen.getByRole('option', { name: 'Rodada 21' })).toBeInTheDocument()
    expect(screen.queryByText(/adiado/i)).not.toBeInTheDocument()
  })
})

describe('RoundHeader – rodada com rascunho não salvo', () => {
  const baseProps = {
    roundKeys: ['21', '35', '36'],
    safeIndex: 1,
    selectedRound: '35',
    labelFor: (r: string) => `Rodada ${r}`,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onSelect: vi.fn(),
  }

  it('marca a rodada com rascunho e junta o marcador ao de remarcado', () => {
    render(
      <RoundHeader
        {...baseProps}
        rescheduledByRound={new Map([['21', 1]])}
        unsavedRounds={new Set(['21', '36'])}
      />,
    )

    expect(
      screen.getByRole('option', { name: 'Rodada 21 · 1 remarcado, não salvo' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Rodada 35' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Rodada 36 · não salvo' })).toBeInTheDocument()
  })
})
