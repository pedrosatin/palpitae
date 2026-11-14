import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import GroupDetailPage from './GroupDetailPage'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))

vi.mock('../../components/PredictionsTab', () => ({
  default: ({ groupId }: { groupId: string }) => (
    <div data-testid="predictions-tab">PredictionsTab:{groupId}</div>
  ),
}))

vi.mock('../../components/Header', () => ({
  default: () => <header data-testid="header" />,
}))

const VALID_ID = '00000000-0000-4000-8000-000000000001'

const user = { id: 'user-1', email: 'user@example.com', feature_flags: {} }

const group = {
  id: VALID_ID,
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
          path="/grupos/:groupId"
          element={<GroupDetailPage user={user} onLogout={vi.fn()} />}
        />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('GroupDetailPage, id do grupo na URL', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ group }),
    } as Response)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['sobe de diretório', '..%2F..%2Fauth%2Fme'],
    ['injeta query string', 'x%3Fy=1'],
    ['injeta fragmento', 'x%23y'],
    ['é curto demais', 'g1'],
    ['tem UUID seguido de sufixo', `${VALID_ID}%2F..%2Fauth`],
  ])('id que "%s" mostra "Grupo não encontrado" sem chamar a API', async (_nome, segmento) => {
    renderPage(`/grupos/${segmento}`)

    expect(await screen.findByText('Grupo não encontrado')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /voltar para meus grupos/i })).toBeInTheDocument()
    expect(document.title).toBe('Palpitae')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('UUID válido busca o grupo e abre a aba Palpitar', async () => {
    renderPage(`/grupos/${VALID_ID}`)

    expect(await screen.findByTestId('predictions-tab')).toHaveTextContent(VALID_ID)
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`/groups/${VALID_ID}$`)),
        expect.objectContaining({ credentials: 'include' }),
      )
    })
  })
})
