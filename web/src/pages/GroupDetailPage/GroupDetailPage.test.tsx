import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import * as ga from '../../analytics/ga'
import GroupDetailPage from './GroupDetailPage'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

// ─── Mock heavy child components ───────────────────────────────────────────

vi.mock('../../components/PredictionsTab', () => ({
  default: ({
    groupId,
    initialRound,
    onInitialRoundApplied,
  }: {
    groupId: string
    initialRound?: string | null
    onInitialRoundApplied?: () => void
  }) => (
    <div data-testid="predictions-tab">
      PredictionsTab:{groupId}
      {initialRound && (
        <button onClick={onInitialRoundApplied}>Aplicar rodada {initialRound}</button>
      )}
    </div>
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

vi.mock('../../components/StandingsTab', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/StandingsTab')>()
  return {
    ...actual,
    default: ({ competitionId }: { competitionId: string }) => (
      <div data-testid="standings-tab">StandingsTab:{competitionId}</div>
    ),
  }
})

vi.mock('../../components/LeaderboardTab', () => ({
  default: ({
    groupId,
    tiebreakNote,
    onOpenRules,
  }: {
    groupId: string
    tiebreakNote?: string
    onOpenRules?: (opener: HTMLElement) => void
  }) => (
    <div data-testid="leaderboard-tab">
      LeaderboardTab:{groupId}
      <span>{tiebreakNote}</span>
      <button onClick={(e) => onOpenRules?.(e.currentTarget)}>Como pontua</button>
    </div>
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
  competition_type: null as 'league' | 'cup' | null,
  competition_code: null as string | null,
  competition_status: 'ongoing' as 'upcoming' | 'ongoing' | 'finished' | null,
  is_admin: false,
  invite_code: 'INV001',
  created_at: '2026-01-01T00:00:00Z',
  member_count: 3,
  user_position: 1,
  user_points: 10,
  exact_hits: 2,
  points_exact: 3,
  points_winner: 1,
  points_penalty: 1,
  points_classified: 0,
  predictions_visibility: 'hidden',
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

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

function renderPage(path = '/groups/abc', routePattern = '/groups/:groupId') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
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

describe('GroupDetailPage, confirmação de entrada', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function StateProbe() {
    const location = useLocation()
    return <span data-testid="state">{JSON.stringify(location.state)}</span>
  }

  function renderJoined(state: unknown) {
    return render(
      <MemoryRouter initialEntries={[{ pathname: '/groups/abc', state }]}>
        <Routes>
          <Route
            path="/groups/:groupId"
            element={<GroupDetailPage user={baseUser} onLogout={vi.fn()} />}
          />
        </Routes>
        <StateProbe />
      </MemoryRouter>,
    )
  }

  it('confirma a entrada na aba Palpitar e limpa o histórico', async () => {
    mockGroupFetch()

    renderJoined({ joinedGroupName: 'Realidade do BR' })

    expect(await screen.findByRole('status')).toHaveTextContent('Você entrou em Realidade do BR')
    expect(screen.getByTestId('predictions-tab')).toBeInTheDocument()
    expect(screen.getByTestId('state')).toHaveTextContent('null')
  })

  it('tira a confirmação depois de alguns segundos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mockGroupFetch()
      renderJoined({ joinedGroupName: 'Realidade do BR' })
      await screen.findByRole('status')

      act(() => {
        vi.advanceTimersByTime(6000)
      })

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('não mostra confirmação sem o estado de entrada', async () => {
    mockGroupFetch()

    renderJoined(null)

    await screen.findByTestId('predictions-tab')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

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
          <Route path="/groups/" element={<GroupDetailPage user={baseUser} onLogout={vi.fn()} />} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>,
    )

    // Component renders <Navigate to="/" replace /> → should show Home
    expect(screen.getByText('Home')).toBeInTheDocument()
  })
})

describe('GroupDetailPage – rodada do painel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('passa a rodada do link à aba Palpitar e a tira da URL depois de aplicada', async () => {
    mockGroupFetch()
    renderPage('/groups/abc?rodada=21&x=1')

    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar rodada 21' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/groups/abc?x=1')
    expect(screen.queryByRole('button', { name: /Aplicar rodada/ })).not.toBeInTheDocument()
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

    await userEvent.click(screen.getByRole('link', { name: /Ranking/i }))

    expect(screen.queryByTestId('predictions-tab')).not.toBeInTheDocument()
    expect(screen.getByTestId('leaderboard-tab')).toBeInTheDocument()
  })

  it('switches back to Palpitar tab when that button is clicked', async () => {
    mockGroupFetch()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('predictions-tab')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('link', { name: /Ranking/i }))
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

    expect(screen.getByRole('dialog', { name: /criar grupo/i })).toBeInTheDocument()
  })

  it('opens the join group modal when the Header emits onJoinGroup', async () => {
    mockGroupFetch()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('header')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: 'Entrar em grupo' }))

    expect(screen.getByRole('dialog', { name: /entrar em grupo/i })).toBeInTheDocument()
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
    expect(screen.queryByRole('menuitem', { name: /sair do grupo/i })).not.toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: /opções do grupo/i }))

    expect(screen.getByRole('menuitem', { name: /sair do grupo/i })).toBeInTheDocument()
  })

  it('shows edit/delete actions (not leave) in the options menu for admins', async () => {
    mockGroupFetch({ ...baseGroup, is_admin: true })

    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /opções do grupo/i }))

    expect(screen.getByRole('menuitem', { name: /configurações do grupo/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /excluir grupo/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /sair do grupo/i })).not.toBeInTheDocument()
  })

  it('removes the current user from the group after confirmation', async () => {
    mockGroupFetchSequence({ body: { group: baseGroup } }, { body: { success: true } })

    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /opções do grupo/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /sair do grupo/i }))

    // Confirmation dialog appears instead of window.confirm.
    expect(await screen.findByText('Tem certeza que deseja sair deste grupo?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }))

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument()
    })
  })
})

