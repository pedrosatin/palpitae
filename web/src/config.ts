/**
 * Application-level configuration sourced from Vite environment variables.
 *
 * Variables are injected at build time by Vite and must be prefixed with
 * VITE_ to be exposed to client code.
 *
 * VITE_API_URL  — base URL for the Palpitae API
 *                 Set in .env.development for local dev (http://localhost:8787)
 *                 Set in .env.production for deployed environments
 * VITE_AUTH_URL — origem absoluta do login com Google (`/auth/google`).
 *                 O build de produção recusa valor ausente ou malformado nas duas
 *                 (ver `build/env.ts`). Toda URL da API sai de `buildApiUrl` ou
 *                 `buildAuthUrl`, nunca de concatenação com `config`.
 * VITE_GA_MEASUREMENT_ID — Google Analytics 4 measurement id (G-XXXXXXXXXX).
 *                 When empty, analytics is fully disabled (no script, no banner).
 *                 Set it as a build-time env var in Cloudflare Pages.
 */
export const config = {
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:8787',
  authUrl: import.meta.env.VITE_AUTH_URL ?? 'http://localhost:8787',
  gaMeasurementId: import.meta.env.VITE_GA_MEASUREMENT_ID ?? '',
  /** Public TBBC inbox key. Empty disables feedback and all TBBC requests. */
  tbbcSiteKey: (import.meta.env.VITE_TBBC_SITE_KEY ?? '').trim(),
} as const

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value)
}

/** Junta base e caminho com uma única barra entre eles, com ou sem barra no fim da base. */
function joinUrl(base: string, path: string, searchParams?: URLSearchParams): string {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  const trimmedBase = base.trim().replace(/\/+$/, '')

  if (isAbsoluteUrl(trimmedBase)) {
    const url = new URL(normalizedPath, `${trimmedBase}/`)

    for (const [key, value] of searchParams ?? []) {
      url.searchParams.set(key, value)
    }

    return url.toString()
  }

  const normalizedBase =
    trimmedBase.length === 0 ? '' : trimmedBase.startsWith('/') ? trimmedBase : `/${trimmedBase}`
  const query = searchParams?.toString()

  const pathPart = `/${normalizedPath}`

  return query ? `${normalizedBase}${pathPart}?${query}` : `${normalizedBase}${pathPart}`
}

export function buildApiUrl(path: string, searchParams?: URLSearchParams): string {
  return joinUrl(config.apiUrl, path, searchParams)
}

/** URL do fluxo de login, que roda na origem de `VITE_AUTH_URL`. */
export function buildAuthUrl(path: string, searchParams?: URLSearchParams): string {
  return joinUrl(config.authUrl, path, searchParams)
}
