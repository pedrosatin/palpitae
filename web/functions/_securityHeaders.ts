/**
 * Cabeçalhos de segurança da regra `/*` de `public/_headers`.
 *
 * A Function de convite devolve o HTML da SPA reescrito. O shell que ela lê de
 * `ASSETS.fetch` já traz os cabeçalhos do `_headers`, e a Function não deve
 * depender disso, então repete aqui os valores da regra `/*`.
 * `tests/functions/conviteHeaders.test.ts` lê o `_headers` e exige cada valor em
 * todas as respostas da Function. Ao mudar a política, por exemplo com um hash
 * novo que o `npm run csp:verify` aponta, atualize os dois lugares.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'sha256-o2mE5DtQDZobg/ZPVF/QxZ5zvPejdPlzbwqmUtRq8U4=' 'sha256-m9LNak7+IocEKhY1YDqBHTPBpX7XcPYTn2WPxbseAFM=' 'sha256-5A0aCph+CjN57EUnQiFEUU8hi0c8/vgCwu0q8THMS30=' https://static.cloudflareinsights.com https://www.googletagmanager.com; style-src 'self' 'sha256-nLux2qOEbDREidVvUmTJBTLa/TBmguEc4QjGJY3Zs7w=' 'sha256-5TDRfYqewrlfZFqMvZ6w5rWlm5ugnIwaHWkxendIkz0=' 'sha256-dZQXdY7GQkX+8p8zJhI1/a1hgVMZxxzocH3IWZjQwvY='; img-src 'self' data: blob: https://crests.football-data.org https://a.espncdn.com https://*.googleusercontent.com https://*.google-analytics.com https://*.googletagmanager.com; font-src 'self'; connect-src 'self' https://tbbc.app https://cloudflareinsights.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com; manifest-src 'self'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
}

/** Devolve a resposta com os cabeçalhos de segurança, sem alterar a original. */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
