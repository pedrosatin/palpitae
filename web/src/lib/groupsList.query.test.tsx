import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMatch } from '../components/matchFixtures'
import DashboardPage from '../pages/DashboardPage/DashboardPage'
import GroupDetailPage from '../pages/GroupDetailPage/GroupDetailPage'
import { createTestQueryClient, renderWithQuery } from '../test-utils'
import { groupsListQueryKey, groupsListQueryOptions } from './groupsList'

vi.mock('../analytics/ga', () => ({ trackEvent: vi.fn(), trackPageView: vi.fn() }))

const GROUP_ID = '00000000-0000-4000-8000-000000000001'
const user = {
  id: 'u1',
  email: 'user@example.com',
  feature_flags: { create_group: false },
}

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function renderApp(queryClient = createTestQueryClient()) {
  let goHome: () => void = () => {}

  function NavProbe() {
    const navigate = useNavigate()
    goHome = () => navigate('/')
    return null
  }

  const view = renderWithQuery(
    <MemoryRouter initialEntries={['/']}>
      <NavProbe />
      <Routes>
        <Route path="/" element={<DashboardPage user={user} onLogout={vi.fn()} />} />
        <Route path="/grupos/:groupId" element={<GroupDetailPage user={user} onLogout={vi.fn()} />} />
      </Routes>
    </MemoryRouter>,
    { queryClient },
  )

  return { ...view, goHome: () => goHome() }
}

