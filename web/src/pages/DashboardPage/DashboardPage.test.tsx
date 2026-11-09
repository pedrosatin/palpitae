import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import * as ga from '../../analytics/ga'
import { config } from '../../config'
import { invalidateApiCache } from '../../lib/api-cache'
import { markInviteAccepted } from '../../lib/invite'
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

function mockGroupsResponse(groups: unknown[], matched_invite_group_id: string | null = null) {
  return mockResponse({ groups, matched_invite_group_id })
}

function mockCompetitionsResponse(competitions: unknown[]) {
  return mockResponse({ competitions })
}

function mockGroupCreatedResponse(group: unknown) {
  return mockResponse({ group })
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

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockGroupsResponse([]))

    render(
      <MemoryRouter initialEntries={['/?convite=inv123']}>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('/api/groups?invite_code=INV123')
  })

  it('opens the group with replace when the convite belongs to a group the user already joined', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockGroupsResponse(
        [
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
        'g1',
      ),
    )

    function GroupRoute() {
      const location = useLocation()
      const navigationType = useNavigationType()
      return <p>{`grupo ${location.pathname} ${navigationType}`}</p>
    }

    render(
      <MemoryRouter initialEntries={['/?convite=INV123']}>
        <Routes>
          <Route path="/" element={<DashboardPage user={user} onLogout={vi.fn()} />} />
          <Route path="/grupos/:id" element={<GroupRoute />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('grupo /grupos/g1 REPLACE')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the success screen after creation and closes on "Pronto"', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockGroupsResponse([]))
      .mockResolvedValueOnce(
        mockCompetitionsResponse([
          {
            id: 'c1',
            name: 'Copa 2026',
            slug: 'copa-2026',
            season: '2026',
            status: 'upcoming',
          },
        ]),
      )
      .mockResolvedValueOnce(
        mockGroupCreatedResponse({
          id: 'g1',
          name: 'Os Craques',
          invite_code: 'INV123',
        }),
      )
      .mockResolvedValueOnce(mockGroupsResponse([]))

    render(
      <MemoryRouter>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Nenhum grupo ainda')).toBeInTheDocument()
    })

    await userEvent.click(screen.getAllByRole('button', { name: 'Criar grupo' })[0])

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Os Craques')
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar grupo' }))

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

describe('DashboardPage na volta do login com convite', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    invalidateApiCache()
    Object.assign(config as { apiUrl: string; authUrl: string }, {
      apiUrl: 'http://localhost:8787',
      authUrl: 'http://localhost:8787',
    })
  })

  function GroupRoute() {
    const location = useLocation()
    const navigationType = useNavigationType()
    const state = location.state as { joinedGroupName?: string } | null
    return <p>{`grupo ${location.pathname} ${navigationType} ${state?.joinedGroupName}`}</p>
  }

  function renderDashboard(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<DashboardPage user={user} onLogout={vi.fn()} />} />
          <Route path="/grupos/:id" element={<GroupRoute />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  function joinCalls(fetchSpy: { mock: { calls: unknown[][] } }) {
    return fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/groups/join'))
  }

  it('entra no grupo sem toque e abre a aba padrão com a confirmação', async () => {
    markInviteAccepted('ABCD-EF23')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockGroupsResponse([]))
      .mockResolvedValueOnce(mockResponse({ group: { id: 'g9', name: 'Realidade do BR' } }))

    renderDashboard('/?convite=ABCD-EF23')

    expect(await screen.findByText('grupo /grupos/g9 REPLACE Realidade do BR')).toBeInTheDocument()
    const calls = joinCalls(fetchSpy)
    expect(calls).toHaveLength(1)
    expect(JSON.parse(String((calls[0][1] as RequestInit).body))).toEqual({
      invite_code: 'ABCD-EF23',
      entry_method: 'convite_link',
    })
    expect(sessionStorage.getItem('palpitae:convite-aceito')).toBeNull()
  })

  it('pede confirmação quando o link chega sem a marca da aba', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockGroupsResponse([]))

    renderDashboard('/?convite=ABCD-EF23')

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('ABCD-EF23')
    expect(joinCalls(fetchSpy)).toHaveLength(0)
  })

  it('pede confirmação quando a marca é de outro convite', async () => {
    markInviteAccepted('WXYZ-2345')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockGroupsResponse([]))

    renderDashboard('/?convite=ABCD-EF23')

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(joinCalls(fetchSpy)).toHaveLength(0)
  })

  it('mantém o modal com o erro quando a entrada automática falha', async () => {
    markInviteAccepted('ABCD-EF23')
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockGroupsResponse([]))
      .mockResolvedValueOnce(mockResponse({ error: 'Código de convite inválido' }, false))

    renderDashboard('/?convite=ABCD-EF23')

    expect(await screen.findByText('Código de convite inválido')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('abre o grupo sem nova entrada quando a pessoa já é membro', async () => {
    markInviteAccepted('ABCD-EF23')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockGroupsResponse([], 'g1'))

    renderDashboard('/?convite=ABCD-EF23')

    expect(await screen.findByText('grupo /grupos/g1 REPLACE undefined')).toBeInTheDocument()
    expect(joinCalls(fetchSpy)).toHaveLength(0)
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockGroupsResponse([]))
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockGroupsResponse([]))
    render(
      <MemoryRouter>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByText('Nenhum grupo ainda'))
    await userEvent.click(
      within(screen.getByRole('main')).getByRole('button', {
        name: 'Criar grupo',
      }),
    )
    expect(mockTrackEvent).toHaveBeenCalledWith('click_dashboard_criar_grupo_empty')
  })

  it('splits ongoing and finished groups into separate sections', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockGroupsResponse([
        {
          id: 'g1',
          name: 'Bolão Ativo',
          competition_id: 'c1',
          competition_status: 'ongoing',
          invite_code: 'INV001',
          is_admin: false,
          created_at: '2026-06-01T00:00:00Z',
          member_count: 5,
          user_position: 2,
          user_points: 10,
        },
        {
          id: 'g2',
          name: 'Bolão Copa',
          competition_id: 'c2',
          competition_status: 'finished',
          invite_code: 'INV002',
          is_admin: false,
          created_at: '2026-01-01T00:00:00Z',
          member_count: 8,
          user_position: 1,
          user_points: 152,
          podium: [{ position: 1, display: 'Você', points: 152, is_you: true }],
        },
      ]),
    )
    render(
      <MemoryRouter>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByText('Em andamento'))
    expect(screen.getByText('Encerrados')).toBeInTheDocument()
    expect(screen.getByText('Bolão Ativo')).toBeInTheDocument()
    expect(screen.getByText('Bolão Copa')).toBeInTheDocument()
  })

  it('fires click_dashboard_encerrados_toggle when the finished section is collapsed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockGroupsResponse([
        {
          id: 'g2',
          name: 'Bolão Copa',
          competition_id: 'c2',
          competition_status: 'finished',
          invite_code: 'INV002',
          is_admin: false,
          created_at: '2026-01-01T00:00:00Z',
          member_count: 8,
          user_position: 1,
          user_points: 152,
          podium: [{ position: 1, display: 'Você', points: 152, is_you: true }],
        },
      ]),
    )
    render(
      <MemoryRouter>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByText('Encerrados'))
    await userEvent.click(screen.getByRole('button', { name: /Encerrados/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_dashboard_encerrados_toggle', {
      open: false,
    })
  })

  it('fires click_dashboard_grupo without the group id when a group card is clicked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockGroupsResponse([
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
      ]),
    )
    render(
      <MemoryRouter>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByText('Os Craques'))
    await userEvent.click(screen.getByText('Os Craques'))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_dashboard_grupo')
  })
})

