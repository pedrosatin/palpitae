/**
 * Origem do cadastro, enviada à API no clique de "Entrar com Google". A API valida o
 * valor e só o registra se a conta for nova (docs/observability.md, "Origem do
 * cadastro"). Só a categoria sai do navegador: o referrer nunca é enviado.
 */
import { INVITE_PATH_PREFIX, normalizeInviteCode } from '../lib/invite'
import { clearGuideOrigin, getGuideOrigin, ORIGIN_TTL_MS } from './guideOrigin'

/** Como esta aba chegou ao site: `convite`, `busca` ou `direto`. */
const ENTRY_KEY = 'palpitae:origem-entrada'

/** Guia de onde a aba saiu, visto pelo referrer. Vale o mesmo prazo do token `from`. */
const REFERRER_GUIDE_KEY = 'palpitae:origem-guia-referrer'

// `accounts.google.com` fica de fora de propósito: é a volta do OAuth, não uma busca.
const SEARCH_HOST_RE =
  /^(?:(?:www|m)\.)?google\.(?:[a-z]{2,3}|com?\.[a-z]{2})$|^(?:www\.)?bing\.com$|^(?:www\.)?duckduckgo\.com$|^(?:[a-z]{2}\.)?search\.yahoo\.com$|^(?:www\.)?ecosia\.org$|^search\.brave\.com$|^(?:www\.)?yandex\.[a-z]{2,3}$/

const GOOGLE_APP_HOST = 'com.google.android.googlequicksearchbox'

function readEntry(): string | undefined {
  try {
    return sessionStorage.getItem(ENTRY_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function writeEntry(entry: string): void {
  try {
    sessionStorage.setItem(ENTRY_KEY, entry)
  } catch {
    /* Sem storage, a origem chega à API como desconhecida. */
  }
}

function writeReferrerGuide(token: string): void {
  try {
    sessionStorage.setItem(REFERRER_GUIDE_KEY, JSON.stringify({ token, capturedAt: Date.now() }))
  } catch {
    /* Sem storage, a origem chega à API como desconhecida. */
  }
}

function readReferrerGuide(): string | undefined {
  try {
    const stored = sessionStorage.getItem(REFERRER_GUIDE_KEY)
    if (!stored) return undefined
    const { token, capturedAt } = JSON.parse(stored) as { token?: unknown; capturedAt?: unknown }
    const age = typeof capturedAt === 'number' ? Date.now() - capturedAt : Number.NaN
    if (typeof token === 'string' && isGuideToken(token) && age >= 0 && age < ORIGIN_TTL_MS) {
      return token
    }
    sessionStorage.removeItem(REFERRER_GUIDE_KEY)
  } catch {
    /* Valor corrompido ou storage bloqueado: fica sem guia. */
  }
  return undefined
}

function isGuideToken(token: string): boolean {
  return token === 'guias_header' || token.startsWith('guia_')
}

/** Os guias são HTML estático, sem o app: quem sai de um deles é atribuído pelo caminho. */
function guideTokenFromPath(pathname: string): string | undefined {
  if (pathname === '/guias' || pathname === '/guias/') return 'guias_header'
  const slug = /^\/guias\/([a-z0-9-]+)\/?$/.exec(pathname)?.[1]
  return slug ? `guia_${slug}` : undefined
}

function classifyReferrer(referrer: string, ownOrigin: string): string | undefined {
  if (!referrer) return 'direto'
  let url: URL
  try {
    url = new URL(referrer)
  } catch {
    return undefined
  }
  if (url.origin === ownOrigin) return guideTokenFromPath(url.pathname)
  const isSearch = SEARCH_HOST_RE.test(url.hostname) || url.hostname === GOOGLE_APP_HOST
  return isSearch ? 'busca' : undefined
}

/**
 * Classifica a chegada da aba pelo referrer. Roda uma vez por carga de página. A chegada
 * registrada não é sobrescrita, senão a volta do OAuth apagaria a origem real. O guia fica
 * à parte, com prazo, e vale mais que a chegada.
 * Outro site na lista fechada não tem categoria: a API registra `desconhecida`.
 */
export function captureEntryOrigin(
  referrer: string = document.referrer,
  ownOrigin: string = window.location.origin,
): void {
  const entry = classifyReferrer(referrer, ownOrigin)
  if (!entry) return
  if (isGuideToken(entry)) writeReferrerGuide(entry)
  else if (readEntry() === undefined) writeEntry(entry)
}

/** Abrir um convite vale mais que a chegada da aba, mesmo depois de outra origem. */
export function captureInviteEntry(pathname: string, search: string): void {
  const code = pathname.startsWith(INVITE_PATH_PREFIX)
    ? pathname.slice(INVITE_PATH_PREFIX.length)
    : new URLSearchParams(search).get('convite')
  if (normalizeInviteCode(code)) writeEntry('convite')
}

/** Prioridade: convite, guia, chegada da aba. Sem valor, a API registra `desconhecida`. */
export function getSignupOrigin(): string | undefined {
  const entry = readEntry()
  if (entry === 'convite') return entry
  return getGuideOrigin() ?? readReferrerGuide() ?? entry
}

/** Logout apaga a atribuição da aba, junto com a origem do guia. */
export function clearSignupAttribution(): void {
  clearGuideOrigin()
  try {
    sessionStorage.removeItem(ENTRY_KEY)
    sessionStorage.removeItem(REFERRER_GUIDE_KEY)
  } catch {
    /* Storage é opcional. */
  }
}
