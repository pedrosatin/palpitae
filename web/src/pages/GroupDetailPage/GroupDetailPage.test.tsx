import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import GroupDetailPage from './GroupDetailPage'

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

  it('switches to Classificação tab when that button is clicked', async () => {
    mockGroupFetch()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('predictions-tab')).toBeInTheDocument()
    })

    await userEvent.click(
      screen.getByRole('button', { name: /Classificação/i }),
    )

    expect(screen.queryByTestId('predictions-tab')).not.toBeInTheDocument()
    expect(screen.getByTestId('leaderboard-tab')).toBeInTheDocument()
  })

  it('switches back to Previsões tab when that button is clicked', async () => {
    mockGroupFetch()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('predictions-tab')).toBeInTheDocument()
    })

    await userEvent.click(
      screen.getByRole('button', { name: /Classificação/i }),
    )
    await userEvent.click(screen.getByRole('button', { name: /Previsões/i }))

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

  it('shows a leave button for non-admin members', async () => {
    mockGroupFetch()

    renderPage()

    expect(
      await screen.findByRole('button', { name: /sair do grupo/i }),
    ).toBeInTheDocument()
  })

  it('does not show a leave button for admins', async () => {
    mockGroupFetch({ ...baseGroup, is_admin: true })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Grupo Teste')).toBeInTheDocument()
    })

    expect(
      screen.queryByRole('button', { name: /sair do grupo/i }),
    ).not.toBeInTheDocument()
  })

  it('removes the current user from the group after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockGroupFetchSequence(
      { body: { group: baseGroup } },
      { body: { success: true } },
    )

    renderPage()

    await userEvent.click(
      await screen.findByRole('button', { name: /sair do grupo/i }),
    )

    expect(confirmSpy).toHaveBeenCalledWith(
      'Tem certeza que deseja sair deste grupo?',
    )

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument()
    })
  })
})
