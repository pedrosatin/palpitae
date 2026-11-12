import { test, expect, type Page } from '@playwright/test'

// Resposta fora do formato e aba que quebra no render mostram a tela de erro no
// lugar da aba. Cabeçalho e abas continuam na página, sem tela em branco.
const future = new Date(Date.now() + 3 * 86_400_000).toISOString()
const match = {
  id: 'err-m1',
  phase: 'REGULAR_SEASON',
  round: '1',
  round_label: 'Rodada 1',
  start_time: future,
  group_name: null,
  is_knockout: false,
  status: 'scheduled',
  home_score: null,
  away_score: null,
  home_team_id: 'err-h',
  home_team_name: 'Casa',
  home_team_short_name: null,
  home_team_logo: null,
  away_team_id: 'err-a',
  away_team_name: 'Fora',
  away_team_short_name: null,
  away_team_logo: null,
}
const group = {
  id: 'err-g',
  name: 'Bolão do Erro',
  competition_id: 'err-c',
  competition_name: 'Brasileirão',
  competition_type: 'league',
  competition_code: 'BSA',
  competition_status: 'ongoing',
  is_admin: false,
  invite_code: null,
  points_exact: 3,
  points_winner: 1,
  points_penalty: 0,
  predictions_visibility: 'hidden',
  member_count: 2,
  user_position: 1,
  user_points: 0,
}
const headers = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Credentials': 'true',
}

async function mockApi(page: Page, overrides: Record<string, unknown>) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const override = Object.keys(overrides).find((suffix) => path.endsWith(suffix))
    let json: unknown = {}
    if (override) json = overrides[override]
    else if (path.endsWith('/auth/me')) json = { user: { id: 'err-u', email: 'erro@test.com' } }
    else if (path.endsWith('/matches')) json = { matches: [match], default_round: '1' }
    else if (path.endsWith('/predictions/group'))
      json = { self_user_id: 'err-u', members: [], predictions: [], open_pickers: {} }
    else if (path.endsWith('/predictions')) json = { predictions: [] }
    else if (path.endsWith('/round-standings')) json = { round: null, standings: [] }
    else if (path.endsWith('/groups/err-g')) json = { group }
    else if (path.endsWith('/groups')) json = { groups: [] }
    await route.fulfill({ headers, json })
  })
}

test.use({ viewport: { width: 390, height: 844 } })

test('membros fora do formato: erro na aba Ranking e as abas seguem navegáveis', async ({
  page,
}) => {
  await mockApi(page, { '/members': {} })
  await page.goto('/grupos/err-g?tab=leaderboard')

  await expect(page.getByRole('alert')).toHaveText(
    'Resposta inesperada do servidor. Tente novamente.',
  )
  await expect(page.getByRole('heading', { name: 'Bolão do Erro' })).toBeVisible()

  await page.getByRole('link', { name: 'Palpitar', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Casa').first()).toBeVisible()
})

test('aba que quebra no render mostra a tela de erro com nova tentativa', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Membro sem nome num jogo aberto quebra as iniciais da aba Grupo.
  await mockApi(page, {
    '/predictions/group': {
      self_user_id: 'err-u',
      members: [{ user_id: 'err-x', display: null }],
      predictions: [],
      open_pickers: { 'err-m1': ['err-x'] },
    },
  })
  await page.goto('/grupos/err-g?tab=group-picks')

  await expect(page.getByRole('alert')).toContainText('Não foi possível mostrar esta aba.')
  await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ranking', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
