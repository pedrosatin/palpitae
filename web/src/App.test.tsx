import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { StrictMode } from 'react'
import { captureGuideOrigin, getGuideOrigin } from './analytics/guideOrigin'
import * as ga from './analytics/ga'
import { config } from './config'
import { SESSION_EXPIRED_EVENT } from './lib/api'
import { fetchCachedJson, invalidateApiCache } from './lib/api-cache'

vi.mock('./analytics/ga', () => ({ trackEvent: vi.fn() }))
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

  it('sends a visitor on /convite/:code to the landing with ?convite=CODE', async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeInTheDocument()
    })
    expect(screen.getByTestId('location')).toHaveTextContent('/?convite=ABCD-EF23')
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
  })
})
