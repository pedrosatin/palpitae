import { test, expect } from '@playwright/test'

for (const width of [390, 1440]) {
  for (const path of ['/', '/guias/bolao-do-brasileirao/']) {
    test(`revogação em ${path} ${width}`, async ({ page }, testInfo) => {
      const capture = (name: string) => process.env.CONSENT_CAPTURE_DIR
        ? `${process.env.CONSENT_CAPTURE_DIR}/${name}.png`
        : testInfo.outputPath(`${name}.png`)
      await page.setViewportSize({ width, height: 844 })
      await page.route('https://www.googletagmanager.com/**', (r) => r.fulfill({ body: '' }))
      await page.route('**/api/**', (r) => r.fulfill({ json: {} }))
      await page.goto(path)
      const banner = page.getByRole('dialog', { name: 'Aviso de cookies' })
      await expect(banner).toBeVisible()
      await banner.getByRole('button', { name: 'Recusar' }).click()
      const label = `${path === '/' ? 'spa' : 'guia'}-${width}`
      await page.screenshot({
        path: capture(`${process.env.CAPTURE_BASE ? 'antes' : 'depois'}-${label}`),
        fullPage: true,
      })
      const preferences = page.getByRole('button', {
        name: 'Preferências de cookies',
      })
      await preferences.click({ timeout: 3000 })
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
      const count = (await calls()).length
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
      expect((await calls()).length).toBe(count)
      await page.reload()
      await expect(banner).toBeHidden()
      expect(await page.evaluate(() => localStorage.getItem('palpitae:analytics-consent'))).toMatch(
        /^denied:\d+$/,
      )
      expect((await calls()).filter((c) => c[0] === 'consent' && c[1] === 'update')).toEqual([])
      await preferences.click()
      await expect(banner).toBeVisible()
      await page.screenshot({
        path: capture(`preferencias-${label}`),
        fullPage: true,
      })
    })
  }
}
