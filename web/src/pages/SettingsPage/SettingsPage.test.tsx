import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as ga from '../../analytics/ga'
import { config } from '../../config'
import SettingsPage from './SettingsPage'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

const user = { id: 'u1', email: 'user@example.com' }

function mockResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage user={user} onLogout={vi.fn()} />
    </MemoryRouter>,
  )
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.assign(config as { apiUrl: string; authUrl: string }, {
      apiUrl: 'http://localhost:8787',
      authUrl: 'http://localhost:8787',
    })
  })

  it('loads the current preference and reflects it in the toggle', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ round_reminders: true }))

    renderPage()

    const toggle = await screen.findByRole('checkbox')
    await waitFor(() => expect(toggle).toBeChecked())
  })

  it('shows the toggle off when the user is unsubscribed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ round_reminders: false }))

    renderPage()

    const toggle = await screen.findByRole('checkbox')
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('opens a confirmation modal when the toggle is clicked and tracks the intent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ round_reminders: true }))

    renderPage()

    const toggle = await screen.findByRole('checkbox')
    await waitFor(() => expect(toggle).toBeChecked())

    await userEvent.click(toggle)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/desativar lembretes/i)).toBeInTheDocument()
    expect(mockTrackEvent).toHaveBeenCalledWith('click_settings_toggle_lembretes', {
      enabled: false,
    })
  })

  it('closes modal and tracks cancel when the user clicks Cancelar', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ round_reminders: true }))

    renderPage()

    const toggle = await screen.findByRole('checkbox')
    await waitFor(() => expect(toggle).toBeChecked())

    await userEvent.click(toggle)
    await screen.findByRole('dialog')

    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(
      fetchSpy.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'PATCH'),
    ).toHaveLength(0)
    expect(toggle).toBeChecked()
    expect(mockTrackEvent).toHaveBeenCalledWith('click_settings_cancelar_lembretes')
  })

  it('PATCHes the new preference and tracks confirm after confirmation', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ round_reminders: true })) // initial GET
      .mockResolvedValueOnce(mockResponse({ round_reminders: false })) // PATCH

    renderPage()

    const toggle = await screen.findByRole('checkbox')
    await waitFor(() => expect(toggle).toBeChecked())

    await userEvent.click(toggle)
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }))

    await waitFor(() => expect(toggle).not.toBeChecked())

    const patchCall = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PATCH')
    expect(patchCall).toBeTruthy()
    expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
      round_reminders: false,
    })
    expect(mockTrackEvent).toHaveBeenCalledWith('click_settings_confirmar_lembretes', {
      enabled: false,
    })
  })

  it('shows a success message below the section after the PATCH succeeds', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ round_reminders: true }))
      .mockResolvedValueOnce(mockResponse({ round_reminders: false }))

    renderPage()

    const toggle = await screen.findByRole('checkbox')
    await waitFor(() => expect(toggle).toBeChecked())

    await userEvent.click(toggle)
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }))

    const msg = await screen.findByText(/configuração salva/i)
    expect(msg).toBeInTheDocument()

    // success message must appear after the toggle in the DOM (no layout shift above)
    expect(toggle.compareDocumentPosition(msg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows a retry button after initial load failure and recovers on retry', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse(null, false)) // initial GET fails
      .mockResolvedValueOnce(mockResponse({ round_reminders: true })) // retry succeeds

    renderPage()

    const retryButton = await screen.findByRole('button', {
      name: /tentar novamente/i,
    })
    expect(retryButton).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeDisabled()

    await userEvent.click(retryButton)

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /tentar novamente/i })).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeDisabled())
  })

  it('rolls back the toggle when the PATCH fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ round_reminders: true })) // GET
      .mockResolvedValueOnce(mockResponse(null, false)) // PATCH fails

    renderPage()

    const toggle = await screen.findByRole('checkbox')
    await waitFor(() => expect(toggle).toBeChecked())

    await userEvent.click(toggle)
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }))

    await waitFor(() => expect(toggle).toBeChecked())
    expect(await screen.findByText(/Falha ao salvar/i)).toBeInTheDocument()
  })
})
