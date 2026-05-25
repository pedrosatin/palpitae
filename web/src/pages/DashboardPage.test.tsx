import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'

const user = {
  id: 'u1',
  email: 'user@example.com',
  feature_flags: {
    create_group: true,
  },
}

function mockResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('closes the create group modal after a successful creation', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ groups: [] }))
      .mockResolvedValueOnce(
        mockResponse({
          competitions: [
            {
              id: 'c1',
              name: 'Copa 2026',
              slug: 'copa-2026',
              season: '2026',
              status: 'upcoming',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          group: {
            id: 'g1',
            name: 'Os Craques',
            invite_code: 'INV123',
          },
        }),
      )
      .mockResolvedValueOnce(mockResponse({ groups: [] }))

    render(
      <MemoryRouter>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Nenhum grupo ainda')).toBeInTheDocument()
    })

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Criar grupo' })[0],
    )

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Os Craques')
    const dialog = screen.getByRole('dialog')
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Criar grupo' }),
    )

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })
})
