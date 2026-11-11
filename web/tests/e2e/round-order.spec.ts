import { test, expect } from '@playwright/test'
import libertadoresMatches from '../fixtures/round-order/Libertadores-matches.json' with { type: 'json' }
import libertadoresPredictions from '../fixtures/round-order/Libertadores-predictions.json' with { type: 'json' }
import championsMatches from '../fixtures/round-order/Champions-matches.json' with { type: 'json' }
import championsPredictions from '../fixtures/round-order/Champions-predictions.json' with { type: 'json' }
import copaMatches from '../fixtures/round-order/Mundo-matches.json' with { type: 'json' }
import copaPredictions from '../fixtures/round-order/Mundo-predictions.json' with { type: 'json' }

// Respostas das rotas Hono com SQLite e migrations. O navegador substitui a fronteira HTTP.
const scenarios = [
  {
    name: 'Libertadores',
    matches: libertadoresMatches,
    picks: libertadoresPredictions,
    current: 'GROUP_STAGE',
    previous: 'FIRST_STAGE',
    rounds: ['FIRST_STAGE', 'GROUP_STAGE', 'LAST_16'],
  },
  {
    name: 'Champions',
    matches: championsMatches,
    picks: championsPredictions,
    current: '8',
    previous: null,
    rounds: ['8', 'LAST_16'],
  },
  {
    name: 'Copa',
    matches: copaMatches,
    picks: copaPredictions,
    current: '3',
    previous: null,
    rounds: ['3', 'LAST_32'],
  },
]

const headers = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Credentials': 'true',
}

test.use({ viewport: { width: 390, height: 844 } })
for (const scenario of scenarios) {
  test(`${scenario.name}: ordem em Palpitar, Grupo e modal`, async ({ page }) => {
    await page.route('**/auth/me', (route) =>
      route.fulfill({ headers, json: { user: { id: 'order-u', email: 'order@test.com' } } }),
    )
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url())
      let json: unknown = {}
      if (url.pathname.endsWith('/auth/me'))
        json = { user: { id: 'order-u', email: 'order@test.com' } }
      else if (url.pathname.endsWith('/matches'))
        json = { ...scenario.matches, default_round: scenario.current }
      else if (url.pathname.endsWith('/predictions/user'))
        json = { ...scenario.picks, default_round: scenario.current }
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
            name: `Bolão ${scenario.name}`,
            competition_id: 'order-c',
            competition_name: scenario.name,
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
    const capture = async (name: string) => {
      if (process.env.ROUND_CAPTURES)
        await page.screenshot({
          path: `${process.env.ROUND_CAPTURES}/${scenario.name}-${name}.png`,
          fullPage: true,
          animations: 'disabled',
        })
    }
    await page.goto('/grupos/order-g')
    const select = page.locator('select[id$="round-select"]')
    await expect(select.locator('option')).toHaveCount(scenario.rounds.length)
    await expect(select).toHaveValue(scenario.current)
    // Expandir o select nativo só para a captura, sem trocar suas opções.
    await select.evaluate((el) => {
      ;(el as HTMLSelectElement).size = 6
      el.style.height = '180px'
    })
    await capture('seletor')
    await select.evaluate((el) => {
      ;(el as HTMLSelectElement).size = 0
      el.style.height = ''
    })
    if (scenario.previous) {
      const prev = page.getByRole('button', { name: 'Rodada anterior' })
      if (await prev.isEnabled()) await prev.click()
      await capture('anterior')
      if (!process.env.ROUND_BASELINE) await expect(select).toHaveValue(scenario.previous)
    }
    if (!process.env.ROUND_BASELINE) {
      expect(
        await select
          .locator('option')
          .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value)),
      ).toEqual(scenario.rounds)
      if (scenario.name === 'Libertadores')
        expect(
          await select
            .locator('option[value="GROUP_STAGE"]')
            .evaluate((el) => el.parentElement?.tagName),
        ).toBe('SELECT')
    }
    await page.getByRole('link', { name: 'Grupo', exact: true }).click()
    const groupSelect = page.locator('#picks-round-select')
    await expect(groupSelect.locator('option')).toHaveCount(scenario.rounds.length)
    await expect(groupSelect).toHaveValue(scenario.current)
    if (!process.env.ROUND_BASELINE)
      expect(
        await groupSelect
          .locator('option')
          .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value)),
      ).toEqual(scenario.rounds)
    await page.getByRole('link', { name: 'Ranking', exact: true }).click()
    await page.getByTitle('Ver palpites de Ana').click()
    const modalSelect = page.locator('#leaderboard-round-select')
    await expect(modalSelect).toHaveValue(scenario.current)
    await modalSelect.evaluate((el) => {
      ;(el as HTMLSelectElement).size = 6
      el.style.height = '180px'
    })
    await capture('modal')
    if (!process.env.ROUND_BASELINE && !scenario.previous) {
      const next = page.getByRole('dialog').getByRole('button', { name: 'Próxima rodada' })
      await expect(next).toBeEnabled()
      await next.click()
      await expect(modalSelect).toHaveValue(scenario.rounds[1])
    }
    if (!process.env.ROUND_BASELINE)
      expect(
        await modalSelect
          .locator('option')
          .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value)),
      ).toEqual(scenario.rounds)
  })
}
