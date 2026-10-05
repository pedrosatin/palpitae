import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import indexHtml from '../index.html?raw'

/**
 * Executa no jsdom os scripts inline do `index.html`, os mesmos que o navegador
 * roda antes do bundle: o do `<head>` decide se a landing pré-renderizada fica
 * e reescreve `/convite/CODE` para `/?convite=CODE`; o do fim do `<body>`
 * esvazia o `#root` quando a landing não deve aparecer.
 */
const inlineScripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
const [headScript, bodyScript] = inlineScripts

const KNOWN_SESSION_KEY = 'palpitae:sessao-conhecida'

function visit(path: string) {
  window.history.replaceState(null, '', path)
}

function runHead() {
  new Function(headScript)()
}

/** Monta o #root como o build entrega (landing embutida) e roda o script do body. */
function runBody() {
  document.body.innerHTML = '<div id="root" data-prerender="landing"><main>landing</main></div>'
  new Function(bodyScript)()
  return document.getElementById('root')!
}

function currentUrl() {
  return window.location.pathname + window.location.search + window.location.hash
}

describe('index.html inline scripts', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('descartar-prerender')
  })

  afterEach(() => {
    visit('/')
    document.body.innerHTML = ''
  })

  it('finds both inline scripts', () => {
    expect(inlineScripts).toHaveLength(2)
    expect(headScript).toContain('descartar-prerender')
    expect(bodyScript).toContain('data-prerender')
  })

  it('keeps the pre-rendered landing at "/" for a new visitor', () => {
    visit('/')
    runHead()
    const root = runBody()

    expect(root.dataset.prerender).toBe('landing')
    expect(root.textContent).toBe('landing')
  })

  it('rewrites /convite/CODE to /?convite=CODE and keeps the landing for hydration', () => {
    visit('/convite/abcd-ef23')
    runHead()

    expect(currentUrl()).toBe('/?convite=abcd-ef23')
    const root = runBody()
    expect(root.dataset.prerender).toBe('landing')
    expect(root.textContent).toBe('landing')
  })

  it('keeps other query params and the hash, and drops a stale convite param', () => {
    visit('/convite/ABCD-EF23/?utm_source=whatsapp&convite=OLD1-OLD2#topo')
    runHead()

    expect(currentUrl()).toBe('/?convite=ABCD-EF23&utm_source=whatsapp#topo')
  })

  it('discards the landing on an invite link when the device had a session', () => {
    localStorage.setItem(KNOWN_SESSION_KEY, '1')
    visit('/convite/ABCD-EF23')
    runHead()

    expect(currentUrl()).toBe('/?convite=ABCD-EF23')
    const root = runBody()
    expect(root.dataset.prerender).toBeUndefined()
    expect(root.textContent).toBe('')
  })

  it.each(['/convite/', '/convite/abc%3Cx', '/convite/ABCD-EF23/extra'])(
    'leaves %s alone and discards the landing',
    (path) => {
      visit(path)
      const before = currentUrl()
      runHead()

      expect(currentUrl()).toBe(before)
      expect(runBody().dataset.prerender).toBeUndefined()
    },
  )

  it('discards the landing on private routes', () => {
    visit('/grupos/123')
    runHead()

    expect(currentUrl()).toBe('/grupos/123')
    expect(runBody().textContent).toBe('')
  })
})