describe('queries de grupos no TanStack Query', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('salvar um palpite e voltar à home mostra a contagem de pendentes nova sem esperar TTL', async () => {
    let pendingPredictions = 2
    let listCalls = 0
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]

    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      const path = String(url)
      if (path.endsWith('/groups') || path.includes('/groups?')) {
        listCalls += 1
        return json({
          groups: [
            {
              id: GROUP_ID,
              name: 'Bolão da Firma',
              competition_id: 'c1',
              competition_name: 'Copa',
              competition_status: 'ongoing',
              is_admin: true,
              invite_code: 'ABCD-EF23',
              created_at: '2026-01-01T00:00:00Z',
              member_count: 3,
              user_position: 1,
              user_points: 0,
              exact_hits: 0,
              pending_predictions: pendingPredictions,
            },
          ],
          matched_invite_group_id: null,
        })
      }
      if (path.includes(`/groups/${GROUP_ID}`)) {
        return json({
          group: {
            id: GROUP_ID,
            name: 'Bolão da Firma',
            competition_id: 'c1',
            competition_name: 'Copa',
            competition_type: 'cup',
            competition_code: null,
            competition_status: 'ongoing',
            is_admin: true,
            invite_code: 'ABCD-EF23',
            created_at: '2026-01-01T00:00:00Z',
            member_count: 3,
            user_position: 1,
            user_points: 0,
            exact_hits: 0,
            points_exact: 3,
            points_winner: 1,
            points_penalty: 1,
            points_classified: 0,
            predictions_visibility: 'hidden',
          },
        })
      }
      if (path.includes('/matches')) {
        return json({ matches, default_round: '1' })
      }
      if (path.includes('/predictions?') && (!init?.method || init.method === 'GET')) {
        return json({ predictions: [] })
      }
      if (path.endsWith('/predictions') && init?.method === 'PUT') {
        pendingPredictions = 1
        return json({ ok: true })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    const app = renderApp()

    expect(await screen.findByRole('link', { name: /Abrir grupo Bolão da Firma, 2 sem palpite/i })).toBeInTheDocument()
    expect(listCalls).toBe(1)

    const runner = userEvent.setup()
    await runner.click(screen.getByText('Bolão da Firma'))

    const homeScore = await screen.findByLabelText('Placar Brasil')
    const awayScore = screen.getByLabelText('Placar Argentina')
    await runner.type(homeScore, '2')
    await runner.type(awayScore, '1')
    await runner.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(pendingPredictions).toBe(1)
    })

    act(() => app.goHome())

    expect(await screen.findByRole('link', { name: /Abrir grupo Bolão da Firma, 1 sem palpite/i })).toBeInTheDocument()
    expect(screen.queryByText('2 sem palpite')).not.toBeInTheDocument()
    expect(listCalls).toBeGreaterThanOrEqual(2)
  })

  it('renomear o grupo atualiza o nome no detalhe e na home', async () => {
    let groupName = 'Grupo Antigo'

    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      const path = String(url)
      if (path.endsWith('/groups') || path.includes('/groups?')) {
        return json({
          groups: [
            {
              id: GROUP_ID,
              name: groupName,
              competition_id: 'c1',
              competition_name: 'Copa',
              competition_status: 'ongoing',
              is_admin: true,
              invite_code: 'ABCD-EF23',
              created_at: '2026-01-01T00:00:00Z',
              member_count: 3,
              user_position: 1,
              user_points: 0,
              exact_hits: 0,
            },
          ],
          matched_invite_group_id: null,
        })
      }
      if (path.includes(`/groups/${GROUP_ID}`) && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { name: string }
        groupName = body.name
        return json({ group: { id: GROUP_ID, name: groupName } })
      }
      if (path.includes(`/groups/${GROUP_ID}`)) {
        return json({
          group: {
            id: GROUP_ID,
            name: groupName,
            competition_id: 'c1',
            competition_name: 'Copa',
            competition_type: 'cup',
            competition_code: null,
            competition_status: 'ongoing',
            is_admin: true,
            invite_code: 'ABCD-EF23',
            created_at: '2026-01-01T00:00:00Z',
            member_count: 3,
            user_position: 1,
            user_points: 0,
            exact_hits: 0,
            points_exact: 3,
            points_winner: 1,
            points_penalty: 1,
            points_classified: 0,
            predictions_visibility: 'hidden',
          },
        })
      }
      if (path.includes('/matches')) {
        return json({ matches: [], default_round: '1' })
      }
      if (path.includes('/predictions?')) {
        return json({ predictions: [] })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    const app = renderApp()

    const runner = userEvent.setup()
    await runner.click(await screen.findByText('Grupo Antigo'))

    await screen.findByRole('heading', { name: 'Grupo Antigo' })
    await runner.click(screen.getByRole('button', { name: /opções do grupo/i }))
    await runner.click(screen.getByRole('menuitem', { name: /configurações do grupo/i }))

    const input = screen.getByPlaceholderText('Nome do grupo')
    await runner.clear(input)
    await runner.type(input, 'Grupo Renomeado')
    await runner.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByRole('heading', { name: 'Grupo Renomeado' })).toBeInTheDocument()

    act(() => app.goHome())

    expect(await screen.findByText('Grupo Renomeado')).toBeInTheDocument()
    expect(screen.queryByText('Grupo Antigo')).not.toBeInTheDocument()
  })

  it('chave da lista de grupos considera o usuário e o código de convite', async () => {
    expect(groupsListQueryKey('u1')).not.toEqual(groupsListQueryKey('u2'))
    expect(groupsListQueryKey('u1')).not.toEqual(groupsListQueryKey('u1', 'ABCD-EF23'))

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const path = String(url)
      if (path.includes('invite_code=ABCD-EF23')) {
        return json({ groups: [], matched_invite_group_id: 'g-invite' })
      }
      return json({ groups: [], matched_invite_group_id: null })
    })

    const queryClient = createTestQueryClient()
    const u1Default = await queryClient.fetchQuery(groupsListQueryOptions('u1'))
    const u1Invite = await queryClient.fetchQuery(groupsListQueryOptions('u1', 'ABCD-EF23'))
    const u2Default = await queryClient.fetchQuery(groupsListQueryOptions('u2'))

    expect(u1Default.matched_invite_group_id).toBeNull()
    expect(u1Invite.matched_invite_group_id).toBe('g-invite')
    expect(u2Default.matched_invite_group_id).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(3)

    await queryClient.fetchQuery(groupsListQueryOptions('u1'))
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })
})
