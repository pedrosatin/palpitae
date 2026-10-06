// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_IP_HEADER, onRequest, PROXY_SECRET_HEADER } from '../../functions/api/[[path]]'

function forwardedHeaders(fetchMock: ReturnType<typeof vi.fn>): Headers {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return new Headers(init.headers)
}

function visitorRequest(headers: Record<string, string> = {}) {
  return new Request('https://palpitae.com.br/api/groups?x=1', {
    headers: { 'CF-Connecting-IP': '198.51.100.7', ...headers },
  })
}

describe('API proxy', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('forwards the visitor IP with the shared secret when configured', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await onRequest({ request: visitorRequest(), env: { PROXY_SHARED_SECRET: 's3cret' } })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.palpitae.com.br/groups?x=1')
    const headers = forwardedHeaders(fetchMock)
    expect(headers.get(CLIENT_IP_HEADER)).toBe('198.51.100.7')
    expect(headers.get(PROXY_SECRET_HEADER)).toBe('s3cret')
  })

  it('overwrites proxy headers sent by the visitor', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const request = visitorRequest({
      [CLIENT_IP_HEADER]: '203.0.113.9',
      [PROXY_SECRET_HEADER]: 'x',
    })
    await onRequest({ request, env: { PROXY_SHARED_SECRET: 's3cret' } })
    const headers = forwardedHeaders(fetchMock)
    expect(headers.get(CLIENT_IP_HEADER)).toBe('198.51.100.7')
    expect(headers.get(PROXY_SECRET_HEADER)).toBe('s3cret')
  })

  it('drops proxy headers sent by the visitor when no secret is configured', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const request = visitorRequest({
      [CLIENT_IP_HEADER]: '203.0.113.9',
      [PROXY_SECRET_HEADER]: 'x',
    })
    await onRequest({ request, env: {} })
    const headers = forwardedHeaders(fetchMock)
    expect(headers.has(CLIENT_IP_HEADER)).toBe(false)
    expect(headers.has(PROXY_SECRET_HEADER)).toBe(false)
  })
})
