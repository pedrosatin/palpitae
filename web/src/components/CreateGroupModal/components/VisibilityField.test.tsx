import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import VisibilityField from './VisibilityField'
import * as ga from '../../../analytics/ga'

vi.mock('../../../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

describe('VisibilityField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders correctly', () => {
    render(<VisibilityField predictionsVisibility="hidden" setPredictionsVisibility={vi.fn()} />)
    expect(screen.getByText('Visibilidade dos palpites')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /oculto até palpitar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sempre visível/i })).toBeInTheDocument()
  })

  it('highlights the hidden option when active', () => {
    render(<VisibilityField predictionsVisibility="hidden" setPredictionsVisibility={vi.fn()} />)
    const hiddenBtn = screen.getByRole('button', { name: /oculto até palpitar/i })
    const publicBtn = screen.getByRole('button', { name: /sempre visível/i })

    expect(hiddenBtn).toHaveAttribute('aria-pressed', 'true')
    expect(hiddenBtn.className).toMatch(/visibilityOptionActive/)
    expect(publicBtn).toHaveAttribute('aria-pressed', 'false')
    expect(publicBtn.className).not.toMatch(/visibilityOptionActive/)
  })

  it('highlights the public option when active', () => {
    render(<VisibilityField predictionsVisibility="public" setPredictionsVisibility={vi.fn()} />)
    const hiddenBtn = screen.getByRole('button', { name: /oculto até palpitar/i })
    const publicBtn = screen.getByRole('button', { name: /sempre visível/i })

    expect(hiddenBtn).toHaveAttribute('aria-pressed', 'false')
    expect(hiddenBtn.className).not.toMatch(/visibilityOptionActive/)
    expect(publicBtn).toHaveAttribute('aria-pressed', 'true')
    expect(publicBtn.className).toMatch(/visibilityOptionActive/)
  })

  it('calls setPredictionsVisibility and trackEvent when hidden is clicked', () => {
    const setPredictionsVisibility = vi.fn()
    render(
      <VisibilityField
        predictionsVisibility="public"
        setPredictionsVisibility={setPredictionsVisibility}
      />,
    )

    const hiddenBtn = screen.getByRole('button', { name: /oculto até palpitar/i })
    fireEvent.click(hiddenBtn)

    expect(setPredictionsVisibility).toHaveBeenCalledWith('hidden')
    expect(ga.trackEvent).toHaveBeenCalledWith('click_create_group_visibilidade_oculta')
  })

  it('calls setPredictionsVisibility and trackEvent when public is clicked', () => {
    const setPredictionsVisibility = vi.fn()
    render(
      <VisibilityField
        predictionsVisibility="hidden"
        setPredictionsVisibility={setPredictionsVisibility}
      />,
    )

    const publicBtn = screen.getByRole('button', { name: /sempre visível/i })
    fireEvent.click(publicBtn)

    expect(setPredictionsVisibility).toHaveBeenCalledWith('public')
    expect(ga.trackEvent).toHaveBeenCalledWith('click_create_group_visibilidade_publica')
  })
})
