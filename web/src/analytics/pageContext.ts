/**
 * O que o GA4 recebe sobre a página atual.
 *
 * Nome do grupo, id do grupo e código de convite são privados e não saem do
 * app. O título da aba continua com o nome do grupo: só o valor enviado ao GA
 * é genérico, e por isso ele vem da rota, nunca de `document.title`.
 */
const BASE_TITLE = 'Palpitae'

const ALLOWED_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'from',
  'tab',
  'rodada',
])

const PRIVATE_PATHS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/grupos\/[^/]+/, '/grupos/:id'],
  [/^\/convite\/[^/]+/, '/convite/:code'],
]

const ROUTE_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/grupos\//, 'Grupo'],
  [/^\/convite\//, 'Convite'],
  [/^\/entrar\/?$/, 'Entrar'],
  [/^\/configuracoes\/?$/, 'Configurações'],
  [/^\/admin(\/|$)/, 'Admin'],
  [/^\/$/, 'Início'],
]

export interface GaPage {
  page_location: string
  page_title: string
}

type PageUrl = Pick<URL, 'origin' | 'pathname' | 'search'>

function normalizePath(pathname: string): string {
  const match = PRIVATE_PATHS.find(([pattern]) => pattern.test(pathname))
  return match ? pathname.replace(match[0], match[1]) : pathname
}

function allowedSearch(search: string): string {
  const kept = [...new URLSearchParams(search)].filter(([key]) => ALLOWED_QUERY_PARAMS.has(key))
  return kept.length > 0 ? `?${new URLSearchParams(kept).toString()}` : ''
}

export function gaPageLocation({ origin, pathname, search }: PageUrl): string {
  return `${origin}${normalizePath(pathname)}${allowedSearch(search)}`
}

function routeLabel(pathname: string): string | undefined {
  return ROUTE_LABELS.find(([pattern]) => pattern.test(pathname))?.[1]
}

/**
 * Título enviado ao GA. No primeiro carregamento, `firstLoadTitle` preserva o
 * título estático da home e de rotas sem rótulo próprio.
 */
export function gaPageTitle(pathname: string, firstLoadTitle?: string): string {
  const label = routeLabel(pathname)
  if (firstLoadTitle && (pathname === '/' || !label)) return firstLoadTitle
  return label ? `${label} | ${BASE_TITLE}` : BASE_TITLE
}

/**
 * Referrer do próprio site, já sem dados privados. Referrer externo devolve
 * `undefined` de propósito: enviar `page_referrer` manual desliga o tratamento
 * do retorno do login como referência indesejada.
 */
export function internalReferrer(referrer: string, origin: string): string | undefined {
  try {
    const url = new URL(referrer)
    return url.origin === origin ? gaPageLocation(url) : undefined
  } catch {
    return undefined
  }
}