describe('GroupDetailPage – invite section', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the invite (collapsed on mobile) to the admin of an ongoing group, above the tabs', async () => {
    mockGroupFetch({ ...baseGroup, is_admin: true })

    renderPage()

    const toggle = await screen.findByRole('button', { name: /convidar membros/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('INV001')).toBeInTheDocument()

    const tabs = screen.getByTestId('group-tabs')
    expect(toggle.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('hides the invite from non-admin members', async () => {
    mockGroupFetch({ ...baseGroup, is_admin: false })

    renderPage()

    await screen.findByTestId('group-tabs')
    expect(screen.queryByRole('button', { name: /convidar membros/i })).not.toBeInTheDocument()
    expect(screen.queryByText('INV001')).not.toBeInTheDocument()
  })

  it('hides the invite when the competition is finished', async () => {
    mockGroupFetch({ ...baseGroup, is_admin: true, competition_status: 'finished' })

    renderPage()

    await screen.findByTestId('group-tabs')
    expect(screen.queryByRole('button', { name: /convidar membros/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /convidar membros/i })).not.toBeInTheDocument()
    expect(screen.queryByText('INV001')).not.toBeInTheDocument()
  })
})

describe('GroupDetailPage – group not found', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('offers a way back to Meus grupos', async () => {
    mockGroupFetch(baseGroup, false)

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Grupo não encontrado')
    const back = screen.getByRole('link', { name: /voltar para meus grupos/i })
    expect(back).toHaveAttribute('href', '/')

    await userEvent.click(back)
    expect(screen.getByText('Home')).toBeInTheDocument()
  })
})

