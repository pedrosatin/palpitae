import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import * as ga from '../../analytics/ga'
import { config } from '../../config'
import DashboardPage from './DashboardPage'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

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

    Object.assign(config as { apiUrl: string; authUrl: string }, {
      apiUrl: 'http://localhost:8787',
      authUrl: 'http://localhost:8787',
    })
  })

  it('loads groups when the API base is a relative proxy path', async () => {
    Object.assign(config as { apiUrl: string; authUrl: string }, {
      apiUrl: '/api',
      authUrl: '/api',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({
        groups: [],
        matched_invite_group_id: null,
      }),
    )

    render(
      <MemoryRouter initialEntries={['/?convite=inv123']}>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/groups?invite_code=INV123',
    )
  })

  it('does not open the join modal from convite query when the user already belongs to that group', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({
        groups: [
          {
            id: 'g1',
            name: 'Os Craques',
            competition_id: 'c1',
            invite_code: 'INV123',
            is_admin: false,
            created_at: '2026-06-14T00:00:00.000Z',
            member_count: 8,
            user_position: 2,
            user_points: 15,
          },
        ],
        matched_invite_group_id: 'g1',
      }),
    )

    render(
      <MemoryRouter initialEntries={['/?convite=INV123']}>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Seus grupos')).toBeInTheDocument()
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the success screen after creation and closes on "Pronto"', async () => {
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

    // Modal fica aberto na tela de sucesso (código de convite compartilhável).
    await waitFor(() => {
      expect(screen.getByText('Grupo criado!')).toBeInTheDocument()
    })
    expect(screen.getByText('INV123')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(4) // grupos, competições, create, refetch

    await userEvent.click(screen.getByRole('button', { name: 'Pronto' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})

describe('DashboardPage – analytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
    Object.assign(config as { apiUrl: string; authUrl: string }, {
      apiUrl: 'http://localhost:8787',
      authUrl: 'http://localhost:8787',
    })
  })

  it('fires click_dashboard_entrar_convite_empty when Entrar com convite is clicked in empty state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ groups: [], matched_invite_group_id: null }),
    )
    render(
      <MemoryRouter>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByText('Nenhum grupo ainda'))
    await userEvent.click(screen.getByRole('button', { name: 'Entrar com convite' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_dashboard_entrar_convite_empty')
  })

  it('fires click_dashboard_criar_grupo_empty when Criar grupo is clicked in empty state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ groups: [], matched_invite_group_id: null }),
    )
    render(
      <MemoryRouter>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByText('Nenhum grupo ainda'))
    await userEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Criar grupo' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_dashboard_criar_grupo_empty')
  })

  it('fires click_dashboard_grupo with group_id when a group card is clicked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({
        groups: [
          {
            id: 'g1',
            name: 'Os Craques',
            competition_id: 'c1',
            invite_code: 'INV123',
            is_admin: false,
            created_at: '2026-01-01T00:00:00Z',
            member_count: 5,
            user_position: 2,
            user_points: 10,
            exact_hits: 1,
          },
        ],
        matched_invite_group_id: null,
      }),
    )
    render(
      <MemoryRouter>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByText('Os Craques'))
    await userEvent.click(screen.getByText('Os Craques'))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_dashboard_grupo', { group_id: 'g1' })
  })
})
