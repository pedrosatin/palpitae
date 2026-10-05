// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { guides, renderGuide, renderIndex } from './guides'

const GA_ID = 'G-TEST123'
const CONSENT_KEY = 'palpitae:analytics-consent'

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1]) as Record<string, unknown>,
  )
}

/** Loads a rendered page into the jsdom document and runs its inline scripts. */
function loadPage(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  document.head.innerHTML = doc.head.innerHTML
  document.body.innerHTML = doc.body.innerHTML
  for (const s of doc.querySelectorAll('script:not([type])')) {
    // eslint-disable-next-line no-new-func
    new Function(s.textContent ?? '')()
  }
}

describe('guide catalog', () => {
  it('has unique slugs, an ISO date and a description of search-snippet length', () => {
    expect(new Set(guides.map((g) => g.slug)).size).toBe(guides.length)
    for (const g of guides) {
      expect(g.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(g.description.length).toBeGreaterThanOrEqual(120)
      expect(g.description.length).toBeLessThanOrEqual(175)
    }
  })

  it('emits a valid FAQPage JSON-LD mirroring the visible FAQ', () => {
    const withFaq = guides.filter((g) => g.faq?.length)
    expect(withFaq.length).toBeGreaterThan(0)
    for (const g of withFaq) {
      const html = renderGuide(g)
      const faq = jsonLdBlocks(html).find((o) => o['@type'] === 'FAQPage')
      expect(faq).toBeDefined()
      expect((faq!.mainEntity as unknown[]).length).toBe(g.faq!.length)
      expect(html).toContain('<h2>Perguntas frequentes</h2>')
    }
  })

  it('lists every guide on the /guias/ index', () => {
    const html = renderIndex()
    for (const g of guides) expect(html).toContain(`href="/guias/${g.slug}/"`)
  })
})

describe('guide analytics (Consent Mode v2)', () => {
  beforeEach(() => {
    localStorage.clear()
    // @ts-expect-error reset globals between page loads
    delete window.dataLayer
    // @ts-expect-error reset globals between page loads
    delete window.gtag
  })
  afterEach(() => localStorage.clear())

  it('emits no GA script and no banner without a measurement id', () => {
    const html = renderGuide(guides[0])
    expect(html).not.toContain('googletagmanager')
    expect(html).not.toContain('cookie-consent')
  })

  it('registers the denied consent default before js/config, then shows the banner', () => {
    loadPage(renderGuide(guides[0], GA_ID))
    const calls = window.dataLayer.map((a) => Array.from(a as ArrayLike<unknown>))
    expect(calls[0]).toEqual([
      'consent',
      'default',
      {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied',
      },
    ])
    expect(calls.map((c) => c[0])).toEqual(['consent', 'js', 'config'])
    expect(calls[2]).toEqual(['config', GA_ID])
    expect(document.getElementById('cookie-consent')!.hidden).toBe(false)
  })

  it('accepting persists "granted" with the app key and updates consent', () => {
    loadPage(renderIndex(GA_ID))
    const banner = document.getElementById('cookie-consent')!
    ;(banner.querySelector('.accept') as HTMLButtonElement).click()
    expect(localStorage.getItem(CONSENT_KEY)).toBe('granted')
    expect(banner.hidden).toBe(true)
    const last = Array.from(window.dataLayer.at(-1) as ArrayLike<unknown>)
    expect(last).toEqual(['consent', 'update', { analytics_storage: 'granted' }])
  })

  it('rejecting stores a timestamped denial, like the app', () => {
    loadPage(renderGuide(guides[0], GA_ID))
    ;(document.querySelector('#cookie-consent .reject') as HTMLButtonElement).click()
    expect(localStorage.getItem(CONSENT_KEY)).toMatch(/^denied:\d+$/)
  })

  it('restores a stored grant right after the default and keeps the banner hidden', () => {
    localStorage.setItem(CONSENT_KEY, 'granted')
    loadPage(renderGuide(guides[0], GA_ID))
    const calls = window.dataLayer.map((a) => Array.from(a as ArrayLike<unknown>))
    expect(calls[1]).toEqual(['consent', 'update', { analytics_storage: 'granted' }])
    expect(document.getElementById('cookie-consent')!.hidden).toBe(true)
  })

  it('shows the banner again once a denial is older than 30 days', () => {
    localStorage.setItem(CONSENT_KEY, `denied:${Date.now() - 31 * 24 * 60 * 60 * 1000}`)
    loadPage(renderGuide(guides[0], GA_ID))
    expect(document.getElementById('cookie-consent')!.hidden).toBe(false)
    expect(localStorage.getItem(CONSENT_KEY)).toBeNull()
  })
})
