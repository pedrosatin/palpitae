
const API_BASE = 'https://api.palpitae.com.br'

export const CLIENT_IP_HEADER = 'X-Palpitae-Client-IP'
export const PROXY_SECRET_HEADER = 'X-Palpitae-Proxy-Secret'
/**
 * Marca o aviso de abertura enviado pela Function de convite. O proxy nunca a
 * repassa: ele injeta o segredo em todo `/api/*`, então o segredo sozinho não
 * prova que o pedido veio da Function.
 */
export const INVITE_OPEN_HEADER = 'X-Palpitae-Invite-Open'

export interface Env {
  PROXY_SHARED_SECRET?: string
}

export async function onRequest(context: { request: Request; env?: Env }): Promise<Response> {
  const url = new URL(context.request.url)

  const apiPath = url.pathname.replace(/^\/api/, '') || '/'
  const targetUrl = `${API_BASE}${apiPath}${url.search}`

  const headers = new Headers(context.request.headers)
  headers.set('host', 'api.palpitae.com.br')
  headers.delete(CLIENT_IP_HEADER)
  headers.delete(PROXY_SECRET_HEADER)
  headers.delete(INVITE_OPEN_HEADER)
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
