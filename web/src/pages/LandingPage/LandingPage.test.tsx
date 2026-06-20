import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import * as ga from '../../analytics/ga'
import LandingPage from './LandingPage'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

function renderPage() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  )
}

describe('LandingPage – analytics', () => {
  beforeEach(() => mockTrackEvent.mockClear())

  it('fires click_nav_recursos when the Recursos nav link is clicked', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('link', { name: 'Recursos' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_nav_recursos')
  })

  it('fires click_nav_pontuacao when the Pontuação nav link is clicked', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('link', { name: 'Pontuação' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_nav_pontuacao')
  })

  it('fires click_nav_faq when the Dúvidas nav link is clicked', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('link', { name: 'Dúvidas' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_nav_faq')
  })

  it('fires click_nav_entrar when the Entrar nav CTA is clicked', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('link', { name: 'Entrar' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_nav_entrar')
  })

  it('fires click_hero_ver_como_funciona when the secondary hero link is clicked', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('link', { name: /Ver como funciona/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_hero_ver_como_funciona')
  })

  it('fires click_landing_brand when the brand logo is clicked', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('link', { name: 'Palpitae' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_landing_brand')
  })
})
