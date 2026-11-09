import { test, expect, type Page, type Locator } from '@playwright/test'
async function mock(page: Page) {
  await page.route('https://www.googletagmanager.com/**', (r) => r.abort())
  await page.route('**/auth/me', (r) =>
    r.fulfill({
      json: {
        user: { id: 'user-demo', email: 'demo@example.com', feature_flags: { create_group: true } },
      },
    }),
  )
  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname
    const group = {
      id: 'group-demo',
      name: 'Grupo de demonstração',
      competition_id: 'comp-demo',
      competition_name: 'Liga de demonstração',
      competition_status: 'ongoing',
      is_admin: true,
      invite_code: 'DEMO123',
      member_count: 1,
      points_exact: 3,
      points_winner: 1,
      predictions_visibility: 'hidden',
    }
    if (p.endsWith('/auth/me')) return r.fallback()
    let json: object = {}
    if (p === '/api/groups') json = { groups: [], matched_invite_group_id: null }
    else if (p === '/api/groups/group-demo') json = { group }
    else if (p === '/api/competitions')
      json = {
        competitions: [
          { id: 'comp-demo', name: 'Liga de demonstração', status: 'upcoming', season: '2027' },
        ],
      }
    else if (p === '/api/matches')
      json = {
        matches: [
          {
            id: 'match-demo',
            competition_id: 'comp-demo',
            start_time: new Date(Date.now() + 86_400_000).toISOString(),
            status: 'pending',
            round: '1',
            round_label: 'Rodada 1',
            home_team_id: 'home-demo',
            away_team_id: 'away-demo',
            home_team_name: 'Time Azul',
            away_team_name: 'Time Verde',
            home_team_short_name: 'AZU',
            away_team_short_name: 'VER',
            home_team_logo: '/favicon.svg',
            away_team_logo: '/favicon.svg',
          },
        ],
        default_round: '1',
      }
    else if (p.includes('predictions')) json = { predictions: [] }
    r.fulfill({ json })
  })
}
async function expectUncovered(button: Locator, banner: Locator) {
  await expect(banner).toBeVisible()
  await button.scrollIntoViewIfNeeded()
  await expect
    .poll(() =>
      button.evaluate((el) => {
        const box = el.getBoundingClientRect()
        const consent = document
          .querySelector('[aria-label="Aviso de cookies"]')!
          .getBoundingClientRect()
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return el.contains(hit) && box.bottom <= consent.top && box.top >= 0
      }),
    )
    .toBe(true)
}

for (const [width, height] of [
  [360, 740],
  [390, 664],
  [390, 844],
]) {
  test(`ações com aviso de cookies em ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await mock(page)
    await page.goto('/')
    const banner = page.getByRole('dialog', { name: 'Aviso de cookies' })
    await expect(banner).toBeVisible()
    const empty = page.getByRole('main').getByRole('button', { name: 'Criar grupo', exact: true })
    await expectUncovered(empty, banner)
    await empty.click()
    await page.locator('#group-name').fill('Grupo de demonstração')
    const submit = page.locator('button[type="submit"]')
    await expect(submit).toBeEnabled()
    await expectUncovered(submit, banner)
    await page.goto('/grupos/group-demo')
    const save = page.getByRole('button', { name: /Salvar todos/ })
    await expect(save).toBeVisible()
    await expectUncovered(save, banner)
    const bar = save.locator('..')
    await expect
      .poll(async () => {
        const box = (await bar.boundingBox())!
        const consent = (await banner.boundingBox())!
        return box.y >= 0 && box.y + box.height <= consent.y
      })
      .toBe(true)
    await page.getByRole('button', { name: 'Recusar', exact: true }).click()
    await expect(banner).toHaveCount(0)
    await expect
      .poll(() => bar.evaluate((el) => Math.round(el.getBoundingClientRect().bottom)))
      .toBe(height)
    expect(await page.evaluate(() => localStorage.getItem('palpitae:analytics-consent'))).toMatch(
      /^denied:\d+$/,
    )
  })
}
