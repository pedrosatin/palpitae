import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ScoringRulesField from './ScoringRulesField'
import * as ga from '../../../analytics/ga'
import { PRESET_VALUES } from '../constants'

vi.mock('../../../analytics/ga', () => ({ trackEvent: vi.fn() }))

describe('ScoringRulesField', () => {
  const mockTrackEvent = vi.mocked(ga.trackEvent)
  const defaultProps = {
    scoringPreset: 'classic' as const,
    setScoringPreset: vi.fn(),
    pointsExact: 3,
    setPointsExact: vi.fn(),
    pointsWinner: 1,
    setPointsWinner: vi.fn(),
    pointsPenalty: 1,
    setPointsPenalty: vi.fn(),
    showPenaltyField: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders presets correctly', () => {
    render(<ScoringRulesField {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Clássico' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Só placar exato' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Só vencedor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Personalizado' })).toBeInTheDocument()
  })

  it('calls setScoringPreset and trackEvent when clicking a preset', async () => {
    const user = userEvent.setup({ delay: null })
    render(<ScoringRulesField {...defaultProps} />)
    const exactOnlyBtn = screen.getByRole('button', { name: 'Só placar exato' })

    await user.click(exactOnlyBtn)

    expect(mockTrackEvent).toHaveBeenCalledWith('click_create_group_preset_selecionado', {
      preset: 'exact_only',
    })
    expect(defaultProps.setScoringPreset).toHaveBeenCalledWith('exact_only')
    expect(defaultProps.setPointsExact).toHaveBeenCalledWith(PRESET_VALUES.exact_only.exact)
    expect(defaultProps.setPointsWinner).toHaveBeenCalledWith(PRESET_VALUES.exact_only.winner)
    expect(defaultProps.setPointsPenalty).toHaveBeenCalledWith(PRESET_VALUES.exact_only.penalty)
  })

  it('does not auto-update points when custom preset is selected', async () => {
    const user = userEvent.setup({ delay: null })
    render(<ScoringRulesField {...defaultProps} scoringPreset="exact_only" />)
    const customBtn = screen.getByRole('button', { name: 'Personalizado' })

    await user.click(customBtn)

    expect(defaultProps.setScoringPreset).toHaveBeenCalledWith('custom')
    expect(defaultProps.setPointsExact).not.toHaveBeenCalled()
    expect(defaultProps.setPointsWinner).not.toHaveBeenCalled()
    expect(defaultProps.setPointsPenalty).not.toHaveBeenCalled()
  })

  it('enables inputs and allows changes only in custom mode', async () => {
    const user = userEvent.setup({ delay: null })
    const { rerender } = render(<ScoringRulesField {...defaultProps} scoringPreset="classic" showPenaltyField={true} />)

    let exactInput = screen.getByRole('spinbutton', { name: /placar exato/i })
    expect(exactInput).toBeDisabled()

    rerender(<ScoringRulesField {...defaultProps} scoringPreset="custom" showPenaltyField={true} />)

    exactInput = screen.getByRole('spinbutton', { name: /placar exato/i })
    expect(exactInput).not.toBeDisabled()

    await user.clear(exactInput)
    await user.type(exactInput, '5')

    expect(defaultProps.setPointsExact).toHaveBeenCalledWith(10)
  })

  it('renders penalty field when showPenaltyField is true', () => {
    const { rerender } = render(<ScoringRulesField {...defaultProps} showPenaltyField={false} />)
    expect(screen.queryByRole('spinbutton', { name: /bônus pênalti/i })).not.toBeInTheDocument()

    rerender(<ScoringRulesField {...defaultProps} showPenaltyField={true} />)
    expect(screen.getByRole('spinbutton', { name: /bônus pênalti/i })).toBeInTheDocument()
  })
})
