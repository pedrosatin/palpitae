import { test, expect, type Page } from '@playwright/test'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function group(id: string, name: string, competition_name: string, overrides = {}) {
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
    ...overrides,
  }
}

const groups = [
  group('1', 'Champions', 'Liga dos Campeões'),
  group('2', 'Copa BR', 'Copa do Brasil'),
  group('3', 'Classificado Copa 19-10', 'Copa do Brasil'),
  group('4', 'Bolãodafamíliadosatinedosamigo', 'Campeonato Brasileiro Série A'),
  group('5', 'Classificado Copa 19-10 B', 'Campeonato Brasileiro Série A', { is_admin: false }),
  group('6', 'Champions encerrado', 'Liga dos Campeões', {
    competition_status: 'finished',
    podium: [{ position: 1, display: 'Ana', points: 10, is_you: false }],
  }),
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
 * Mede cada linha do texto com Range, não a caixa do h3: o título pode encolher
 * (min-width: 0) e deixar o texto vazar para fora da própria caixa. Os limites são
 * os da caixa de conteúdo do link, sem o padding.
 */
function measureHeaders(page: Page) {
  return page.locator('a[href^="/grupos/"] h3').evaluateAll((titles) =>
    titles.map((title) => {
      const range = document.createRange()
      range.selectNodeContents(title)
      const textRects = [...range.getClientRects()]
      const badgeRects = [...title.parentElement!.querySelectorAll('span')].map((badge) =>
        badge.getBoundingClientRect(),
      )

      const link = title.closest('a')!
      const linkBox = link.getBoundingClientRect()
      const linkStyle = getComputedStyle(link)
      const left = linkBox.left + parseFloat(linkStyle.paddingLeft)
      const right = linkBox.right - parseFloat(linkStyle.paddingRight)
      const isInside = (rect: DOMRect) => rect.left >= left - 0.5 && rect.right <= right + 0.5
      const titleBottom = Math.max(...textRects.map((rect) => rect.bottom))
      const competition = title.parentElement!.querySelector<HTMLElement>('[data-tooltip] > span')!

      return {
        name: title.textContent,
        lines: new Set(textRects.map((rect) => Math.round(rect.top))).size,
        badges: badgeRects.length,
        overlaps: textRects.some((text) =>
          badgeRects.some(
            (badge) =>
              text.left < badge.right &&
              badge.left < text.right &&
              text.top < badge.bottom &&
              badge.top < text.bottom,
          ),
        ),
        textInsideCard: textRects.every(isInside),
        badgesInsideCard: badgeRects.every(isInside),
        // Badges sempre na linha de baixo, com nome curto ou longo.
        badgesBelowTitle: badgeRects.every((badge) => badge.top >= titleBottom - 0.5),
        // Campeonato inteiro, sem reticências: o texto não excede a caixa da badge.
        competitionTruncated: competition.scrollWidth > competition.clientWidth + 0.5,
      }
    }),
  )
}

test.describe('Cabeçalho do card de grupo', () => {
  for (const width of [320, 360, 390, 412, 1024, 1491]) {
    test(`badges abaixo do título, sem sobreposição nem corte, em ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await mockDashboard(page)
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Champions', exact: true })).toBeVisible()

      const headers = await measureHeaders(page)

      expect(headers).toHaveLength(groups.length)
      for (const header of headers) {
        expect(header.badges, header.name ?? '').toBeGreaterThan(0)
        expect(header, header.name ?? '').toMatchObject({
          overlaps: false,
          textInsideCard: true,
          badgesInsideCard: true,
          badgesBelowTitle: true,
          competitionTruncated: false,
        })
      }

      // Uma palavra que cabe no card não se parte.
      expect(headers.find((header) => header.name === 'Champions')?.lines).toBe(1)
    })
  }
})
