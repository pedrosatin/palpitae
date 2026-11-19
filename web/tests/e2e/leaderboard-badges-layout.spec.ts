import { test, expect, type Page } from '@playwright/test'

// A página de grupo só aceita id no formato de UUID (#726).
const GROUP_ID = '00000000-0000-4000-8000-0000000000b1'

const headers = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Credentials': 'true',
}

const LONG_NAME = 'Maria Fernanda Albuquerque dos Santos Extra'

async function mockGroupRanking(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    let json: unknown = {}
    if (url.pathname.endsWith('/auth/me')) {
      json = { user: { id: 'u1', email: 'layout@test.com' } }
    } else if (url.pathname.endsWith('/matches')) {
      json = { matches: [], default_round: '34' }
    } else if (url.pathname.endsWith('/predictions/user')) {
      json = { predictions: [], default_round: '34' }
    } else if (url.pathname.endsWith('/predictions/group')) {
      json = { predictions: [], members: [], open_pickers: {} }
    } else if (url.pathname.endsWith('/predictions')) {
      json = { predictions: [] }
    } else if (url.pathname.endsWith('/members')) {
      json = {
        members: [
          {
            user_id: 'u1',
            display_name: LONG_NAME,
            avatar_url: null,
            role: 'owner',
            joined_at: '2026-01-01T00:00:00Z',
            total_points: 42,
            exact_hits: 15,
          },
          {
            user_id: 'u2',
            display_name: 'Ana',
            avatar_url: null,
            role: 'member',
            joined_at: '2026-01-02T00:00:00Z',
            total_points: 10,
            exact_hits: 1,
          },
        ],
      }
    } else if (url.pathname.endsWith('/round-standings')) {
      json = {
        round: '34',
        standings: [
          {
            user_id: 'u1',
            round_points: 9,
            position_change: 1,
            streak: 5,
            exact_hits: 15,
            exact_milestone: 15,
            exact_milestones_crossed: [],
            unlikely_exact: true,
            unlikely_exact_percent: 10,
          },
          {
            user_id: 'u2',
            round_points: 0,
            position_change: -1,
            streak: 0,
            exact_hits: 1,
            exact_milestone: null,
            exact_milestones_crossed: [],
            unlikely_exact: false,
            unlikely_exact_percent: null,
          },
        ],
      }
    } else if (url.pathname.endsWith(`/groups/${GROUP_ID}`)) {
      json = {
        group: {
          id: GROUP_ID,
          name: 'Bolão layout',
          competition_id: 'layout-c',
          competition_name: 'Brasileirão',
          competition_type: 'league',
          competition_code: 'BSA',
          competition_status: 'ongoing',
          is_admin: true,
          invite_code: 'LAYO-UT01',
          public_id: 'abcdef0123456789abcdef0123456789',
          points_exact: 3,
          points_winner: 1,
          points_penalty: 0,
          predictions_visibility: 'hidden',
          member_count: 2,
          user_position: 1,
          user_points: 42,
        },
      }
    }
    await route.fulfill({ headers, json })
  })
}

test.use({ viewport: { width: 320, height: 720 } })

test('ranking em 320 px: nome longo e vários selos sem overflow', async ({ page }) => {
  await mockGroupRanking(page)
  await page.goto(`/grupos/${GROUP_ID}`)
  await page.getByRole('link', { name: 'Ranking', exact: true }).click()

  const name = page.getByText(LONG_NAME)
  await expect(name).toBeVisible()

  const row = name.locator('xpath=ancestor::tr[1]')
  await expect(row.getByText('admin')).toBeVisible()
  await expect(row.getByText('você')).toBeVisible()
  await expect(row.getByText('rei da rodada')).toBeVisible()
  await expect(row.getByText('5 seguidas')).toBeVisible()
  await expect(row.getByText('15 exatos')).toBeVisible()
  await expect(row.getByText('improvável')).toBeVisible()

  const layout = await row.evaluate((tr) => {
    const root = tr.closest('[class*="root"]') ?? tr.closest('div')
    const nameCell = tr.querySelector('td:nth-child(2)') as HTMLElement
    const nameEl = [...nameCell.querySelectorAll('span')].find((el) =>
      (el.textContent ?? '').includes('Maria Fernanda'),
    ) as HTMLElement
    const badgesWrap = nameEl?.parentElement?.querySelector(':scope > span:last-child') as HTMLElement
    const style = nameEl ? getComputedStyle(nameEl) : null
    const cellBox = nameCell.getBoundingClientRect()
    const badgeEls = badgesWrap
      ? ([...badgesWrap.querySelectorAll(':scope > *')] as HTMLElement[])
      : []
    return {
      tableScroll: root
        ? (root as HTMLElement).scrollWidth > (root as HTMLElement).clientWidth + 1
        : false,
      nameOverflows: nameEl ? nameEl.scrollWidth > nameEl.clientWidth + 0.5 : false,
      nameEllipsis: style?.textOverflow === 'ellipsis',
      nameOverflowHidden: style?.overflow === 'hidden' || style?.overflowX === 'hidden',
      cellOverflows: nameCell.scrollWidth > nameCell.clientWidth + 1,
      badgesOutside: badgeEls.some(
        (badge) => badge.getBoundingClientRect().right > cellBox.right + 1,
      ),
      badgeBounds: badgeEls.map((badge) => {
        const box = badge.getBoundingClientRect()
        return {
          text: (badge.textContent ?? '').replace(/\s+/g, ' ').trim(),
          inside:
            box.left >= cellBox.left - 1 &&
            box.right <= cellBox.right + 1 &&
            box.top >= cellBox.top - 1 &&
            box.bottom <= cellBox.bottom + 1,
        }
      }),
    }
  })

  expect(layout.tableScroll).toBe(false)
  expect(layout.cellOverflows).toBe(false)
  expect(layout.nameOverflows).toBe(true)
  expect(layout.nameEllipsis).toBe(true)
  expect(layout.nameOverflowHidden).toBe(true)
  expect(layout.badgesOutside).toBe(false)
  expect(layout.badgeBounds.length).toBeGreaterThanOrEqual(6)
  for (const badge of layout.badgeBounds) {
    expect(badge.inside, `selo fora da célula: ${badge.text}`).toBe(true)
  }
})
