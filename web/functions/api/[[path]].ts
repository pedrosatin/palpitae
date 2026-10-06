/**
 * Proxy de `/api/*` para a API (`api.palpitae.com.br`).
 *
 * O fetch daqui é um subrequest de Worker, e a API recebe o IP de saída da
 * Cloudflare em `CF-Connecting-IP`, igual para todo visitante. Para a quota por
 * IP das requisições anônimas, o proxy repassa o IP do visitante em
 * `X-Palpitae-Client-IP`, acompanhado do segredo compartilhado
 * `PROXY_SHARED_SECRET`. A API só usa esse IP quando o segredo confere. Os dois
 * headers sempre são removidos da requisição do visitante antes do repasse.
 * Ver docs/security.md.
 */

const API_BASE = 'https://api.palpitae.com.br'

export const CLIENT_IP_HEADER = 'X-Palpitae-Client-IP'
export const PROXY_SECRET_HEADER = 'X-Palpitae-Proxy-Secret'

export interface Env {
  /** Mesmo valor configurado no Worker da API. Sem ele, o IP não é repassado. */
  PROXY_SHARED_SECRET?: string
}

export async function onRequest(context: { request: Request; env?: Env }): Promise<Response> {
  const url = new URL(context.request.url)

  // Strip the leading /api prefix
  const apiPath = url.pathname.replace(/^\/api/, '') || '/'
  const targetUrl = `${API_BASE}${apiPath}${url.search}`

  // Forward request, passing along cookies and other headers
  const headers = new Headers(context.request.headers)
  headers.set('host', 'api.palpitae.com.br')
  headers.delete(CLIENT_IP_HEADER)
  headers.delete(PROXY_SECRET_HEADER)
  const secret = context.env?.PROXY_SHARED_SECRET
  const clientIp = context.request.headers.get('CF-Connecting-IP')
  if (secret && clientIp) {
    headers.set(CLIENT_IP_HEADER, clientIp)
    headers.set(PROXY_SECRET_HEADER, secret)
  }

  const response = await fetch(targetUrl, {
    method: context.request.method,
    headers,
    body:
      context.request.method !== 'GET' && context.request.method !== 'HEAD'
        ? context.request.body
        : undefined,
    redirect: 'manual',
  })

  return response
}
