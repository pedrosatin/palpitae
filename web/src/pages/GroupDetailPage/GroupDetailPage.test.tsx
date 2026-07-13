import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as ga from '../../analytics/ga'
import GroupDetailPage from './GroupDetailPage'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

// ─── Mock heavy child components ───────────────────────────────────────────

vi.mock('../../components/PredictionsTab', () => ({
  default: ({ groupId }: { groupId: string }) => (
    <div data-testid="predictions-tab">PredictionsTab:{groupId}</div>
  ),
}))

vi.mock('../../components/Header', () => ({
  default: ({
    onCreateGroup,
    onJoinGroup,
  }: {
    onCreateGroup: () => void
    onJoinGroup: () => void
  }) => (
    <header data-testid="header">
      <button onClick={onCreateGroup}>Criar grupo</button>
      <button onClick={onJoinGroup}>Entrar em grupo</button>
    </header>
  ),
}))

vi.mock('../../components/CreateGroupModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? (
      <div role="dialog" aria-label="criar grupo">
        CreateGroupModal
      </div>
    ) : null,
}))

vi.mock('../../components/JoinGroupModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? (
      <div role="dialog" aria-label="entrar em grupo">
        JoinGroupModal
      </div>
    ) : null,
}))

vi.mock('../../components/StandingsTab', () => ({
  default: ({ competitionId }: { competitionId: string }) => (
    <div data-testid="standings-tab">StandingsTab:{competitionId}</div>
  ),
}))

vi.mock('../../components/LeaderboardTab', () => ({
  default: ({ groupId }: { groupId: string }) => (
    <div data-testid="leaderboard-tab">LeaderboardTab:{groupId}</div>
  ),
}))

vi.mock('../../components/MembersTab', () => ({
  default: ({ groupId }: { groupId: string }) => (
    <div data-testid="members-tab">MembersTab:{groupId}</div>
  ),
}))

// ─── Fixtures ──────────────────────────────────────────────────────────────

const baseUser = {
  id: 'user-1',
  email: 'user@example.com',
  feature_flags: { create_group: true },
}

const baseGroup = {
  id: 'abc',
  name: 'Grupo Teste',
  competition_id: 'comp-1',
  competition_name: 'Copa do Mundo',
  is_admin: false,
  invite_code: 'INV001',
  created_at: '2026-01-01T00:00:00Z',
  member_count: 3,
  user_position: 1,
  user_points: 10,
  exact_hits: 2,
}

function mockGroupFetch(group = baseGroup, ok = true) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    json: async () => ({ group }),
  } as Response)
}

function mockGroupFetchSequence(...responses: Array<{ ok?: boolean; body?: unknown }>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const next = responses.shift()
    if (!next) {
      throw new Error('Unexpected fetch call')
    }

    return {
      ok: next.ok ?? true,
      json: async () => next.body,
    } as Response
  })
}

// ─── Render helper ─────────────────────────────────────────────────────────

function renderPage(path = '/groups/abc', routePattern = '/groups/:groupId') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={routePattern}
          element={<GroupDetailPage user={baseUser} onLogout={vi.fn()} />}
        />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('GroupDetailPage – routing & fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches the group detail for the groupId from the URL', async () => {
    const fetchSpy = mockGroupFetch() as unknown
    void fetchSpy
    const spy = vi.spyOn(globalThis, 'fetch')
    mockGroupFetch()

    renderPage('/groups/abc')

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('/groups/abc'),
        expect.objectContaining({ credentials: 'include' }),
      )
    })
  })

  it('redirects to "/" when groupId is not present in the route', () => {
    // Render on a route that does NOT capture :groupId
    render(
      <MemoryRouter initialEntries={['/groups/']}>
        <Routes>
          {/* This route has no :groupId param */}
          <Route
            path="/groups/"
            element={<GroupDetailPage user={baseUser} onLogout={vi.fn()} />}
          />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>,
    )

    // Component renders <Navigate to="/" replace /> → should show Home
    expect(screen.getByText('Home')).toBeInTheDocument()
  })
})

