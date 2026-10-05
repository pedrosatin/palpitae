// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { LANDING_GUIDE_LINKS } from '../src/pages/LandingPage/guideLinks'
import { normalizeGaId } from './analytics'
import { guides, renderGuide, renderIndex, renderLlmsTxt } from './guides'
import { extractLocs, HOST, KEY, KEY_LOCATION } from '../scripts/indexnow.mjs'

const GA_ID = 'G-TEST123'
const CONSENT_KEY = 'palpitae:analytics-consent'

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1]) as Record<string, unknown>,
  )
}

/** Same escaping the renderer applies to visible text. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
      const entities = faq!.mainEntity as {
        '@type': string
        name: string
        acceptedAnswer: { '@type': string; text: string }
      }[]
      expect(entities.length).toBe(g.faq!.length)
      expect(html).toContain('<h2>Perguntas frequentes</h2>')
      g.faq!.forEach((f, i) => {
        expect(entities[i]['@type']).toBe('Question')
        expect(entities[i].name).toBe(f.question)
        expect(entities[i].acceptedAnswer).toEqual({ '@type': 'Answer', text: f.answer })
        expect(html).toContain(`<h3>${escapeHtml(f.question)}</h3>`)
        expect(html).toContain(`<p>${escapeHtml(f.answer)}</p>`)
      })
    }
  })

  it('lists every guide on the /guias/ index', () => {
    const html = renderIndex()
    for (const g of guides) expect(html).toContain(`href="/guias/${g.slug}/"`)
  })
  it('separates published from updated, with published never after updated', () => {
    for (const g of guides) {
      expect(g.published).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(g.published <= g.updated, g.slug).toBe(true)
    }
  })

  it('emits an Article with datePublished <= dateModified and an absolute image', () => {
    for (const g of guides) {
      const article = jsonLdBlocks(renderGuide(g)).find((o) => o['@type'] === 'Article')
      expect(article).toBeDefined()
      expect(article!.datePublished).toBe(g.published)
      expect(article!.dateModified).toBe(g.updated)
      expect((article!.datePublished as string) <= (article!.dateModified as string)).toBe(true)
      expect(article!.image).toBe('https://palpitae.com.br/og-image.png')
    }
  })
})

describe('llms.txt', () => {
  it('lists every guide as a Markdown link with absolute URL and summary', () => {
    const txt = renderLlmsTxt()
    for (const g of guides) {
      expect(txt).toContain(
        `- [${g.title}](https://palpitae.com.br/guias/${g.slug}/): ${g.description}`,
      )
    }
  })

  it('states what Palpitae is and is not', () => {
    const txt = renderLlmsTxt()
    expect(txt).toContain('gratuito')
    expect(txt).toContain('não é casa de apostas')
    expect(txt).toContain('grupo privado')
    expect(txt).toContain('Brasileirão Série A')
    expect(txt).not.toMatch(/maio|dezembro/i)
  })
})

describe('landing guide links', () => {
  it('points only to guides that exist in the catalog', () => {
    const slugs = new Set(guides.map((g) => g.slug))
    expect(LANDING_GUIDE_LINKS.length).toBeGreaterThanOrEqual(3)
    for (const link of LANDING_GUIDE_LINKS) expect(slugs.has(link.slug), link.slug).toBe(true)
  })
})

/**
 * A Copa do Mundo 2026 terminou. Texto público que cita essa edição precisa
 * estar no passado, e nenhum texto pode apresentar a Copa como campeonato
 * disponível no app.
 *
 * A regex `terminou|encerrad` é intencional: toda frase que cita a Copa 2026
 * precisa conter um desses verbos no passado. Ao reescrever esses textos,
 * mantenha um deles na mesma frase ou atualize a regex junto.
 */
