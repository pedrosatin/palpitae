import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  API_TIMEOUT_MS,
  VISITOR_API_TIMEOUT_MS,
  forwardedClient,
  loadInvitePreview,
  onRequest,
  planInviteRewrite,
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
  const context = (e: Env) => ({ request: request(), env: e, params: { code: 'nao-e-codigo' } })

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