describe('GroupDetailPage – tabs', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the Predictions tab content by default', async () => {
    mockGroupFetch()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('predictions-tab')).toBeInTheDocument()
    })
  })

  it('keeps the tabs bar configured as a sticky secondary header', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(72)
    mockGroupFetch()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('predictions-tab')).toBeInTheDocument()
    })

    const tabs = screen.getByTestId('group-tabs')
    expect(tabs).toHaveStyle('--tabs-offset: 72px')
  })

  it('switches to Ranking tab when that button is clicked', async () => {
    mockGroupFetch()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('predictions-tab')).toBeInTheDocument()
    })

    await userEvent.click(
      screen.getByRole('link', { name: /Ranking/i }),
    )

    expect(screen.queryByTestId('predictions-tab')).not.toBeInTheDocument()
    expect(screen.getByTestId('leaderboard-tab')).toBeInTheDocument()
  })

  it('switches back to Palpitar tab when that button is clicked', async () => {
    mockGroupFetch()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('predictions-tab')).toBeInTheDocument()
    })

    await userEvent.click(
      screen.getByRole('link', { name: /Ranking/i }),
    )
    await userEvent.click(screen.getByRole('link', { name: /Palpitar/i }))

    expect(screen.getByTestId('predictions-tab')).toBeInTheDocument()
  })
})

describe('GroupDetailPage – Header modals', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the create group modal when the Header emits onCreateGroup', async () => {
    mockGroupFetch()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('header')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: 'Criar grupo' }))

    expect(
      screen.getByRole('dialog', { name: /criar grupo/i }),
    ).toBeInTheDocument()
  })

  it('opens the join group modal when the Header emits onJoinGroup', async () => {
    mockGroupFetch()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('header')).toBeInTheDocument()
    })

    await userEvent.click(
      screen.getByRole('button', { name: 'Entrar em grupo' }),
    )

    expect(
      screen.getByRole('dialog', { name: /entrar em grupo/i }),
    ).toBeInTheDocument()
  })
})

describe('GroupDetailPage – leave group', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes the leave action via the group options menu for non-admin members', async () => {
    mockGroupFetch()

    renderPage()

    // The leave action lives inside the kebab menu and is hidden until opened.
    expect(
      screen.queryByRole('menuitem', { name: /sair do grupo/i }),
    ).not.toBeInTheDocument()

    await userEvent.click(
      await screen.findByRole('button', { name: /opções do grupo/i }),
    )

    expect(
      screen.getByRole('menuitem', { name: /sair do grupo/i }),
    ).toBeInTheDocument()
  })

  it('shows edit/delete actions (not leave) in the options menu for admins', async () => {
    mockGroupFetch({ ...baseGroup, is_admin: true })

    renderPage()

    await userEvent.click(
      await screen.findByRole('button', { name: /opções do grupo/i }),
    )

    expect(
      screen.getByRole('menuitem', { name: /editar nome/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: /excluir grupo/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: /sair do grupo/i }),
    ).not.toBeInTheDocument()
  })

  it('removes the current user from the group after confirmation', async () => {
    mockGroupFetchSequence(
      { body: { group: baseGroup } },
      { body: { success: true } },
    )

    renderPage()

    await userEvent.click(
      await screen.findByRole('button', { name: /opções do grupo/i }),
    )
    await userEvent.click(
      screen.getByRole('menuitem', { name: /sair do grupo/i }),
    )

    // Confirmation dialog appears instead of window.confirm.
    expect(
      await screen.findByText('Tem certeza que deseja sair deste grupo?'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }))

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument()
    })
  })
})

describe('GroupDetailPage – admin: rename & delete', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renames the group via the edit modal', async () => {
    mockGroupFetchSequence(
      { body: { group: { ...baseGroup, is_admin: true } } },
      { body: { group: { id: baseGroup.id, name: 'Novo Nome' } } },
    )

    renderPage()

    await userEvent.click(
      await screen.findByRole('button', { name: /opções do grupo/i }),
    )
    await userEvent.click(screen.getByRole('menuitem', { name: /editar nome/i }))

    const input = screen.getByPlaceholderText('Nome do grupo')
    await userEvent.clear(input)
    await userEvent.type(input, 'Novo Nome')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Novo Nome' }),
      ).toBeInTheDocument()
    })
  })

  it('soft-deletes the group after confirmation', async () => {
    mockGroupFetchSequence(
      { body: { group: { ...baseGroup, is_admin: true } } },
      { body: { success: true } },
    )

    renderPage()

    await userEvent.click(
      await screen.findByRole('button', { name: /opções do grupo/i }),
    )
    await userEvent.click(
      screen.getByRole('menuitem', { name: /excluir grupo/i }),
    )

    expect(
      await screen.findByText(/deixará de aparecer para todos os membros/i),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument()
    })
  })
})