describe('Copa do Mundo 2026 no passado', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const catalogText = guides
    .flatMap((g) => [
      g.title,
      g.teaser,
      g.description,
      g.intro,
      ...g.sections.flatMap((s) => [s.heading, ...s.body]),
      ...(g.faq ?? []).flatMap((f) => [f.question, f.answer]),
    ])
    .join('\n')
  const sources: [string, string][] = [
    ['guides catalog', catalogText],
    ['llms.txt', renderLlmsTxt()],
    ['index.html', read('../index.html')],
    ['LandingPage.tsx', read('../src/pages/LandingPage/LandingPage.tsx')],
    ['site.webmanifest', read('../public/site.webmanifest')],
  ]

  it.each(sources)('%s não trata a Copa 2026 como atual', (_name, text) => {
    const sentences = text.split(/(?<=[.!?])\s+|\n/)
    for (const sentence of sentences) {
      if (/Copa( do Mundo)? 2026/.test(sentence)) {
        expect(sentence, sentence).toMatch(/terminou|encerrad/)
      }
      expect(sentence, sentence).not.toMatch(
        /(Palpitae|app)\b[^.]*\b(cobre|suporta|tem)\b[^.]*Copa/i,
      )
      expect(sentence, sentence).not.toMatch(/Copa[^.]*(disponíve(l|is)|em andamento)/i)
    }
  })
})

describe('IndexNow', () => {
  it('publishes the key file with the key as its only content', () => {
    expect(KEY).toMatch(/^[0-9a-f]{32}$/)
    // Caminho numa variável: o Vite reescreve `new URL(`...${x}`, import.meta.url)`
    // literal como import de asset, e a leitura apontaria para outro lugar.
    const keyFile = `../public/${KEY}.txt`
    expect(readFileSync(new URL(keyFile, import.meta.url), 'utf8').trim()).toBe(KEY)
    expect(KEY_LOCATION).toBe(`https://${HOST}/${KEY}.txt`)
  })

  it('extracts unique same-host <loc> URLs from the sitemap', () => {
    const xml = `<urlset>
      <url><loc>https://palpitae.com.br/</loc></url>
      <url><loc> https://palpitae.com.br/guias/ </loc></url>
      <url><loc>https://palpitae.com.br/</loc></url>
      <url><loc>https://outro.example/</loc></url>
    </urlset>`
    expect(extractLocs(xml)).toEqual(['https://palpitae.com.br/', 'https://palpitae.com.br/guias/'])
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

  it('emits nothing for a malformed or malicious measurement id', () => {
    for (const id of ["G-X';alert(1)//", 'UA-12345-1', 'g-test123', 'G-TEST123 ']) {
      const html = renderGuide(guides[0], id)
      expect(html).not.toContain('googletagmanager')
      expect(html).not.toContain('cookie-consent')
      expect(html).not.toContain('alert(1)')
      expect(renderIndex(id)).not.toContain('googletagmanager')
    }
  })

  it('normalizes the env id: trims it and warns when it is not a GA4 id', () => {
    const warn = vi.fn()
    expect(normalizeGaId('  G-TEST123\n', warn)).toBe('G-TEST123')
    expect(normalizeGaId('', warn)).toBe('')
    expect(normalizeGaId('   ', warn)).toBe('')
    expect(warn).not.toHaveBeenCalled()
    expect(normalizeGaId("G-X';alert(1)//", warn)).toBe('')
    expect(warn).toHaveBeenCalledOnce()
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
  it('keeps the banner hidden for the legacy plain "denied" value', () => {
    localStorage.setItem(CONSENT_KEY, 'denied')
    loadPage(renderGuide(guides[0], GA_ID))
    expect(document.getElementById('cookie-consent')!.hidden).toBe(true)
    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied')
  })

  it('keeps the banner hidden while a denial is younger than 30 days', () => {
    const value = `denied:${Date.now() - 29 * 24 * 60 * 60 * 1000}`
    localStorage.setItem(CONSENT_KEY, value)
    loadPage(renderGuide(guides[0], GA_ID))
    expect(document.getElementById('cookie-consent')!.hidden).toBe(true)
    expect(localStorage.getItem(CONSENT_KEY)).toBe(value)
  })

  it('shows the banner without throwing when localStorage is unavailable', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    try {
      expect(() => loadPage(renderGuide(guides[0], GA_ID))).not.toThrow()
      const banner = document.getElementById('cookie-consent')!
      expect(banner.hidden).toBe(false)
      expect(() => (banner.querySelector('.accept') as HTMLButtonElement).click()).not.toThrow()
      expect(banner.hidden).toBe(true)
    } finally {
      get.mockRestore()
      set.mockRestore()
    }
  })
})
