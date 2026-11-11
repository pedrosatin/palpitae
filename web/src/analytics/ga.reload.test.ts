// @vitest-environment-options {"url":"https://app.palpitae.test"}
import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyticsHead, consentBanner } from '../../build/analytics'

vi.mock('../config', () => ({ config: { gaMeasurementId: 'G-TEST123' } }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  vi.resetModules()
})

for (const client of ['SPA', 'guia']) {
  describe(`reload do consentimento na ${client}`, () => {
    it.each([
      { previous: 'granted', blocked: false, shouldReload: true },
      { previous: null, blocked: false, shouldReload: false },
      { previous: 'denied', blocked: false, shouldReload: false },
      { previous: 'granted', blocked: true, shouldReload: false },
    ] as const)(
      '$previous → denied, storage bloqueado $blocked',
      async ({ previous, blocked, shouldReload }) => {
        if (previous) localStorage.setItem('palpitae:analytics-consent', previous)
        const order: string[] = []
        const reload = vi.fn(() => {
          order.push('reload')
        })
        const browser = {
          location: {
            origin: location.origin,
            pathname: '/',
            search: '',
            hostname: location.hostname,
            reload,
          },
          google_tag_manager: {},
          dataLayer: [] as unknown[],
          gtag: (..._args: unknown[]) => {},
          requestIdleCallback: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }
        vi.stubGlobal('window', browser)
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
        let deny: () => void
        if (client === 'SPA') {
          const ga = await import('./ga')
          ga.initGa()
          deny = () => ga.setConsent('denied')
        } else {
          document.body.innerHTML = consentBanner('G-TEST123')
          const script = analyticsHead('G-TEST123').slice('<script>'.length, -'</script>'.length)
          new Function('window', 'location', 'gtag', script)(
            browser,
            browser.location,
            (...args: unknown[]) => browser.gtag(...args),
          )
          deny = () =>
            (document.querySelector('#cookie-consent .reject') as HTMLButtonElement).click()
        }
        const original = browser.gtag
        const update = vi.spyOn(browser, 'gtag').mockImplementation((...args) => {
          order.push('update')
          original(...args)
        })
        vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
          order.push('cookie')
        })
        if (blocked) {
          vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('bloqueado', 'SecurityError')
          })
          vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('bloqueado', 'SecurityError')
          })
        }
        deny()
        expect(reload).toHaveBeenCalledTimes(shouldReload ? 1 : 0)
        expect(update).toHaveBeenCalledExactlyOnceWith('consent', 'update', {
          analytics_storage: 'denied',
        })
        expect(order[0]).toBe('update')
        expect(order).toContain('cookie')
        if (shouldReload) expect(order.at(-1)).toBe('reload')
      },
    )
  })
}
