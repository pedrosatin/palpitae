import { test, expect } from '@playwright/test'

for (const width of [390, 1440]) {
  for (const path of ['/', '/guias/bolao-do-brasileirao/']) {
    test(`recusa, aceita e revoga em ${path} com ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.route('https://www.googletagmanager.com/**', (r) => r.fulfill({ body: '' }))
      await page.route('**/api/**', (r) => r.fulfill({ json: {} }))
      await page.goto(path)
      await expect(page.getByRole('contentinfo')).toHaveCount(1)
      const banner = page.getByRole('dialog', { name: 'Aviso de cookies' })
      await expect(banner).toBeVisible()
      await banner.getByRole('button', { name: 'Recusar' }).click()
      const preferences = page.getByRole('button', {
        name: 'Preferências de cookies',
      })
      await preferences.click()
      await banner.getByRole('button', { name: 'Aceitar' }).click()
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('palpitae:analytics-consent')))
        .toBe('granted')
      await page.reload()
      await expect(banner).toBeHidden()
      expect(await page.evaluate(() => window['ga-disable-G-TEST123'])).toBe(false)
      await preferences.click()
      await banner.getByRole('button', { name: 'Recusar' }).click()
      const calls = () =>
        page.evaluate(() =>
          window.dataLayer.map((entry) => Array.from(entry as ArrayLike<unknown>)),
        )
      expect((await calls()).at(-1)).toEqual(['consent', 'update', { analytics_storage: 'denied' }])
      expect(
        await page.evaluate(
          () => (window as unknown as Record<string, unknown>)['ga-disable-G-TEST123'],
        ),
      ).toBe(true)
      if (path === '/') {
        await page.evaluate(async () => {
          const modulePath = '/src/analytics/ga.ts'
          const ga = await import(modulePath)
          ga.trackEvent('click_depois_revogacao')
          ga.trackPageView(
            {
              page_location: location.origin + '/entrar',
              page_title: 'Entrar',
            },
            location.origin,
          )
        })
      }
      expect((await calls()).filter((c) => c[0] === 'event')).toHaveLength(0)
      await page.reload()
      await expect(banner).toBeHidden()
      expect(await page.evaluate(() => localStorage.getItem('palpitae:analytics-consent'))).toMatch(
        /^denied:\d+$/,
      )
      expect(
        (await calls()).filter(
          (c) =>
            c[0] === 'consent' &&
            c[1] === 'update' &&
            (c[2] as { analytics_storage: string }).analytics_storage === 'granted',
        ),
      ).toEqual([])
      await preferences.click()
      await expect(banner).toBeVisible()
    })
  }
}
