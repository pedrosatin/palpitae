import { test, expect } from '@playwright/test'

// O teste intercepta a API no navegador com três jogos baseados nas respostas de roundOrder.test.ts.
const matches = [
  {
    id: 'order-0',
    phase: 'FIRST_STAGE',
    round: 'FIRST_STAGE',
    round_label: '1ª fase',
    start_time: '2026-02-01T12:00:00Z',
    group_name: null,
    is_knockout: true,
  },
  {
    id: 'order-1',
    phase: 'GROUP_STAGE',
    round: 'GROUP_STAGE',
    round_label: 'Fase de grupos',
    start_time: '2026-04-01T12:00:00Z',
    group_name: 'A',
    is_knockout: false,
  },
  {
    id: 'order-2',
    phase: 'LAST_16',
    round: 'LAST_16',
    round_label: 'Oitavas de final',
    start_time: '2026-08-01T12:00:00Z',
    group_name: null,
    is_knockout: true,
  },
].map((match) => ({
  ...match,
  status: 'scheduled',
  home_score: null,
  away_score: null,
  home_team_id: 'order-h',
  home_team_name: 'Casa',
  home_team_short_name: null,
  home_team_logo: null,
  away_team_id: 'order-a',
  away_team_name: 'Fora',
  away_team_short_name: null,
  away_team_logo: null,
}))
const predictions = matches.map((match) => ({
  ...match,
  match_id: match.id,
  match_status: match.status,
  match_start_time: match.start_time,
  predicted_home_score: null,
  predicted_away_score: null,
  points_awarded: null,
}))
const rounds = ['FIRST_STAGE', 'GROUP_STAGE', 'LAST_16']

const headers = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Credentials': 'true',
}

test.use({ viewport: { width: 390, height: 844 } })
test('Libertadores: ordem em Palpitar, Grupo e modal', async ({ page }) => {
  await page.route('**/auth/me', (route) =>
    route.fulfill({ headers, json: { user: { id: 'order-u', email: 'order@test.com' } } }),
  )
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    let json: unknown = {}
    if (url.pathname.endsWith('/auth/me'))
      json = { user: { id: 'order-u', email: 'order@test.com' } }
    else if (url.pathname.endsWith('/matches')) json = { matches, default_round: 'GROUP_STAGE' }
    else if (url.pathname.endsWith('/predictions/user'))
      json = { predictions, default_round: 'GROUP_STAGE' }
    else if (url.pathname.endsWith('/predictions/group'))
      json = { predictions: [], members: [], open_pickers: [] }
    else if (url.pathname.endsWith('/predictions')) json = { predictions: [] }
    else if (url.pathname.endsWith('/members'))
      json = {
        members: [
          {
            user_id: 'order-u',
            display_name: 'Ana',
            avatar_url: null,
            role: 'owner',
            total_points: 0,
            exact_hits: 0,
          },
        ],
      }
    else if (url.pathname.endsWith('/round-standings')) json = { round: null, standings: [] }
    else if (url.pathname.endsWith('/groups/order-g'))
      json = {
        group: {
          id: 'order-g',
          name: 'Bolão Libertadores',
          competition_id: 'order-c',
          competition_name: 'Libertadores',
          competition_type: 'cup',
          competition_code: 'CL',
          competition_status: 'ongoing',
          is_admin: true,
          invite_code: 'ORDER',
          points_exact: 3,
          points_winner: 1,
          points_penalty: 0,
          predictions_visibility: 'hidden',
          member_count: 3,
          user_position: 1,
          user_points: 0,
        },
      }
    await route.fulfill({ headers, json })
  })
  await page.goto('/grupos/order-g')
  const select = page.locator('#predictions-round-select')
  await expect(select).toHaveValue('GROUP_STAGE')
  expect(
    await select.locator('option[value="GROUP_STAGE"]').evaluate((el) => el.parentElement?.tagName),
  ).toBe('SELECT')
  expect(
    await select
      .locator('option')
      .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value)),
  ).toEqual(rounds)
  const prev = page.getByRole('button', { name: 'Rodada anterior' })
  await expect(prev).toBeEnabled()
  await prev.click()
  await expect(select).toHaveValue('FIRST_STAGE')
  await page.getByRole('link', { name: 'Grupo', exact: true }).click()
  const groupSelect = page.locator('#picks-round-select')
  await expect(groupSelect).toHaveValue('GROUP_STAGE')
  expect(
    await groupSelect
      .locator('option')
      .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value)),
  ).toEqual(rounds)
  await page.getByRole('link', { name: 'Ranking', exact: true }).click()
  await page.getByTitle('Ver palpites de Ana').click()
  const modalSelect = page.locator('#leaderboard-round-select')
  await expect(modalSelect).toHaveValue('GROUP_STAGE')
  expect(
    await modalSelect
      .locator('option')
      .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value)),
  ).toEqual(rounds)
})
