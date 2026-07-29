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

  it('renders with optgroups when both group stage and knockout rounds are provided', () => {
    const props = {
      ...defaultProps,
      roundKeys: ['1', '2', 'round_of_16', 'quarter_finals'],
    }
    render(<RoundHeader {...props} />)

    const groupStageOptgroup = screen.getByRole('group', { name: 'Fase de grupos' })
    expect(groupStageOptgroup).toBeInTheDocument()

    const knockoutOptgroup = screen.getByRole('group', { name: 'Mata-mata' })
    expect(knockoutOptgroup).toBeInTheDocument()
  })

  it('renders only knockout optgroup when only knockout rounds are provided', () => {
    const props = {
      ...defaultProps,
      roundKeys: ['round_of_16', 'quarter_finals'],
    }
    render(<RoundHeader {...props} />)

    expect(screen.queryByRole('group', { name: 'Fase de grupos' })).not.toBeInTheDocument()

    const knockoutOptgroup = screen.getByRole('group', { name: 'Mata-mata' })
    expect(knockoutOptgroup).toBeInTheDocument()
  })
})
