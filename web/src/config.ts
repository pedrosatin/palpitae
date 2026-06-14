/**
 * Application-level configuration sourced from Vite environment variables.
 *
 * Variables are injected at build time by Vite and must be prefixed with
 * VITE_ to be exposed to client code.
 *
 * VITE_API_URL  — base URL for the Palpitae API
 *                 Set in .env.development for local dev (http://localhost:8787)
 *                 Set in .env.production for deployed environments
 */
export const config = {
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:8787',
  authUrl: import.meta.env.VITE_AUTH_URL ?? 'http://localhost:8787',
} as const

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value)
}

export function buildApiUrl(
  path: string,
  searchParams?: URLSearchParams,
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const trimmedBase = config.apiUrl.trim().replace(/\/+$/, '')

  if (isAbsoluteUrl(trimmedBase)) {
    const url = new URL(normalizedPath, `${trimmedBase}/`)

    for (const [key, value] of searchParams ?? []) {
      url.searchParams.set(key, value)
    }

    return url.toString()
  }

  const normalizedBase =
    trimmedBase.length === 0
      ? ''
      : trimmedBase.startsWith('/')
        ? trimmedBase
        : `/${trimmedBase}`
  const query = searchParams?.toString()

  return query
    ? `${normalizedBase}${normalizedPath}?${query}`
    : `${normalizedBase}${normalizedPath}`
}