describe('GroupDetailPage – admin: rename & delete', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('refreshes the points in the header after changing the classified bonus', async () => {
    mockGroupFetchSequence(
      { body: { group: { ...baseGroup, is_admin: true, points_classified: 0 } } },
      { body: { group: { id: baseGroup.id, points_classified: 4 } } },
      { body: { group: { ...baseGroup, is_admin: true, points_classified: 4, user_points: 14 } } },
    )
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /opções do grupo/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /configurações do grupo/i }))
    const bonus = screen.getByRole('spinbutton', { name: 'Bônus classificado' })
    await userEvent.clear(bonus)
    await userEvent.type(bonus, '4')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('14')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('explains when the bonus was saved but the refreshed points could not be loaded', async () => {
    mockGroupFetchSequence(
      { body: { group: { ...baseGroup, is_admin: true, points_classified: 0 } } },
      { body: { group: { id: baseGroup.id, points_classified: 4 } } },
      { ok: false },
    )
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /opções do grupo/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /configurações do grupo/i }))
    const bonus = screen.getByRole('spinbutton', { name: 'Bônus classificado' })
    await userEvent.clear(bonus)
    await userEvent.type(bonus, '4')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(
      await screen.findByText('Pontuação salva. Recarregue a página para atualizar o grupo.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renames the group via the edit modal', async () => {
    mockGroupFetchSequence(
      { body: { group: { ...baseGroup, is_admin: true } } },
      { body: { group: { id: baseGroup.id, name: 'Novo Nome' } } },
    )

    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /opções do grupo/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /configurações do grupo/i }))

    const input = screen.getByPlaceholderText('Nome do grupo')
    await userEvent.clear(input)
    await userEvent.type(input, 'Novo Nome')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Novo Nome' })).toBeInTheDocument()
    })
  })

  it('soft-deletes the group after confirmation', async () => {
    mockGroupFetchSequence(
      { body: { group: { ...baseGroup, is_admin: true } } },
      { body: { success: true } },
    )

    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /opções do grupo/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /excluir grupo/i }))

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
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_detail_tab', {
      tab: 'leaderboard',
    })
  })

  it('fires click_group_detail_menu_sair when Sair do grupo is clicked', async () => {
    mockGroupFetch()
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /opções do grupo/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /sair do grupo/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_detail_menu_sair')
  })

  it('fires click_group_detail_menu_editar_nome when Configurações do grupo is clicked', async () => {
    mockGroupFetch({ ...baseGroup, is_admin: true })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /opções do grupo/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /configurações do grupo/i }))
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
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    mockGroupFetch({ ...baseGroup, is_admin: true })
    renderPage()
    const copyBtn = await screen.findByRole('button', { name: /^Copiar$/ })
    await userEvent.click(copyBtn)
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_detail_copiar_codigo')
  })

  it('fires click_group_detail_copiar_link when the copy link button is clicked', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    mockGroupFetch({ ...baseGroup, is_admin: true })
    renderPage()
    const copyLinkBtn = await screen.findByRole('button', {
      name: /Copiar link/,
    })
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
    await userEvent.click(screen.getByRole('menuitem', { name: /configurações do grupo/i }))

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

  it('shows the Tabela tab for Gaúcho cup with canonical competition_code', async () => {
    mockGroupFetch({
      ...baseGroup,
      competition_type: 'cup',
      competition_code: 'bra.camp.gaucho',
    })
    renderPage()
    expect(await screen.findByRole('link', { name: /Tabela/i })).toBeInTheDocument()
  })

  it('renders StandingsTab when Tabela is clicked in a Gaúcho cup group', async () => {
    mockGroupFetch({
      ...baseGroup,
      competition_type: 'cup',
      competition_code: 'bra.camp.gaucho',
    })
    renderPage()
    await userEvent.click(await screen.findByRole('link', { name: /Tabela/i }))
    expect(screen.getByTestId('standings-tab')).toHaveTextContent('StandingsTab:comp-1')
  })

  it('honours ?tab=standings deep link for an eligible regional cup', async () => {
    mockGroupFetch({
      ...baseGroup,
      competition_type: 'cup',
      competition_code: 'bra.camp.carioca',
    })
    renderPage('/groups/abc?tab=standings')
    expect(await screen.findByTestId('standings-tab')).toHaveTextContent('StandingsTab:comp-1')
    expect(screen.getByRole('link', { name: /Tabela/i })).toHaveClass(/tabActive/i)
  })

  it('hides the Tabela tab for ordinary cup competitions without eligible code', async () => {
    mockGroupFetch({
      ...baseGroup,
      competition_type: 'cup',
      competition_code: 'bra.copa_do_brazil',
    })
    renderPage()
    await screen.findByRole('link', { name: /Ranking/i })
    expect(screen.queryByRole('link', { name: /Tabela/i })).not.toBeInTheDocument()
  })

  it('falls back to the default tab when ?tab=standings is forced on an ordinary cup', async () => {
    mockGroupFetch({ ...baseGroup, competition_type: 'cup', competition_code: null })
    renderPage('/groups/abc?tab=standings')
    await screen.findByRole('link', { name: /Ranking/i })
    expect(screen.queryByTestId('standings-tab')).not.toBeInTheDocument()
    // painel default (Palpitar) ativo no lugar de um painel vazio
    expect(screen.getByRole('link', { name: /Palpitar/i })).toHaveClass(/tabActive/i)
  })
})

describe('GroupDetailPage – regras do grupo', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('abre as regras pelo menu do cabeçalho para um membro não admin e devolve o foco ao fechar com Esc', async () => {
    const user = userEvent.setup()
    mockGroupFetch()
    renderPage('/groups/abc')

    const kebab = await screen.findByRole('button', { name: 'Opções do grupo' })
    await user.click(kebab)
    await user.click(screen.getByRole('menuitem', { name: 'Regras do grupo' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Placar exato vale 3 pontos.')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Os palpites dos outros só aparecem depois que o jogo começa.'),
    ).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(kebab).toHaveFocus()
  })

  it('mostra visibilidade pública e bônus do mata-mata', async () => {
    const user = userEvent.setup()
    mockGroupFetch({
      ...baseGroup,
      competition_type: 'cup',
      points_classified: 2,
      predictions_visibility: 'public',
    })
    renderPage('/groups/abc')

    await user.click(await screen.findByRole('button', { name: 'Opções do grupo' }))
    await user.click(screen.getByRole('menuitem', { name: 'Regras do grupo' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Os palpites de todos ficam visíveis/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Classificado vale mais 2 pontos/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Pênaltis valem mais 1 ponto/)).toBeInTheDocument()
  })

  it('abre as regras pelo link do ranking e devolve o foco ao link', async () => {
    const user = userEvent.setup()
    mockGroupFetch()
    renderPage('/groups/abc')

    await user.click(await screen.findByRole('link', { name: /Ranking/i }))
    expect(
      await screen.findByText(/Desempate: mais pontos, depois mais placares exatos/),
    ).toBeInTheDocument()
    const link = screen.getByRole('button', { name: 'Como pontua' })
    await user.click(link)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Fechar' }))

    expect(link).toHaveFocus()
  })
})
