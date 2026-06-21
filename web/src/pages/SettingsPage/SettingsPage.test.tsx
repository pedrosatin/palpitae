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
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ round_reminders: true }),
    )

    renderPage()

    const toggle = await screen.findByRole('checkbox')
    await waitFor(() => expect(toggle).toBeChecked())
  })

  it('shows the toggle off when the user is unsubscribed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ round_reminders: false }),
    )

    renderPage()

    const toggle = await screen.findByRole('checkbox')
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('PATCHes the new preference and tracks the event when toggled off', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ round_reminders: true })) // initial GET
      .mockResolvedValueOnce(mockResponse({ round_reminders: false })) // PATCH

    renderPage()

    const toggle = await screen.findByRole('checkbox')
    await waitFor(() => expect(toggle).toBeChecked())

    await userEvent.click(toggle)

    await waitFor(() => expect(toggle).not.toBeChecked())

    const patchCall = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PATCH')
    expect(patchCall).toBeTruthy()
    expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
      round_reminders: false,
    })
    expect(mockTrackEvent).toHaveBeenCalledWith('click_settings_toggle_lembretes', {
      enabled: false,
    })
  })

  it('rolls back the toggle when the PATCH fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ round_reminders: true })) // GET
      .mockResolvedValueOnce(mockResponse(null, false)) // PATCH fails

    renderPage()

    const toggle = await screen.findByRole('checkbox')
    await waitFor(() => expect(toggle).toBeChecked())

    await userEvent.click(toggle)

    // optimistic off, then rolled back to on after the failed PATCH
    await waitFor(() => expect(toggle).toBeChecked())
    expect(await screen.findByText(/Falha ao salvar/i)).toBeInTheDocument()
  })
})
