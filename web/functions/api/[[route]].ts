export async function onRequest(context: { request: Request }) {
  const url = new URL(context.request.url)
  url.hostname = 'api.palpitae.com.br'
  url.port = ''
  url.protocol = 'https:'

  const request = new Request(url.toString(), context.request)
  return fetch(request)
}
