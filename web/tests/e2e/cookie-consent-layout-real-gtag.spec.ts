import { test, expect } from '@playwright/test'

// Opt-in: carrega o script público; toda requisição de coleta é abortada.
test.skip(!process.env.REAL_GTAG_ID, 'Defina REAL_GTAG_ID para verificar o cliente público do GA4')

for (const path of ['/', '/guias/bolao-do-brasileirao/']) {
  test(`gtag real interrompe a coleta em ${path}`, async ({ page, context }) => {
    test.setTimeout(60000)
    let revoked = false
    const requests: { revoked: boolean; events: string }[] = []
    await page.exposeFunction('markConsentRevoked', () => { revoked = true })
    await page.addInitScript(() => {
      document.addEventListener(
        'click',
        (event) => {
          const button = (event.target as Element).closest('button')
          if (button?.textContent?.trim() === 'Recusar' && button.closest('[role="dialog"]')) {
            ;(window as unknown as { markConsentRevoked: () => void }).markConsentRevoked()
          }
        },
        true,
      )
    })
    // Bloqueia outros endpoints de dados; só o script público pode sair.
    await page.route(
      /https:\/\/(?!www\.googletagmanager\.com)[^/]*(?:google|doubleclick)[^/]*\//,
      (route) => route.abort(),
    )
    await page.route('https://www.googletagmanager.com/**', (route) =>
      route.request().resourceType() === 'script' ? route.continue() : route.abort(),
    )
    // A rota de coleta precisa ter precedência sobre o bloqueio geral.
    await page.route('**/g/collect*', async (route) => {
      requests.push({
        revoked,
        events:
          new URL(route.request().url()).searchParams.get('en') || route.request().postData() || '',
      })
      await route.abort()
    })
    await page.route('http://app.palpitae.test/**', async (route) => {
      const url = new URL(route.request().url())
      const response = await route.fetch({
        url: `http://localhost:${process.env.CONSENT_TEST_PORT || '5174'}${url.pathname}${url.search}`,
      })
      await route.fulfill({ response })
    })
    await page.route('**/api/**', (route) =>
      route.fulfill({
        json: {},
        headers: {
          'access-control-allow-origin': 'http://app.palpitae.test',
          'access-control-allow-credentials': 'true',
        },
      }),
    )
    await page.goto(`http://app.palpitae.test${path}`)
    const banner = page.getByRole('dialog', { name: 'Aviso de cookies' })
    await banner.getByRole('button', { name: 'Aceitar' }).click()
    await expect
      .poll(() =>
        page.evaluate(
          () => !!(window as unknown as { google_tag_manager?: unknown }).google_tag_manager,
        ),
      )
      .toBe(true)
    await page.evaluate(() => window.gtag('event', 'antes_revogar', { debug_mode: true }))
    await expect.poll(() => requests.length, { timeout: 15000 }).toBeGreaterThan(0)
    const cookiesBefore = (await context.cookies()).filter((cookie) =>
      cookie.name.startsWith('_ga'),
    )
    expect(cookiesBefore.length).toBeGreaterThan(0)
    expect(cookiesBefore.some((cookie) => cookie.domain === '.palpitae.test')).toBe(true)
    // Também cobre cópias antigas restritas ao host.
    await context.addCookies(
      cookiesBefore.map((cookie) => ({ ...cookie, domain: 'app.palpitae.test' })),
    )
    await page.getByRole('button', { name: 'Preferências de cookies' }).click()
    await banner.getByRole('button', { name: 'Recusar' }).click()
    await expect.poll(() => page.evaluate(() => (window.dataLayer || []).map((entry) => Array.from(entry as ArrayLike<unknown>)).filter((c) => c[0] === 'consent' && c[1] === 'update').at(-1)).catch(() => null)).toEqual(['consent', 'update', { analytics_storage: 'denied' }])
    await page.mouse.wheel(0, -10000)
    if (path === '/') {
      await page.getByRole('link', { name: /Ver como funciona/ }).click()
      await page.getByRole('link', { name: 'Entrar', exact: true }).first().click()
    } else {
      await page.getByRole('link', { name: 'Criar bolão', exact: true }).first().click()
    }
    await expect(page).toHaveURL(/\/entrar/)
    await page.getByRole('link', { name: /Conheça o Palpitae/ }).click()
    await expect(page).toHaveURL('http://app.palpitae.test/')
    await page.mouse.wheel(0, 10000)
    await page.waitForTimeout(6000)
    expect(revoked).toBe(true)
    const before = requests.filter((request) => !request.revoked).length
    const after = requests.filter((request) => request.revoked).length
    console.log(
      JSON.stringify({
        path,
        collectBefore: before,
        collectAfter: after,
        afterEvents: requests
          .filter((request) => request.revoked)
          .map((request) => request.events),
        cookiesBefore: cookiesBefore.map((cookie) => cookie.name),
      }),
    )
    expect(after).toBe(0)
    expect((await context.cookies()).filter((cookie) => cookie.name.startsWith('_ga'))).toEqual([])
    await page.getByRole('button', { name: 'Preferências de cookies' }).click()
    await banner.getByRole('button', { name: 'Aceitar' }).click()
    await page.getByRole('link', { name: /Ver como funciona/ }).click()
    await expect
      .poll(async () => (await context.cookies()).find((cookie) => cookie.name === '_ga')?.value)
      .toBeTruthy()
    expect((await context.cookies()).find((cookie) => cookie.name === '_ga')?.value).not.toBe(
      cookiesBefore.find((cookie) => cookie.name === '_ga')?.value,
    )
  })
}
