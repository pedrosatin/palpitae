import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import * as ga from '../../analytics/ga'
import LandingPage from './LandingPage'
import { LANDING_GUIDE_LINKS } from './guideLinks'
import { catalogEyebrow, catalogFaqAnswer, groupCatalog } from './competitionCatalog'

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

describe('LandingPage – campeonatos', () => {
  it('lista os campeonatos do catálogo por região, na seção e no FAQ', () => {
    renderPage()
    const section = screen.getByRole('region', { name: 'Escolha o campeonato do seu bolão' })
    for (const group of groupCatalog()) {
      expect(within(section).getByRole('heading', { name: group.label })).toBeInTheDocument()
      for (const name of group.names) {
        expect(within(section).getByText(name)).toBeInTheDocument()
      }
    }
    expect(screen.getByText(catalogFaqAnswer())).toBeInTheDocument()
    expect(screen.getByText(catalogEyebrow())).toBeInTheDocument()
  })

  it('não cita um campeonato com temporada no selo nem no FAQ', () => {
    renderPage()
    expect(screen.queryByText(/Série A 2026/)).not.toBeInTheDocument()
  })

  it('descreve a tela de palpites no texto alternativo', () => {
    renderPage()
    const shot = screen.getByAltText(/Tela de palpites de uma rodada/)
    expect(shot).toHaveAttribute('width')
    expect(shot).toHaveAttribute('height')
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
    link.addEventListener('click', (e) => e.preventDefault())
    await userEvent.click(link)
    expect(mockTrackEvent).toHaveBeenCalledWith('click_landing_guia', { guia: first.slug })
  })
})

describe('LandingPage – rodapé', () => {
  it('liga para a política de privacidade', () => {
    renderPage()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: 'Política de privacidade' })).toHaveAttribute(
      'href',
      '/privacidade',
    )
  })
})

describe('LandingPage – carregamento das capturas', () => {
  it('mantém o hero eager e a captura de palpites da seção de recursos lazy', () => {
    renderPage()
    const hero = screen.getByAltText('Tela de grupos do Palpitae mostrando os bolões do usuário')
    expect(hero).toHaveAttribute('loading', 'eager')
    expect(hero.getAttribute('fetchpriority')).toBe('high')
    const palpites = screen.getByAltText(/Tela de palpites de uma rodada/)
    expect(palpites).toHaveAttribute('loading', 'lazy')
    expect(palpites.getAttribute('fetchpriority')).toBeNull()
  })

  it('oferece a captura de palpites em 640w e 1100w, mantendo width e height', () => {
    renderPage()
    const img = screen.getByAltText(/Tela de palpites de uma rodada/)
    expect(img).toHaveAttribute('width', '1100')
    expect(img).toHaveAttribute('height', '712')
    const source = img.closest('picture')!.querySelector('source')
    expect(source?.getAttribute('srcset')).toContain('palpites-640.webp 640w')
    expect(source?.getAttribute('srcset')).toContain('palpites.webp 1100w')
    expect(source?.getAttribute('sizes')).toContain('calc(100vw - 3rem)')
  })

  it('mantém as demais capturas lazy e sem srcset responsivo', () => {
    renderPage()
    const hero = screen.getByAltText('Tela de grupos do Palpitae mostrando os bolões do usuário')
    expect(hero).toHaveAttribute('loading', 'eager')
    expect(hero.getAttribute('fetchpriority')).toBe('high')
    expect(hero.closest('picture')!.querySelector('source')?.getAttribute('srcset')).toBe(
      '/screenshots/grupos.webp',
    )
    const lista = screen.getByAltText('Lista de grupos com membros, posição e pontos')
    expect(lista).toHaveAttribute('loading', 'lazy')
    expect(lista.closest('picture')!.querySelector('source')?.getAttribute('srcset')).toBe(
      '/screenshots/grupos.webp',
    )
  })
})
