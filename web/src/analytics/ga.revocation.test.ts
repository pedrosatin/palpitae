// @vitest-environment-options {"url":"https://app.palpitae.test"}
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config', () => ({ config: { gaMeasurementId: 'G-TEST123' } }))

afterEach(() => {
  localStorage.clear()
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('revogação do GA', () => {
  it('sem gtag.js carregado, bloqueia evento e page_view após revogar e atualiza a página com set, mesmo com storage bloqueado', async () => {
    const { setConsent, trackEvent, trackPageView } = await import('./ga')
    window.gtag = vi.fn()
    setConsent('granted')
    trackEvent('antes')
    expect(window.gtag).toHaveBeenCalledWith('event', 'antes', undefined)
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    setConsent('denied')
    vi.mocked(window.gtag).mockClear()
    trackEvent('depois')
    trackPageView({ page_location: 'http://localhost/entrar', page_title: 'Entrar' }, '')
    expect(window.gtag).toHaveBeenCalledExactlyOnceWith('set', {
      page_location: 'http://localhost/entrar',
      page_title: 'Entrar',
      page_referrer: '',
    })
    storage.mockRestore()
    setConsent('granted')
    trackEvent('retomado')
    expect(window.gtag).toHaveBeenCalledWith('event', 'retomado', undefined)
  })

  it('apaga cookies do host e do domínio pai sem apagar os demais', async () => {
    const { setConsent } = await import('./ga')
    for (const domain of ['', '; domain=palpitae.test']) {
      document.cookie = `_ga=GA1.1.123.456; path=/${domain}`
      document.cookie = `_ga_TEST123=GS2.1.123; path=/${domain}`
    }
    document.cookie = 'preferencia=escuro; path=/'
    setConsent('granted')
    expect(document.cookie).toContain('_ga=')
    setConsent('denied')
    expect(document.cookie).not.toMatch(/(?:^|; )_ga(?:_TEST123)?=/)
    expect(document.cookie).toContain('preferencia=escuro')
  })
})
