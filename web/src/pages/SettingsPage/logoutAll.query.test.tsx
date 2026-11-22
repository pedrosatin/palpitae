import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config'
import { groupsListQueryKey } from '../../lib/groupsList'
import { createTestQueryClient, renderWithQuery } from '../../test-utils'
import SettingsPage from './SettingsPage'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))

const user = { id: 'u1', email: 'user@example.com' }

describe('logout de todos os dispositivos e QueryClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.assign(config as { apiUrl: string; authUrl: string }, {
      apiUrl: 'http://localhost:8787',
      authUrl: 'http://localhost:8787',
    })
  })

  it('limpa o QueryClient ao concluir o logout de todos', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(groupsListQueryKey('u1'), {
      groups: [{ id: 'g1' }],
      matched_invite_group_id: null,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/notifications/preferences') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ round_reminders: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/auth/logout-all') && init?.method === 'POST') {
        return new Response('{}', { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })

    const onLogoutAll = vi.fn()
    const clearSpy = vi.spyOn(queryClient, 'clear')
    renderWithQuery(
      <MemoryRouter>
        <SettingsPage user={user} onLogout={vi.fn()} onLogoutAll={onLogoutAll} />
      </MemoryRouter>,
      { queryClient },
    )

    const runner = userEvent.setup()
    await screen.findByRole('checkbox')
    await runner.click(screen.getByRole('button', { name: 'Sair de todos' }))
    await screen.findByRole('dialog')
    const buttons = screen.getAllByRole('button', { name: 'Sair de todos' })
    await runner.click(buttons[buttons.length - 1])

    await waitFor(() => expect(onLogoutAll).toHaveBeenCalled())
    expect(clearSpy).toHaveBeenCalled()
    expect(queryClient.getQueryData(groupsListQueryKey('u1'))).toBeUndefined()
  })
})
