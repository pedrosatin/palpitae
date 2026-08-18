import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { config } from './config'
import { SESSION_EXPIRED_EVENT } from './lib/api'

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
      <button onClick={onLogout} data-testid="logout-button">Logout</button>
    </div>
  ),
}))
vi.mock('./pages/GroupDetailPage', () => ({
  default: () => <div data-testid="group-detail-page">GroupDetailPage</div>,
}))
vi.mock('./pages/SettingsPage', () => ({
  default: () => <div data-testid="settings-page">SettingsPage</div>,
}))
vi.mock('./pages/AdminMetricsPage', () => ({
  default: () => <div data-testid="admin-metrics-page">AdminMetricsPage</div>,
}))

describe('App', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders nothing while authentication state is loading', () => {
    // Make fetch return a promise that doesn't resolve immediately
    fetchMock.mockImplementation(() => new Promise(() => {}))

    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )

    // Ensure the container is empty (returns null)
    expect(container).toBeEmptyDOMElement()
  })

  it('falls back to unauthenticated route when /auth/me is not ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )

    // Wait for the LandingPage mock to render
    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledWith(`${config.apiUrl}/auth/me`, { credentials: 'include' })
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
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeInTheDocument()
    })
  })

  it('renders authenticated route when /auth/me returns user data', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: '1', email: 'test@example.com' } })
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    })
  })

  it('responds to SESSION_EXPIRED_EVENT by clearing state and falling back to unauthenticated routes', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: '1', email: 'test@example.com' } })
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
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

  it('handles logout and falls back to unauthenticated routes', async () => {
    const user = userEvent.setup({ delay: null })

    // First, authenticate
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: '1', email: 'test@example.com' } })
    })

    // Setup fetch mock for logout call
    fetchMock.mockResolvedValueOnce({ ok: true })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
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
  })
})
