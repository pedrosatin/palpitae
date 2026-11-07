import { test, expect, type Page } from '@playwright/test'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function group(id: string, name: string, competition_name: string) {
  return {
    id,
    name,
    is_admin: true,
    competition_id: `comp-${id}`,
    competition_name,
    created_at: '2026-01-01T00:00:00Z',
    member_count: 6,
    user_position: 1,
    user_points: 7,
    pending_predictions: 0,
  }
}

const groups = [
  group('1', 'Champions', 'Liga dos Campeões'),
  group('2', 'Copa BR', 'Copa do Brasil'),
  group('3', 'Classificado Copa 19-10', 'Copa do Brasil'),
  group('4', 'Bolãodafamíliadosatinedosamigos', 'Campeonato Brasileiro Série A'),
]

async function mockDashboard(page: Page) {
  await page.route('**/auth/me', async (route) => {
    await route.fulfill({
      headers: corsHeaders,
      json: { user: { id: 'user-1', email: 'test@example.com' } },
    })
  })
  await page.route('**/api/groups**', async (route) => {
    await route.fulfill({
      headers: corsHeaders,
      json: { groups, matched_invite_group_id: null },
    })
  })
}

/**
 * Mede o texto com Range, não a caixa do h3: o título pode encolher (min-width: 0)
 * e deixar o texto vazar para fora da própria caixa.
 */
function measureHeaders(page: Page) {
  return page.locator('h3').evaluateAll((titles) =>
    titles.map((title) => {
      const range = document.createRange()
      range.selectNodeContents(title)
      const text = range.getBoundingClientRect()
      const badges = title.nextElementSibling!.getBoundingClientRect()
      const card = title.closest('a')!.getBoundingClientRect()
      const overlaps =
        text.left < badges.right &&
        badges.left < text.right &&
        text.top < badges.bottom &&
        badges.top < text.bottom

      return {
        name: title.textContent,
        overlaps,
        textInsideCard: text.right <= card.right,
        badgesInsideCard: badges.right <= card.right,
      }
    }),
  )
}

test.describe('Cabeçalho do card de grupo no celular', () => {
  for (const width of [320, 360, 412]) {
    test(`título e badges não se sobrepõem em ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await mockDashboard(page)
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Champions' })).toBeVisible()

      const headers = await measureHeaders(page)

      expect(headers).toHaveLength(groups.length)
      for (const header of headers) {
        expect(header, header.name ?? '').toMatchObject({
          overlaps: false,
          textInsideCard: true,
          badgesInsideCard: true,
        })
      }
    })
  }
})
