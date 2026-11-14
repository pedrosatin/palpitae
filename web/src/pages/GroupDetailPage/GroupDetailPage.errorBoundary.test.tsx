import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import GroupDetailPage from './GroupDetailPage'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))

const crash = vi.hoisted(() => ({ leaderboard: true }))

vi.mock('../../components/PredictionsTab', () => ({
  default: () => <div data-testid="predictions-tab">PredictionsTab</div>,
}))

// Simula a aba que quebra no render com dado que ela não espera.
vi.mock('../../components/LeaderboardTab', () => ({
  default: () => {
    if (crash.leaderboard) {
      const members = undefined as unknown as string[]
      return <div>{members.map((m) => m)}</div>
    }
    return <div data-testid="leaderboard-tab">LeaderboardTab</div>
  },
}))

vi.mock('../../components/Header', () => ({
  default: () => (
    <header data-testid="header">
      <a href="/">Meus grupos</a>
    </header>
  ),
}))

const group = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Grupo Teste',
  competition_id: 'comp-1',
  competition_name: 'Copa do Mundo',
  competition_type: null,
  competition_code: null,
  competition_status: 'ongoing',
  is_admin: false,
  invite_code: null,
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

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/groups/:groupId"
          element={
            <GroupDetailPage user={{ id: 'user-1', email: 'u@example.com' }} onLogout={vi.fn()} />
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('GroupDetailPage, aba que quebra no render', () => {
  beforeEach(() => {
    crash.leaderboard = true
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ group }),
    } as Response)
    // O React registra no console o erro que a fronteira capturou.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mostra a tela de erro na aba e mantém cabeçalho e abas navegáveis', async () => {
    renderPage('/groups/00000000-0000-4000-8000-000000000001?tab=leaderboard')

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível mostrar esta aba.')
    expect(screen.getByTestId('header')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Grupo Teste' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: 'Palpitar' }))

    expect(screen.getByTestId('predictions-tab')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('"Tentar novamente" monta a aba de novo', async () => {
    renderPage('/groups/00000000-0000-4000-8000-000000000001?tab=leaderboard')

    const retry = await screen.findByRole('button', { name: 'Tentar novamente' })
    crash.leaderboard = false
    await userEvent.click(retry)

    expect(screen.getByTestId('leaderboard-tab')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
