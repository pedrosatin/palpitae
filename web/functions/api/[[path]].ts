const API_BASE = 'https://api.palpitae.com.br'

export async function onRequest(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url)

  // Strip the leading /api prefix
  const apiPath = url.pathname.replace(/^\/api/, '') || '/'
  const targetUrl = `${API_BASE}${apiPath}${url.search}`

  // Forward request, passing along cookies and other headers
  const headers = new Headers(context.request.headers)
  headers.set('host', 'api.palpitae.com.br')

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
