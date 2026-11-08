// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import * as miniflare from 'miniflare'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  API_TIMEOUT_MS,
  API_CACHE_TTL_S,
  API_MISS_CACHE_TTL_S,
  VISITOR_API_TIMEOUT_MS,
  buildInviteMeta,
  fetchInvitePreview,
  isPreviewCrawler,
  normalizeInviteCode,
  serializeInviteEmbed,
} from '../../functions/convite/[code]'

const FUNCTION_PATH = fileURLToPath(new URL('../../functions/convite/[code].ts', import.meta.url))
const INDEX_HTML = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')

const GENERIC_TITLE = 'Palpitae | Bolão de futebol online grátis com os amigos'

function apiJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const OK_BODY = {
  invite: {
    group_name: 'Os Craques',
    competition_name: 'Brasileirão 2026',
    member_count: 7,
    admin_name: 'Pedro',
    points_exact: 3,
    points_winner: 1,
  },
}

const OK_PREVIEW = {
  groupName: 'Os Craques',
  competitionName: 'Brasileirão 2026',
  memberCount: 7,
  adminName: 'Pedro',
  pointsExact: 3,
  pointsWinner: 1,
}

describe('normalizeInviteCode', () => {
  it('accepts the XXXX-XXXX format in any case', () => {
    expect(normalizeInviteCode('abcd-ef23')).toBe('ABCD-EF23')
    expect(normalizeInviteCode(['ABCD-EF23'])).toBe('ABCD-EF23')
  })

  it.each([undefined, '', 'ABC', 'ABCDEFGH', 'ABCD-EF2<', '../../etc', 'ABCD-EF01', 'IOAB-CD23'])(
    'rejects %s',
    (raw) => {
      expect(normalizeInviteCode(raw)).toBeNull()
    },
  )
})

describe('isPreviewCrawler', () => {
  it.each([
    'WhatsApp/2.23.20.0 A',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (compatible; Twitterbot/1.0)',
    'TelegramBot (like TwitterBot)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'LinkedInBot/1.0 (compatible; Mozilla/5.0)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Applebot/0.1',
    'Mozilla/5.0 (compatible; Embedly/0.2)',
    'SkypeUriPreview Preview/0.5',
    'Iframely/1.3.1 (+https://iframely.com/docs/about)',
    'Mozilla/5.0 (compatible; SomeNewBot/1.0)',
  ])('detects %s', (ua) => {
    expect(isPreviewCrawler(ua)).toBe(true)
  })

  it.each([
    null,
    '',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  ])('treats %s as a person', (ua) => {
    expect(isPreviewCrawler(ua)).toBe(false)
  })
})

describe('buildInviteMeta', () => {
  it('builds title and description from the group data', () => {
    expect(buildInviteMeta(OK_PREVIEW)).toEqual({
      title: 'Entra no bolão "Os Craques" no Palpitae',
      description: 'Brasileirão 2026 · 7 participantes · grátis, sem apostas',
    })
  })

  it('uses the singular for one member and skips a missing competition', () => {
    expect(
      buildInviteMeta({ ...OK_PREVIEW, groupName: 'Solo', competitionName: null, memberCount: 1 })
        ?.description,
    ).toBe('1 participante · grátis, sem apostas')
  })

  it('identifies the invite even without group data', () => {
    expect(buildInviteMeta(null)?.title).toContain('convite')
  })
})

