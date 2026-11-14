import { afterEach, describe, expect, it, vi } from 'vitest'
// Lê com `?raw` do Vite porque o tsconfig do web não inclui os tipos do Node.
import headersFile from '../../public/_headers?raw'
import { onRequest, type Env } from '../../functions/convite/[code]'

/**
 * O Pages aplica o `_headers` só aos assets. A resposta de uma Function não
 * passa por ele, então a Function de convite precisa devolver os cabeçalhos de
 * segurança por conta própria. A regra `/*` do `_headers` é a referência: o
 * teste lê o arquivo e exige cada linha em todas as respostas da Function.
 */
function globalRuleHeaders(file: string): Record<string, string> {
  const rule: Record<string, string> = {}
  let inGlobalRule = false
  for (const raw of file.split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    if (!/^\s/.test(raw)) {
      inGlobalRule = raw.trim() === '/*'
      continue
    }
    if (!inGlobalRule) continue
    const separator = raw.indexOf(':')
    rule[raw.slice(0, separator).trim()] = raw.slice(separator + 1).trim()
  }
  return rule
}

const EXPECTED = globalRuleHeaders(headersFile)

afterEach(() => {
  vi.unstubAllGlobals()
})

function env(shell: () => Response | Promise<Response>): Env {
  return { ASSETS: { fetch: async () => shell() }, API_URL: 'https://api.test' }
}

function call(e: Env, code = 'ABCD-EF23') {
  return onRequest({
    request: new Request(`https://palpitae.com.br/convite/${code}`),
    env: e,
    params: { code },
    waitUntil: vi.fn(),
  })
}

function stubRewriter() {
  vi.stubGlobal(
    'HTMLRewriter',
    class {
      on() {
        return this
      }
      transform(r: Response) {
        return r
      }
    },
  )
}

function expectSecurityHeaders(res: Response) {
  for (const [name, value] of Object.entries(EXPECTED)) {
    expect(res.headers.get(name), name).toBe(value)
  }
}

describe('cabeçalhos de segurança da Function de convite', () => {
  it('lê a regra /* do _headers', () => {
    expect(Object.keys(EXPECTED)).toEqual(
      expect.arrayContaining([
        'Strict-Transport-Security',
        'X-Content-Type-Options',
        'X-Frame-Options',
        'Referrer-Policy',
        'Permissions-Policy',
        'Content-Security-Policy',
      ]),
    )
    expect(EXPECTED['Content-Security-Policy']).toContain("frame-ancestors 'none'")
  })

  it('HTML reescrito (200)', async () => {
    stubRewriter()
    const res = await call(env(() => new Response('<html></html>')))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex')
    expectSecurityHeaders(res)
  })

  it('código inválido (200 com o OG da home)', async () => {
    stubRewriter()
    const res = await call(env(() => new Response('<html></html>')), 'nao-e-codigo')
    expect(res.status).toBe(200)
    expectSecurityHeaders(res)
  })

  it('reescrita que falha devolve o shell com os cabeçalhos', async () => {
    vi.stubGlobal('HTMLRewriter', undefined)
    const res = await call(env(() => new Response('<html></html>')))
    expect(res.status).toBe(200)
    expectSecurityHeaders(res)
  })

  it.each([404, 500, 503])('shell do asset com status %i', async (status) => {
    const res = await call(env(() => new Response('erro', { status })))
    expect(res.status).toBe(status)
    expectSecurityHeaders(res)
  })

  it('redirect do asset mantém status e Location', async () => {
    const res = await call(
      env(() => new Response(null, { status: 302, headers: { Location: '/outro' } })),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/outro')
    expectSecurityHeaders(res)
  })

  it('sobrescreve um cabeçalho mais fraco vindo do asset', async () => {
    stubRewriter()
    const res = await call(
      env(
        () =>
          new Response('<html></html>', {
            headers: { 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src *" },
          }),
      ),
    )
    expectSecurityHeaders(res)
  })
})
