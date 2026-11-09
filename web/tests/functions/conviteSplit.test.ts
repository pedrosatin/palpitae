import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  API_TIMEOUT_MS,
  VISITOR_API_TIMEOUT_MS,
  forwardedClient,
  isInviteOpen,
  isPreviewCrawler,
  loadInvitePreview,
  onRequest,
  planInviteRewrite,
  postInviteOpen,
  reportInviteOpen,
  type Env,
  type InvitePreview,
} from '../../functions/convite/[code]'

const PREVIEW: InvitePreview = {
  groupName: 'Os Craques',
  competitionName: 'Brasileirão 2026',
  memberCount: 7,
  adminName: 'Pedro',
  pointsExact: 3,
  pointsWinner: 1,
}

const OK_JSON = {
  invite: { group_name: 'Os Craques', competition_name: null, member_count: 2 },
}

function request(headers: Record<string, string> = {}) {
  return new Request('https://palpitae.com.br/convite/ABCD-EF23', { headers })
}

function env(extra: Partial<Env> = {}, shellStatus = 200): Env {
  return {
    ASSETS: { fetch: async () => new Response('<html></html>', { status: shellStatus }) },
    API_URL: 'https://api.test',
    ...extra,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('forwardedClient', () => {
  it.each([
    ['segredo e IP', { PROXY_SHARED_SECRET: 's' }, { 'CF-Connecting-IP': '1.1.1.1' }, true],
    ['sem segredo', {}, { 'CF-Connecting-IP': '1.1.1.1' }, false],
    ['sem IP', { PROXY_SHARED_SECRET: 's' }, {}, false],
  ])('%s', (_l, extra, headers, expected) => {
    const result = forwardedClient(env(extra), request(headers as Record<string, string>))
    expect(result).toEqual(expected ? { clientIp: '1.1.1.1', secret: 's' } : undefined)
  })
})

describe('loadInvitePreview', () => {
  it('não chama a API sem código', async () => {
    const fetchImpl = vi.fn()
    await expect(
      loadInvitePreview(null, false, env(), request(), fetchImpl as unknown as typeof fetch),
    ).resolves.toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('usa a API padrão quando API_URL falta', async () => {
    const fetchImpl = vi.fn(async () => Response.json(OK_JSON))
    await loadInvitePreview(
      'ABCD-EF23',
      true,
      env({ API_URL: undefined }),
      request(),
      fetchImpl as unknown as typeof fetch,
    )
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://api.palpitae.com.br/public/invites/ABCD-EF23',
    )
  })

  it.each([
    ['pessoa', false, VISITOR_API_TIMEOUT_MS],
    ['crawler', true, API_TIMEOUT_MS],
  ])('%s respeita o tempo limite', async (_l, crawler, timeout) => {
    vi.useFakeTimers()
    let aborted = -1
    const start = Date.now()
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => {
          aborted = Date.now() - start
          reject(new Error('abort'))
        })
      })) as unknown as typeof fetch

    const pending = loadInvitePreview('ABCD-EF23', crawler, env(), request(), fetchImpl)
    await vi.advanceTimersByTimeAsync(timeout)
    await expect(pending).resolves.toBeNull()
    expect(aborted).toBe(timeout)
  })
})

describe('planInviteRewrite', () => {
  it('código inválido mantém o OG da home', () => {
    expect(planInviteRewrite(null, null, false)).toEqual({
      meta: null,
      pageUrl: 'https://palpitae.com.br/',
      embed: null,
    })
  })

  it('pessoa com convite recebe os dados embutidos', () => {
    const plan = planInviteRewrite('ABCD-EF23', PREVIEW, false)
    expect(plan.pageUrl).toBe('https://palpitae.com.br/convite/ABCD-EF23')
    expect(plan.meta?.title).toContain('Os Craques')
    expect(plan.embed).not.toBeNull()
  })

  it('crawler não recebe o nome do admin', () => {
    expect(planInviteRewrite('ABCD-EF23', PREVIEW, true).embed).toBeNull()
  })

  it('sem dados sai o convite genérico, sem embed', () => {
    const plan = planInviteRewrite('ABCD-EF23', null, false)
    expect(plan.meta?.title).toContain('Você recebeu um convite')
    expect(plan.embed).toBeNull()
  })
})

describe('onRequest (Node)', () => {
  const context = (e: Env) => ({
    request: request(),
    env: e,
    params: { code: 'nao-e-codigo' },
    waitUntil: vi.fn(),
  })

  it('devolve o shell quando o asset falha', async () => {
    const res = await onRequest(context(env({}, 503)))
    expect(res.status).toBe(503)
  })

  it('devolve o shell quando a reescrita falha', async () => {
    vi.stubGlobal('HTMLRewriter', undefined)
    const res = await onRequest(context(env()))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Robots-Tag')).toBeNull()
  })

  it('reescreve o HTML no caminho feliz', async () => {
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
    const res = await onRequest(context(env()))
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex')
  })
})

const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const CODE = 'ABCD-EF23'