describe('serializeInviteEmbed', () => {
  it('preserva aspas e entidades do nome num valor seguro para atributo', () => {
    const groupName = 'A&quot;B "<script>"'
    const value = serializeInviteEmbed('ABCD-EF23', { ...OK_PREVIEW, groupName })

    expect(value).not.toMatch(/[&"<>]/)
    expect(JSON.parse(decodeURIComponent(value))).toEqual({
      code: 'ABCD-EF23',
      invite: { ...OK_BODY.invite, group_name: groupName },
    })
  })
})

describe('fetchInvitePreview', () => {
  it('calls the public endpoint and maps the response', async () => {
    const fetchImpl = vi.fn(async () => apiJson(OK_BODY))

    const preview = await fetchInvitePreview('ABCD-EF23', 'https://api.test/', fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/public/invites/ABCD-EF23',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        cf: {
          cacheEverything: true,
          cacheTtlByStatus: {
            '200-299': API_CACHE_TTL_S,
            '404': API_MISS_CACHE_TTL_S,
            '429': 0,
            '500-599': 0,
          },
        },
      }),
    )
    expect(preview).toEqual(OK_PREVIEW)
  })

  it('mapeia admin e pontuação ausentes para null', async () => {
    const preview = await fetchInvitePreview('ABCD-EF23', 'https://api.test', async () =>
      apiJson({ invite: { group_name: 'Antigo', competition_name: null, member_count: 2 } }),
    )

    expect(preview).toEqual({
      groupName: 'Antigo',
      competitionName: null,
      memberCount: 2,
      adminName: null,
      pointsExact: null,
      pointsWinner: null,
    })
  })

  it('forwards the visitor IP and the proxy secret only when given', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => apiJson(OK_BODY))

    await fetchInvitePreview('ABCD-EF23', 'https://api.test', fetchImpl, API_TIMEOUT_MS, {
      clientIp: '198.51.100.7',
      secret: 'proxy-secret',
    })
    await fetchInvitePreview('ABCD-EF23', 'https://api.test', fetchImpl)

    const [withForward, without] = fetchImpl.mock.calls.map(
      ([, init]) => init?.headers as Record<string, string>,
    )
    expect(withForward).toMatchObject({
      'X-Palpitae-Client-IP': '198.51.100.7',
      'X-Palpitae-Proxy-Secret': 'proxy-secret',
    })
    expect(without).toEqual({ Accept: 'application/json' })
  })

  it.each([
    ['404', () => apiJson({ error: 'Convite não encontrado' }, 404)],
    ['500', () => apiJson({ error: 'x' }, 500)],
    ['malformed body', () => apiJson({ invite: { group_name: 42 } })],
    ['non-JSON body', () => new Response('<html>', { status: 200 })],
  ])('returns null on %s', async (_label, respond) => {
    const preview = await fetchInvitePreview('ABCD-EF23', 'https://api.test', async () => respond())
    expect(preview).toBeNull()
  })

  it('returns null on network error', async () => {
    const preview = await fetchInvitePreview('ABCD-EF23', 'https://api.test', async () => {
      throw new TypeError('fetch failed')
    })
    expect(preview).toBeNull()
  })

  it('aborts after the timeout and returns null', async () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const fetchImpl = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init?.signal ?? undefined
            signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      )

      const pending = fetchInvitePreview('ABCD-EF23', 'https://api.test', fetchImpl as typeof fetch)
      await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS)

      await expect(pending).resolves.toBeNull()
      expect(signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * Roda a Function de verdade no workerd (via Miniflare, que vem com o
 * wrangler), com o HTMLRewriter real. ASSETS devolve o index.html do repo e a
 * API é simulada pelo `outboundService`.
 */
describe('onRequest (workerd)', () => {
  let mf: miniflare.Miniflare
  let apiHandler: (req: Request) => Response | Promise<Response> = () => apiJson(OK_BODY)
  const apiCalls: string[] = []

  beforeAll(async () => {
    const bundle = await build({
      stdin: {
        contents: `
          import { onRequest } from ${JSON.stringify(FUNCTION_PATH)}
          export default {
            fetch(request, env) {
              const code = new URL(request.url).pathname.split('/')[2]
              return onRequest({ request, env, params: { code: decodeURIComponent(code ?? '') } })
            },
          }
        `,
        resolveDir: process.cwd(),
        loader: 'js',
      },
      bundle: true,
      format: 'esm',
      write: false,
      target: 'es2022',
    })

    const options = {
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-05-10',
      bindings: { API_URL: 'https://api.test' },
      serviceBindings: {
        ASSETS: async (req: Request) => {
          if (new URL(req.url).pathname !== '/') return new Response('not found', { status: 404 })
          return new Response(INDEX_HTML, {
            headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"abc"' },
          })
        },
      },
      outboundService: async (req: Request) => {
        apiCalls.push(req.url)
        return apiHandler(req)
      },
    }
    // O Miniflare 5 (alpha, trazido pelo wrangler) mudou o formato das opções e
    // expõe o conversor do formato antigo; o 4 aceita o formato antigo direto.
    const convert = (miniflare as { convertV4MiniflareOptions?: (o: unknown) => unknown })
      .convertV4MiniflareOptions
    mf = new miniflare.Miniflare(
      (convert ? convert(options) : options) as ConstructorParameters<
        typeof miniflare.Miniflare
      >[0],
    )
    await mf.ready
  }, 30_000)

  afterAll(async () => {
    await mf?.dispose()
  })

  const WHATSAPP_UA = 'WhatsApp/2.23.20.0 A'
  const BROWSER_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

  async function get(path: string, userAgent: string = WHATSAPP_UA) {
    apiCalls.length = 0
    const res = await mf.dispatchFetch(`https://palpitae.com.br${path}`, {
      headers: { 'User-Agent': userAgent },
    })
    return { res, html: await res.text() }
  }

  function embeddedInvite(html: string) {
    const match = html.match(/data-convite="([^"]*)"/)
    return match ? JSON.parse(decodeURIComponent(match[1])) : null
  }

  function metaContent(html: string, attr: 'name' | 'property', key: string) {
    const match = html.match(new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`))
    return match?.[1]
  }

  it('rewrites title, description, og and twitter tags with the group data', async () => {
    apiHandler = () => apiJson(OK_BODY)

    const { res, html } = await get('/convite/abcd-ef23')

    expect(res.status).toBe(200)
    expect(apiCalls).toEqual(['https://api.test/public/invites/ABCD-EF23'])
    const title = 'Entra no bolão "Os Craques" no Palpitae'
    const description = 'Brasileirão 2026 · 7 participantes · grátis, sem apostas'
    expect(html).toContain(`<title>${title}</title>`)
    expect(metaContent(html, 'name', 'description')).toBe(description)
    expect(metaContent(html, 'property', 'og:title')).toBe(title.replaceAll('"', '&quot;'))
    expect(metaContent(html, 'property', 'og:description')).toBe(description)
    expect(metaContent(html, 'property', 'og:url')).toBe(
      'https://palpitae.com.br/convite/ABCD-EF23',
    )
    expect(metaContent(html, 'name', 'twitter:title')).toBe(title.replaceAll('"', '&quot;'))
    expect(metaContent(html, 'name', 'twitter:description')).toBe(description)
    expect(metaContent(html, 'property', 'og:image')).toBe('https://palpitae.com.br/og-convite.png')
    expect(metaContent(html, 'name', 'twitter:image')).toBe(
      'https://palpitae.com.br/og-convite.png',
    )
    expect(metaContent(html, 'property', 'og:image:alt')).toContain('Convite')
    expect(metaContent(html, 'name', 'twitter:image:alt')).toContain('Convite')
    // O resto da SPA segue intacto.
    expect(html).toContain('<div id="root"')
  })

  it('marks the page noindex and drops the canonical', async () => {
    apiHandler = () => apiJson(OK_BODY)

    const { res, html } = await get('/convite/ABCD-EF23')

    expect(metaContent(html, 'name', 'robots')).toBe('noindex')
    expect(html).not.toContain('rel="canonical"')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
    expect(res.headers.get('ETag')).toBeNull()
  })

  it('escapes a group name with markup', async () => {
    apiHandler = () =>
      apiJson({
        invite: { group_name: '<script>x</script>"', competition_name: null, member_count: 2 },
      })

    const { html } = await get('/convite/ABCD-EF23')

    // Dentro de atributo entre aspas, `<` é inofensivo; o que importa é a aspa
    // virar &quot;. Fora dos atributos, nenhuma tag nova pode aparecer.
    expect(html.replace(/content="[^"]*"/g, '')).not.toContain('<script>x</script>')
    expect(html).toContain(
      '<title>Entra no bolão "&lt;script&gt;x&lt;/script&gt;"" no Palpitae</title>',
    )
    expect(metaContent(html, 'property', 'og:title')).toBe(
      'Entra no bolão &quot;<script>x</script>&quot;&quot; no Palpitae',
    )
  })

  it.each([
    ['API 404', () => apiJson({ error: 'Convite não encontrado' }, 404)],
    ['API 500', () => apiJson({ error: 'x' }, 500)],
    [
      'API network error',
      () => {
        throw new Error('down')
      },
    ],
  ])('falls back to invite OG on %s (still noindex)', async (_label, handler) => {
    apiHandler = handler

    const { res, html } = await get('/convite/ABCD-EF23')

    expect(res.status).toBe(200)
    expect(metaContent(html, 'property', 'og:title')).toContain('convite')
    expect(metaContent(html, 'property', 'og:image')).toBe('https://palpitae.com.br/og-convite.png')
    expect(metaContent(html, 'name', 'robots')).toBe('noindex')
  })

  it('falls back to invite OG when the API is slower than the timeout', async () => {
    apiHandler = () =>
      new Promise((resolve) => setTimeout(() => resolve(apiJson(OK_BODY)), API_TIMEOUT_MS + 1000))

    const started = Date.now()
    const { res, html } = await get('/convite/ABCD-EF23')

    expect(res.status).toBe(200)
    expect(Date.now() - started).toBeLessThan(API_TIMEOUT_MS + 900)
    expect(metaContent(html, 'property', 'og:title')).toContain('convite')
  }, 10_000)

  it('entrega à pessoa o título, a descrição e os dados embutidos, com noindex', async () => {
    apiHandler = () => apiJson(OK_BODY)

    const { res, html } = await get('/convite/abcd-ef23', BROWSER_UA)

    expect(res.status).toBe(200)
    expect(apiCalls).toEqual(['https://api.test/public/invites/ABCD-EF23'])
    expect(html).toContain('<title>Entra no bolão "Os Craques" no Palpitae</title>')
    expect(metaContent(html, 'name', 'description')).toBe(
      'Brasileirão 2026 · 7 participantes · grátis, sem apostas',
    )
    expect(metaContent(html, 'name', 'robots')).toBe('noindex')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex')
    expect(embeddedInvite(html)).toEqual({ code: 'ABCD-EF23', invite: OK_BODY.invite })
  })

  it('deixa o nome do admin fora do HTML do crawler', async () => {
    apiHandler = () => apiJson(OK_BODY)

    const { html } = await get('/convite/ABCD-EF23')

    expect(html).not.toContain('data-convite')
    expect(html).not.toContain('Pedro')
  })

  it.each([
    ['API 404', () => apiJson({ error: 'Convite não encontrado' }, 404)],
    ['API 429', () => apiJson({ error: 'Muitas requisições' }, 429)],
    ['API 500', () => apiJson({ error: 'x' }, 500)],
  ])(
    'entrega à pessoa o texto genérico de convite, sem dados embutidos, em %s',
    async (_l, handler) => {
      apiHandler = handler

      const { res, html } = await get('/convite/ABCD-EF23', BROWSER_UA)

      expect(res.status).toBe(200)
      expect(html).toContain('<title>Você recebeu um convite para um bolão no Palpitae</title>')
      expect(html).not.toContain('data-convite')
    },
  )

  it('não segura o HTML da pessoa além do tempo limite de visitante', async () => {
    apiHandler = () =>
      new Promise((resolve) => setTimeout(() => resolve(apiJson(OK_BODY)), API_TIMEOUT_MS + 1000))

    const started = Date.now()
    const { res, html } = await get('/convite/ABCD-EF23', BROWSER_UA)

    expect(res.status).toBe(200)
    expect(Date.now() - started).toBeLessThan(VISITOR_API_TIMEOUT_MS + 600)
    expect(html).not.toContain('data-convite')
    expect(html).toContain('<title>Você recebeu um convite')
  }, 10_000)

  it.each([
    ['crawler', WHATSAPP_UA],
    ['pessoa', BROWSER_UA],
  ])('não chama a API para código malformado aberto por %s', async (_label, userAgent) => {
    apiHandler = () => apiJson(OK_BODY)

    const { res, html } = await get('/convite/nao-e-codigo', userAgent)

    expect(res.status).toBe(200)
    expect(apiCalls).toEqual([])
    expect(html).toContain(`<title>${GENERIC_TITLE}</title>`)
    expect(html).not.toContain('data-convite')
    expect(metaContent(html, 'name', 'robots')).toBe('noindex')
  })
})