describe('GroupDetailPage – analytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  it('fires click_group_detail_tab with the tab name when a tab button is clicked', async () => {
    mockGroupFetch()
    renderPage()
    await waitFor(() => screen.getByTestId('predictions-tab'))
    await userEvent.click(screen.getByRole('link', { name: /Ranking/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_detail_tab', { tab: 'leaderboard' })
  })

  it('fires click_group_detail_menu_sair when Sair do grupo is clicked', async () => {
    mockGroupFetch()
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /opções do grupo/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /sair do grupo/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_detail_menu_sair')
  })

  it('fires click_group_detail_menu_editar_nome when Editar nome is clicked', async () => {
    mockGroupFetch({ ...baseGroup, is_admin: true })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /opções do grupo/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /editar nome/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_detail_menu_editar_nome')
  })

  it('fires click_group_detail_menu_excluir when Excluir grupo is clicked', async () => {
    mockGroupFetch({ ...baseGroup, is_admin: true })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /opções do grupo/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /excluir grupo/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_detail_menu_excluir')
  })

  it('fires click_group_detail_copiar_codigo when the copy code button is clicked', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    mockGroupFetch({ ...baseGroup, is_admin: true })
    renderPage()
    const copyBtn = await screen.findByRole('button', { name: /^Copiar$/ })
    await userEvent.click(copyBtn)
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_detail_copiar_codigo')
  })

  it('fires click_group_detail_copiar_link when the copy link button is clicked', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    mockGroupFetch({ ...baseGroup, is_admin: true })
    renderPage()
    const copyLinkBtn = await screen.findByRole('button', { name: /Copiar link/ })
    await userEvent.click(copyLinkBtn)
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_detail_copiar_link')
  })

  it('fires submit_renomear_grupo when the rename succeeds', async () => {
    mockGroupFetchSequence(
      { body: { group: { ...baseGroup, is_admin: true } } },
      { body: { group: { id: baseGroup.id, name: 'Novo Nome' } } },
    )
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /opções do grupo/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /editar nome/i }))

    const input = screen.getByPlaceholderText('Nome do grupo')
    await userEvent.clear(input)
    await userEvent.type(input, 'Novo Nome')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith('submit_renomear_grupo')
    })
  })
})

describe('GroupDetailPage – standings tab gate (competition_type)', () => {
  it('shows the Tabela tab for league competitions', async () => {
    mockGroupFetch({ ...baseGroup, competition_type: 'league' })
    renderPage()
    expect(await screen.findByRole('link', { name: /Tabela/i })).toBeInTheDocument()
  })

  it('renders StandingsTab when Tabela is clicked in a league group', async () => {
    mockGroupFetch({ ...baseGroup, competition_type: 'league' })
    renderPage()
    await userEvent.click(await screen.findByRole('link', { name: /Tabela/i }))
    expect(screen.getByTestId('standings-tab')).toHaveTextContent('StandingsTab:comp-1')
  })

  it('hides the Tabela tab for cup competitions', async () => {
    mockGroupFetch({ ...baseGroup, competition_type: 'cup' })
    renderPage()
    await screen.findByRole('link', { name: /Ranking/i })
    expect(screen.queryByRole('link', { name: /Tabela/i })).not.toBeInTheDocument()
  })

  it('falls back to the default tab when ?tab=standings is forced on a cup group', async () => {
    mockGroupFetch({ ...baseGroup, competition_type: 'cup' })
    renderPage('/groups/abc?tab=standings')
    await screen.findByRole('link', { name: /Ranking/i })
    expect(screen.queryByTestId('standings-tab')).not.toBeInTheDocument()
    // painel default (Palpitar) ativo no lugar de um painel vazio
    expect(screen.getByRole('link', { name: /Palpitar/i })).toHaveClass(/tabActive/i)
  })
})