describe('isInviteOpen', () => {
  const browser = (extra: Record<string, string> = {}, method = 'GET') =>
    new Request(`https://palpitae.com.br/convite/${CODE}`, {
      method,
      headers: { 'User-Agent': BROWSER_UA, ...extra },
    })

  it('conta a navegação de uma pessoa, com ou sem Sec-Fetch-Mode', () => {
    expect(isInviteOpen(browser(), CODE, false)).toBe(true)
    expect(isInviteOpen(browser({ 'Sec-Fetch-Mode': 'navigate' }), CODE, false)).toBe(true)
  })

  it.each([
    ['WhatsApp', 'WhatsApp/2.23.20.0 A'],
    ['Telegram', 'TelegramBot (like TwitterBot)'],
    ['Facebook', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
    ['X', 'Twitterbot/1.0'],
    ['Slack', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['Discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['LinkedIn', 'LinkedInBot/1.0'],
  ])('não conta o crawler de preview do %s', (_name, userAgent) => {
    const req = new Request(`https://palpitae.com.br/convite/${CODE}`, {
      headers: { 'User-Agent': userAgent },
    })

    expect(isPreviewCrawler(userAgent)).toBe(true)
    expect(isInviteOpen(req, CODE, isPreviewCrawler(userAgent))).toBe(false)
  })

  it('não conta cliente que não é navegador nem user-agent vazio', () => {
    for (const userAgent of ['curl/8.9.1', 'python-requests/2.32', '']) {
      const req = new Request(`https://palpitae.com.br/convite/${CODE}`, {
        headers: { 'User-Agent': userAgent },
      })
      expect(isInviteOpen(req, CODE, false)).toBe(false)
    }
  })

  it('não conta HEAD, código inválido nem subrecurso', () => {
    expect(isInviteOpen(browser({}, 'HEAD'), CODE, false)).toBe(false)
    expect(isInviteOpen(browser(), null, false)).toBe(false)
    expect(isInviteOpen(browser({ 'Sec-Fetch-Mode': 'cors' }), CODE, false)).toBe(false)
  })

  it.each([
    ['Sec-Purpose', 'prefetch'],
    ['Sec-Purpose', 'prefetch;prerender'],
    ['Purpose', 'prefetch'],
    ['X-Purpose', 'preview'],
    ['X-Moz', 'prefetch'],
  ])('não conta pré-busca do navegador (%s: %s)', (header, value) => {
    expect(isInviteOpen(browser({ [header]: value }), CODE, false)).toBe(false)
  })
})

describe('postInviteOpen', () => {
  it('não leva o código nem corpo, e repassa IP e segredo', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))

    await postInviteOpen('https://api.test/', { clientIp: '203.0.113.9', secret: 's3' }, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.test/public/invite-opens')
    expect(url).not.toContain(CODE)
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
    expect(init.headers).toEqual({
      'X-Palpitae-Client-IP': '203.0.113.9',
      'X-Palpitae-Proxy-Secret': 's3',
    })
  })

  it('engole falha de rede', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('rede')
    })

    await expect(
      postInviteOpen('https://api.test', { clientIp: '1.1.1.1', secret: 's' }, fetchImpl),
    ).resolves.toBeUndefined()
  })
})

describe('reportInviteOpen', () => {
  const headers = { 'User-Agent': BROWSER_UA, 'CF-Connecting-IP': '203.0.113.9' }

  function ctx(extraEnv: Partial<Env>, extraHeaders: Record<string, string> = headers) {
    const waitUntil = vi.fn()
    return {
      request: request(extraHeaders),
      env: env(extraEnv),
      params: { code: CODE },
      waitUntil,
    }
  }

  it('registra uma abertura em segundo plano', async () => {
    const context = ctx({ PROXY_SHARED_SECRET: 's3' })
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))

    reportInviteOpen(context, CODE, false, fetchImpl)

    expect(context.waitUntil).toHaveBeenCalledTimes(1)
    await context.waitUntil.mock.calls[0][0]
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('não registra sem o segredo do proxy', () => {
    const context = ctx({})
    const fetchImpl = vi.fn()

    reportInviteOpen(context, CODE, false, fetchImpl)

    expect(context.waitUntil).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('não registra crawler', () => {
    const context = ctx({ PROXY_SHARED_SECRET: 's3' })
    const fetchImpl = vi.fn()

    reportInviteOpen(context, CODE, true, fetchImpl)

    expect(context.waitUntil).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('onRequest: funil de convite', () => {
  function rewriterStub() {
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

  function stubApi() {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        return new Response(JSON.stringify(OK_JSON), { status: 200 })
      }),
    )
    return calls
  }

  const navigation = (userAgent: string) => ({
    request: request({ 'User-Agent': userAgent, 'CF-Connecting-IP': '203.0.113.9' }),
    env: env({ PROXY_SHARED_SECRET: 's3' }),
    params: { code: CODE },
    waitUntil: vi.fn(),
  })

  it('uma navegação gera exatamente um aviso de abertura', async () => {
    rewriterStub()
    const calls = stubApi()
    const context = navigation(BROWSER_UA)

    await onRequest(context)
    await Promise.all(context.waitUntil.mock.calls.map(([promise]) => promise))

    expect(calls.filter((url) => url.endsWith('/public/invite-opens'))).toHaveLength(1)
    expect(calls.filter((url) => url.includes(CODE))).toEqual([
      `https://api.test/public/invites/${CODE}`,
    ])
  })

  it('crawler recebe o preview e não conta abertura', async () => {
    rewriterStub()
    const calls = stubApi()
    const context = navigation('WhatsApp/2.23.20.0 A')

    await onRequest(context)

    expect(context.waitUntil).not.toHaveBeenCalled()
    expect(calls.some((url) => url.endsWith('/public/invite-opens'))).toBe(false)
  })

  it('devolve a página mesmo com a API de eventos fora do ar', async () => {
    rewriterStub()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/public/invite-opens')) throw new Error('fora do ar')
        return new Response(JSON.stringify(OK_JSON), { status: 200 })
      }),
    )
    const context = navigation(BROWSER_UA)

    const res = await onRequest(context)
    await Promise.all(context.waitUntil.mock.calls.map(([promise]) => promise))

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex')
  })
})