describe('DashboardPage, próximo prazo e ordem por urgência', () => {
  const deadline = {
    match_id: 'm-r21',
    start_time: '2026-11-14T21:30:00Z',
    round: '21',
    round_label: 'Rodada 21',
    home_team: 'Chapecoense',
    away_team: 'Vasco',
  }

  function ongoingGroup(id: string, name: string, fields: Record<string, unknown> = {}) {
    return {
      id,
      name,
      competition_id: 'bsa',
      competition_name: 'Brasileirão Série A',
      competition_status: 'ongoing',
      is_admin: false,
      created_at: '2026-01-01T00:00:00Z',
      member_count: 6,
      user_position: 1,
      user_points: 99,
      pending_predictions: 0,
      next_deadline: null,
      next_match_at: null,
      current_round_label: null,
      round_ends_at: null,
      live_matches: 0,
      ...fields,
    }
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
    // Quinta, 12/11/2026, 12:00 em Brasília.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T15:00:00Z'))
    Object.assign(config as { apiUrl: string; authUrl: string }, {
      apiUrl: 'http://localhost:8787',
      authUrl: 'http://localhost:8787',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('abre com o grupo mais urgente no topo e a faixa levando à rodada do jogo', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockGroupsResponse([
        ongoingGroup('champions', 'Champions', {
          current_round_label: 'Fase de pontos',
          next_match_at: '2026-11-12T20:00:00Z',
          round_ends_at: '2026-11-26T20:00:00Z',
        }),
        ongoingGroup('borracharia', 'Borracharia', {
          pending_predictions: 2,
          next_deadline: { ...deadline, match_id: 'm-r35', start_time: '2026-11-18T22:00:00Z', round: '35', round_label: 'Rodada 35' },
          next_match_at: '2026-11-14T21:30:00Z',
        }),
        ongoingGroup('copa', 'Copa BR', { live_matches: 1, next_match_at: '2026-11-19T22:00:00Z' }),
        ongoingGroup('realidade', 'Realidade do BR', {
          pending_predictions: 10,
          next_deadline: deadline,
          next_match_at: deadline.start_time,
        }),
        {
          ...ongoingGroup('satin', 'Grupo do Satin'),
          competition_status: 'finished',
          podium: [{ position: 1, display: 'Ana', points: 92, is_you: false }],
        },
      ]),
    )

    render(
      <MemoryRouter>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )

    const banner = await screen.findByRole('region', { name: 'Próximo prazo' })
    // O status de todos os grupos vem no mesmo GET /groups.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(within(banner).getByText('Chapecoense × Vasco fecha sáb, 14/11 às 18:30')).toBeInTheDocument()
    expect(within(banner).getByText('Rodada 21 · 12 sem palpite em 2 grupos')).toBeInTheDocument()
    const action = within(banner).getByRole('link', { name: 'Palpitar em Realidade do BR' })
    expect(action).toHaveAttribute('href', '/grupos/realidade?rodada=21')

    const ongoingSection = screen.getByRole('heading', { name: 'Em andamento' }).closest('section')!
    expect(
      within(ongoingSection)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Realidade do BR', 'Borracharia', 'Copa BR', 'Champions'])
    expect(within(ongoingSection).getByText('10 sem palpite · fecha sáb 18:30')).toBeInTheDocument()
    expect(within(ongoingSection).getByText('1 jogo ao vivo')).toBeInTheDocument()
    expect(
      within(ongoingSection).getByText('Fase de pontos completa ✓ · próximo jogo hoje 17:00'),
    ).toBeInTheDocument()
    expect(screen.getByText('Grupo do Satin')).toBeInTheDocument()

    await userEvent.click(action)
    expect(mockTrackEvent).toHaveBeenCalledWith('click_dashboard_proximo_prazo')
  })

  it('diz que a rodada está toda palpitada quando não há pendência', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockGroupsResponse([
        ongoingGroup('a', 'Bolão A', {
          current_round_label: 'Rodada 35',
          next_match_at: '2026-11-14T21:30:00Z',
          round_ends_at: '2026-11-20T00:30:00Z',
        }),
        ongoingGroup('b', 'Bolão B'),
      ]),
    )

    render(
      <MemoryRouter>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )

    const banner = await screen.findByRole('region', { name: 'Próximo prazo' })
    expect(banner).toHaveTextContent('Rodada 35 toda palpitada')
    expect(banner).not.toHaveTextContent(/até/)
    expect(within(banner).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Rodada 35 completa ✓ · próximo jogo sáb 18:30')).toBeInTheDocument()
    expect(screen.getByText('Sem jogos marcados')).toBeInTheDocument()
  })

  it('não mostra a faixa sem grupo em andamento', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockGroupsResponse([
        {
          ...ongoingGroup('satin', 'Grupo do Satin'),
          competition_status: 'finished',
          podium: [{ position: 1, display: 'Ana', points: 92, is_you: false }],
        },
      ]),
    )

    render(
      <MemoryRouter>
        <DashboardPage user={user} onLogout={vi.fn()} />
      </MemoryRouter>,
    )

    await screen.findByText('Grupo do Satin')
    expect(screen.queryByRole('region', { name: 'Próximo prazo' })).not.toBeInTheDocument()
  })
})
