/**
 * O que o GA4 recebe sobre a página atual.
 *
 * Nome do grupo, id do grupo e código de convite são privados e não saem do
 * app. O título da aba continua com o nome do grupo: só o valor enviado ao GA
 * é genérico. Ele vem sempre da rota, nunca de `document.title`, porque a
 * função do convite reescreve o `<title>` do HTML com o nome do grupo, e esse
 * título sobrevive à troca de `/convite/CODE` por `/?convite=CODE`.
 *
 * `rodada` fica fora da lista de propósito: o app consome esse parâmetro e o
 * apaga da URL logo depois de abrir, o que contaria uma visualização a mais.
 */
import { matchPath } from 'react-router-dom'

const BASE_TITLE = 'Palpitae'

const ALLOWED_QUERY_PARAMS = new Set(['gclid', 'from', 'tab'])

function isAllowedQueryParam(key: string): boolean {
  return key.startsWith('utm_') || ALLOWED_QUERY_PARAMS.has(key)
}

interface GaRoute {
  path: string
  end: boolean
  label: string
  /** Caminho enviado ao GA quando a URL real carrega um dado privado. */
  normalizedPath?: string
}

const GA_ROUTES: readonly GaRoute[] = [
  { path: '/grupos/:id', end: false, label: 'Grupo', normalizedPath: '/grupos/:id' },
  { path: '/convite/:code', end: false, label: 'Convite', normalizedPath: '/convite/:code' },
  { path: '/entrar', end: true, label: 'Entrar' },
  { path: '/configuracoes', end: true, label: 'Configurações' },
  { path: '/admin', end: false, label: 'Admin' },
  { path: '/', end: true, label: 'Início' },
]

export interface GaPage {
  page_location: string
  page_title: string
}

type PageUrl = Pick<URL, 'origin' | 'pathname' | 'search'>

/** Mesma decodificação que o roteador aplica antes de comparar a rota. */
function decodePath(pathname: string): string {
  try {
    return pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment).replace(/\//g, '%2F'))
      .join('/')
  } catch {
    return pathname
  }
}

// Usa o matcher do React Router: a regra de maiúsculas e de caminho codificado
// precisa ser a mesma que abre a página.
function findRoute(pathname: string): GaRoute | undefined {
  const decoded = decodePath(pathname)
  return GA_ROUTES.find(({ path, end }) => matchPath({ path, end }, decoded))
}

function normalizePath(pathname: string): string {
  return findRoute(pathname)?.normalizedPath ?? pathname
}

function allowedSearch(search: string): string {
  const kept = [...new URLSearchParams(search)].filter(([key]) => isAllowedQueryParam(key))
  return kept.length > 0 ? `?${new URLSearchParams(kept).toString()}` : ''
}

export function gaPageLocation({ origin, pathname, search }: PageUrl): string {
  return `${origin}${normalizePath(pathname)}${allowedSearch(search)}`
}

export function gaPageTitle(pathname: string): string {
  const label = findRoute(pathname)?.label
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
