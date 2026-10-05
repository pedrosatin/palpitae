import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import * as ga from '../../analytics/ga'
import LandingPage from './LandingPage'
import { LANDING_GUIDE_LINKS } from './guideLinks'

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

describe('LandingPage – âncoras do nav', () => {
  // Um #hash do nav sem a seção correspondente deixa o link "morto": foi o que
  // aconteceu quando a seção de pontuação saiu junto com o chaveamento.
  it('renders a section for every in-page nav anchor', () => {
    const { container } = renderPage()
    const hashes = [...container.querySelectorAll('a[href^="#"]')].map((a) =>
      (a.getAttribute('href') as string).slice(1),
    )
    expect(hashes.length).toBeGreaterThan(0)
    for (const hash of hashes) {
      expect(container.querySelector(`#${hash}`), `sem seção para #${hash}`).not.toBeNull()
    }
  })
})

describe('LandingPage – links para os guias', () => {
  beforeEach(() => mockTrackEvent.mockClear())

  it('links each featured guide with its search-term anchor, plus the /guias/ index', () => {
    renderPage()
    const section = screen.getByRole('region', { name: 'Guias para montar seu bolão' })
    for (const g of LANDING_GUIDE_LINKS) {
      const link = within(section).getByRole('link', { name: g.label })
      expect(link).toHaveAttribute('href', `/guias/${g.slug}/`)
    }
    expect(within(section).getByRole('link', { name: /todos os guias/i })).toHaveAttribute(
      'href',
      '/guias/',
    )
    expect(LANDING_GUIDE_LINKS.map((g) => g.label)).toEqual(
      expect.arrayContaining(['Bolão do Brasileirão', 'Bolão online grátis']),
    )
  })

  it('fires click_landing_guia with the guide slug', async () => {
    renderPage()
    const [first] = LANDING_GUIDE_LINKS
    const link = screen.getByRole('link', { name: first.label })
    // jsdom não navega; impede o aviso de navegação não implementada.
    link.addEventListener('click', (e) => e.preventDefault())
    await userEvent.click(link)
    expect(mockTrackEvent).toHaveBeenCalledWith('click_landing_guia', { guia: first.slug })
  })
})
