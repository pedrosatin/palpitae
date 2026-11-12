import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { StrictMode } from 'react'
import { captureGuideOrigin, getGuideOrigin } from './analytics/guideOrigin'
import { getSignupOrigin } from './analytics/signupOrigin'
import * as ga from './analytics/ga'
import { config } from './config'
import { SESSION_EXPIRED_EVENT } from './lib/api'
import { fetchCachedJson, invalidateApiCache } from './lib/api-cache'
import { draftStorageKey } from './lib/predictionDraftStorage'

vi.mock('./analytics/ga', () => ({ trackEvent: vi.fn(), trackPageView: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

/** Mostra a URL atual, para conferir redirecionamentos client-side. */
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname + location.search}</span>
}

// Mock page components
vi.mock('./pages/LandingPage', () => ({
  default: () => <div data-testid="landing-page">LandingPage</div>,
}))
vi.mock('./pages/LoginPage', () => ({
  default: () => <div data-testid="login-page">LoginPage</div>,
}))
vi.mock('./pages/InvitePage', () => ({
  default: () => <div data-testid="invite-page">InvitePage</div>,
}))
vi.mock('./pages/DashboardPage', () => ({
  default: ({ onLogout }: { onLogout: () => void }) => (
    <div data-testid="dashboard-page">
      DashboardPage
      <button onClick={onLogout} data-testid="logout-button">
        Logout
      </button>
    </div>
  ),
}))
vi.mock('./pages/GroupDetailPage', () => ({
  default: () => <div data-testid="group-detail-page">GroupDetailPage</div>,
}))
vi.mock('./pages/SettingsPage', () => ({
  default: ({ onLogoutAll }: { onLogoutAll: () => void }) => (
    <div data-testid="settings-page">
      SettingsPage
      <button onClick={onLogoutAll}>Logout everywhere</button>
    </div>
  ),
}))
vi.mock('./pages/AdminMetricsPage', () => ({
  default: () => <div data-testid="admin-metrics-page">AdminMetricsPage</div>,
}))

describe('App', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    localStorage.clear()
    sessionStorage.clear()
    invalidateApiCache()
    mockTrackEvent.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('records guide arrival once before redirecting an already authenticated visitor', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: '1', email: 'a@b.com' } }),
    })
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/entrar?from=guia_planilha-de-bolao']}>
          <App />
        </MemoryRouter>
      </StrictMode>,
    )
    await screen.findByTestId('dashboard-page')
    expect(mockTrackEvent.mock.calls.filter(([name]) => name === 'entrar_origem')).toEqual([
      ['entrar_origem', { origem: 'guia_planilha-de-bolao' }],
    ])
    expect(getGuideOrigin()).toBe('guia_planilha-de-bolao')
    fetchMock.mockReset()
  })

  it('leva quem já tem sessão de /entrar ao painel com a mesma query', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: '1', email: 'a@b.com' } }),
    })
    const query = '?from=guia_bolao-do-brasileirao&competicao=campeonato-brasileiro-serie-a-2027'
    render(
      <MemoryRouter initialEntries={[`/entrar${query}`]}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    )
    await screen.findByTestId('dashboard-page')
    expect(screen.getByTestId('location')).toHaveTextContent(`/${query}`)
    expect(getGuideOrigin()).toBe('guia_bolao-do-brasileirao')
  })

  it.each([
    ['back_forward', '/?from=guia_bolao-do-brasileirao'],
    ['navigate', '/?from=guia_bolao-do-brasileirao&competicao=campeonato-brasileiro-serie-a-2027'],
  ])('com sessão, a carga %s de /entrar leva ao painel em %s', async (type, expected) => {
    // jsdom não expõe a Navigation Timing API; a propriedade própria some no fim.
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      writable: true,
      value: (kind: string) => (kind === 'navigation' ? [{ type }] : []),
    })
    try {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { id: '1', email: 'a@b.com' } }),
      })
      render(
        <MemoryRouter
          initialEntries={[
            '/entrar?from=guia_bolao-do-brasileirao&competicao=campeonato-brasileiro-serie-a-2027',
          ]}
        >
          <App />
          <LocationProbe />
        </MemoryRouter>,
      )
      await screen.findByTestId('dashboard-page')
      expect(screen.getByTestId('location').textContent).toBe(expected)
    } finally {
      delete (performance as { getEntriesByType?: unknown }).getEntriesByType
    }
  })

  it('leva quem já tem sessão de outra rota desconhecida ao painel sem a query', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: '1', email: 'a@b.com' } }),
    })
    render(
      <MemoryRouter initialEntries={['/qualquer?competicao=campeonato-brasileiro-serie-a-2027']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    )
    await screen.findByTestId('dashboard-page')
    expect(screen.getByTestId('location').textContent).toBe('/')
  })

  it('attributes OAuth completion without recording another arrival', async () => {
    captureGuideOrigin('?from=guia_planilha-de-bolao')
    sessionStorage.setItem('palpitae:login-pendente', 'google')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: '1', email: 'a@b.com' } }),
    })
    render(
      <MemoryRouter initialEntries={['/?from=guia_planilha-de-bolao']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByTestId('dashboard-page')
    expect(mockTrackEvent.mock.calls).toEqual([
      ['login', { method: 'google', origem: 'guia_planilha-de-bolao' }],
    ])
  })

  it('records guide arrival for an anonymous visitor', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: false }) })
    render(
      <MemoryRouter initialEntries={['/entrar?from=guias_header']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByTestId('login-page')
    expect(mockTrackEvent).toHaveBeenCalledWith('entrar_origem', { origem: 'guias_header' })
  })

  it('guarda a chegada da aba uma vez, sem depender da sessão', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ authenticated: false }) })
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      </StrictMode>,
    )
    await screen.findByTestId('landing-page')
    expect(getSignupOrigin()).toBe('direto')
  })

  it('marca a aba como convite ao abrir /convite/:code', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: false }) })
    render(
      <MemoryRouter initialEntries={['/convite/ABCD-EF23']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByTestId('invite-page')
    expect(getSignupOrigin()).toBe('convite')
  })

  it('mostra a página de convite ao visitante em /convite/:code', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ authenticated: false }),
    })

    render(
      <MemoryRouter initialEntries={['/convite/ABCD-EF23']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    )

    await screen.findByTestId('invite-page')
    expect(screen.getByTestId('location')).toHaveTextContent('/convite/ABCD-EF23')
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument()
  })

  it('pinta a página de convite antes de o /auth/me responder', async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}))

    render(
      <MemoryRouter initialEntries={['/convite/ABCD-EF23']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByTestId('invite-page')
  })

  it('leva o visitante de /?convite=CODE para a página de convite', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ authenticated: false }),
    })

    render(
      <MemoryRouter initialEntries={['/?convite=ABCD-EF23']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    )

    await screen.findByTestId('invite-page')
    expect(screen.getByTestId('location')).toHaveTextContent('/convite/ABCD-EF23')
  })

  it('mantém a landing para o visitante em / sem convite', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ authenticated: false }),
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByTestId('landing-page')
  })

  it('sends a logged-in user on /convite/:code to the dashboard with ?convite=CODE', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: '1', email: 'test@example.com' } }),
    })

    render(
      <MemoryRouter initialEntries={['/convite/ABCD-EF23']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    })
    expect(screen.getByTestId('location')).toHaveTextContent('/?convite=ABCD-EF23')
  })

  it('tracks login once when returning from the Google sign-in with a session', async () => {
    sessionStorage.setItem('palpitae:login-pendente', 'google')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: '1', email: 'test@example.com' } }),
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith('login', { method: 'google' })
    })
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('palpitae:login-pendente')).toBeNull()
  })

  it('does not track login for a session restored without a sign-in click', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: '1', email: 'test@example.com' } }),
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    })
    expect(mockTrackEvent).not.toHaveBeenCalledWith('login', expect.anything())
  })

  it('clears the pending login without tracking when the sign-in failed', async () => {
    sessionStorage.setItem('palpitae:login-pendente', 'google')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ authenticated: false }),
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeInTheDocument()
    })
    expect(mockTrackEvent).not.toHaveBeenCalledWith('login', expect.anything())
    expect(sessionStorage.getItem('palpitae:login-pendente')).toBeNull()
  })

  it('renders nothing on private routes while authentication state is loading', () => {
    // Make fetch return a promise that doesn't resolve immediately
    fetchMock.mockImplementation(() => new Promise(() => {}))

    const { container } = render(
      <MemoryRouter initialEntries={['/configuracoes']}>
        <App />
      </MemoryRouter>,
    )

    // Ensure the container is empty (returns null)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the pre-rendered landing at "/" while auth loads', () => {
    // LCP: a landing já está pintada no HTML do build e não depende da sessão,
    // então o primeiro render precisa reproduzi-la — senão a hidratação diverge.
    fetchMock.mockImplementation(() => new Promise(() => {}))

    render(
      <MemoryRouter initialEntries={['/']}>
        <App landingPrerenderizada />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('landing-page')).toBeInTheDocument()
  })

  it('waits for auth at "/" when the pre-rendered landing was discarded', () => {
    // Quem já logou aqui vai para o dashboard: o script inline do index.html
    // descarta a landing, o App recebe false e não pisca a página de marketing.
    fetchMock.mockImplementation(() => new Promise(() => {}))

    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('handles localStorage errors gracefully when setting known session', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: '1', email: 'a@b.com' } }),
    })

    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('Storage is restricted')
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    })

    Storage.prototype.setItem = originalSetItem
  })

  it('records and clears the known-session flag from the /auth/me result', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: '1', email: 'a@b.com' } }),
    })

    const { unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(localStorage.getItem('palpitae:sessao-conhecida')).toBe('1')
    })

    unmount()
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: false }) })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(localStorage.getItem('palpitae:sessao-conhecida')).toBeNull()
    })
  })

  it('falls back to unauthenticated route when /auth/me is not ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    // Wait for the LandingPage mock to render
    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledWith(`${config.apiUrl}/auth/me`, { credentials: 'include' })
  })

  it('mantém a rota e oferece nova tentativa quando /auth/me responde 503', async () => {
    localStorage.setItem('palpitae:sessao-conhecida', '1')
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: '1', email: 'a@b.com' } }),
    })

    render(
      <MemoryRouter initialEntries={['/grupos/g1']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/indisponível no momento/)).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/grupos/g1')
    expect(localStorage.getItem('palpitae:sessao-conhecida')).toBe('1')

    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    expect(await screen.findByTestId('group-detail-page')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/grupos/g1')
  })

  it.each([
    ['/', 'landing-page'],
    ['/convite/ABC123', 'invite-page'],
  ])(
    'mantém %s no ar para quem não tem sessão conhecida quando /auth/me responde 503',
    async (path, page) => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })

      render(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>,
      )

      expect(await screen.findByTestId(page)).toBeInTheDocument()
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      // Dá tempo de a resposta 503 chegar ao estado antes de conferir que o aviso não entrou.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(screen.getByTestId(page)).toBeInTheDocument()
      expect(screen.queryByText(/indisponível no momento/)).not.toBeInTheDocument()
    },
  )

  it('mostra a indisponibilidade em / para quem tem sessão conhecida', async () => {
    localStorage.setItem('palpitae:sessao-conhecida', '1')
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/indisponível no momento/)).toBeInTheDocument()
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument()
  })

  it('mantém o aviso e o foco no botão quando a nova tentativa também responde 503', async () => {
    let answerRetry: (res: unknown) => void = () => {}
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockReturnValueOnce(new Promise((resolve) => (answerRetry = resolve)))

    render(
      <MemoryRouter initialEntries={['/grupos/g1']}>
        <App />
      </MemoryRouter>,
    )

    const button = await screen.findByRole('button', { name: 'Tentar novamente' })
    await userEvent.click(button)

    // Durante a consulta o aviso continua montado, com o mesmo botão ocupado.
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    answerRetry({ ok: false, status: 503 })

    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'false'))
    expect(button).toBeInTheDocument()
    expect(button).toHaveFocus()
    expect(button).toHaveTextContent('Tentar novamente')
  })

  it('leva ao login quando /auth/me responde 401', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 })

    render(
      <MemoryRouter initialEntries={['/grupos/g1']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
    expect(screen.queryByText(/indisponível no momento/)).not.toBeInTheDocument()
  })

  it('falls back to unauthenticated route when /auth/me rejects with a network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network request failed'))

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeInTheDocument()
    })
  })

  it('falls back to unauthenticated route when /auth/me returns 200 with authenticated: false', async () => {
    // Visita anônima: o endpoint responde 200 (não 401) para não aparecer como
    // erro no console do navegador — ver PAGESPEED_REPORT.md item 3.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ authenticated: false }),
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeInTheDocument()
    })
  })

  it('renders authenticated route when /auth/me returns user data', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: '1', email: 'test@example.com' } }),
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    })
  })

  it('responds to SESSION_EXPIRED_EVENT by clearing state and falling back to unauthenticated routes', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: '1', email: 'test@example.com' } }),
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    })

    // Dispatch the custom event
    await waitFor(() => {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    })

    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument()
  })

  it.each(['logout', 'logout-all', 'expired'])(
    'discards cached groups after %s',
    async (reason) => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { id: '1', email: 'test@example.com' } }),
      })
      fetchMock.mockResolvedValueOnce({ ok: true })
      render(
        <MemoryRouter initialEntries={[reason === 'logout-all' ? '/configuracoes' : '/']}>
          <App />
        </MemoryRouter>,
      )
      await screen.findByTestId(reason === 'logout-all' ? 'settings-page' : 'dashboard-page')
      await fetchCachedJson('groups:list', async () => ({ groups: ['old-account-group'] }))

      if (reason === 'expired') {
        await waitFor(() => window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)))
      } else {
        await userEvent
          .setup({ delay: null })
          .click(
            reason === 'logout-all'
              ? screen.getByText('Logout everywhere')
              : screen.getByTestId('logout-button'),
          )
      }
      await screen.findByTestId(reason === 'logout-all' ? 'login-page' : 'landing-page')
      const nextAccount = await fetchCachedJson('groups:list', async () => ({ groups: [] }))
      expect(nextAccount.groups).toEqual([])
    },
  )

  it.each([
    { reason: 'logout', effect: 'apaga', kept: false },
    { reason: 'logout-all', effect: 'apaga', kept: false },
    { reason: 'expired', effect: 'mantém', kept: true },
  ])('$reason $effect os rascunhos de palpite', async ({ reason, kept }) => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: '1', email: 'test@example.com' } }),
    })
    fetchMock.mockResolvedValueOnce({ ok: true })
    const drafts = [draftStorageKey('1', 'g1'), draftStorageKey('outro', 'g2')]
    for (const key of drafts) localStorage.setItem(key, '{}')
    localStorage.setItem('palpitae:analytics-consent', 'granted')
    render(
      <MemoryRouter initialEntries={[reason === 'logout-all' ? '/configuracoes' : '/']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByTestId(reason === 'logout-all' ? 'settings-page' : 'dashboard-page')

    if (reason === 'expired') {
      await waitFor(() => window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)))
    } else {
      await userEvent
        .setup({ delay: null })
        .click(
          reason === 'logout-all'
            ? screen.getByText('Logout everywhere')
            : screen.getByTestId('logout-button'),
        )
    }
    await screen.findByTestId(reason === 'logout-all' ? 'login-page' : 'landing-page')

    for (const key of drafts) expect(localStorage.getItem(key) !== null).toBe(kept)
    expect(localStorage.getItem('palpitae:analytics-consent')).toBe('granted')
  })

  it('um novo login descarta o aviso de expiração da sessão anterior', async () => {
    // A sessão anterior expirou em "/", onde a landing não consome o aviso.
    sessionStorage.setItem('palpitae:session-expired', '1')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: '1', email: 'test@example.com' } }),
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByTestId('dashboard-page')
    expect(sessionStorage.getItem('palpitae:session-expired')).toBeNull()
  })

  it('sair com sucesso não deixa aviso de expiração para a tela de login', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: '1', email: 'test@example.com' } }),
    })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    )
    await screen.findByTestId('dashboard-page')
    // Um 401 de outra requisição chegou durante a saída.
    sessionStorage.setItem('palpitae:session-expired', '1')
    await userEvent.setup({ delay: null }).click(screen.getByTestId('logout-button'))

    await screen.findByTestId('landing-page')
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    expect(sessionStorage.getItem('palpitae:session-expired')).toBeNull()
    expect(sessionStorage.getItem('palpitae:logout-unconfirmed')).toBeNull()
  })

  it.each([
    ['responde 503', () => fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })],
    ['não responde', () => fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))],
  ])(
    'quando o logout %s, sai deste navegador e leva ao login com o aviso',
    async (_caso, answerLogout) => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { id: '1', email: 'test@example.com' } }),
      })
      answerLogout()
      const drafts = [draftStorageKey('1', 'g1')]
      for (const key of drafts) localStorage.setItem(key, '{}')

      render(
        <MemoryRouter initialEntries={['/']}>
          <App />
          <LocationProbe />
        </MemoryRouter>,
      )
      await screen.findByTestId('dashboard-page')
      await userEvent.setup({ delay: null }).click(screen.getByTestId('logout-button'))

      expect(await screen.findByTestId('login-page')).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent('/entrar')
      expect(sessionStorage.getItem('palpitae:logout-unconfirmed')).toBe('1')
      expect(sessionStorage.getItem('palpitae:session-expired')).toBeNull()
      for (const key of drafts) expect(localStorage.getItem(key)).toBeNull()
    },
  )

  it('handles logout and falls back to unauthenticated routes', async () => {
    captureGuideOrigin('?from=guia_planilha-de-bolao')
    const user = userEvent.setup({ delay: null })

    // First, authenticate
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: '1', email: 'test@example.com' } }),
    })

    // Setup fetch mock for logout call
    fetchMock.mockResolvedValueOnce({ ok: true })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    })

    // Trigger logout
    const logoutButton = screen.getByTestId('logout-button')
    await user.click(logoutButton)

    // Check if logout API was called
    expect(fetchMock).toHaveBeenCalledWith(`${config.apiUrl}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    })

    // Wait for the state to transition back to unauthenticated
    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument()
    expect(getGuideOrigin()).toBeUndefined()
    expect(getSignupOrigin()).toBeUndefined()
  })
})
