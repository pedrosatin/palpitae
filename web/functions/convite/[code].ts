/**
 * Pages Function de `/convite/:code`: preview do link de convite.
 *
 * O WhatsApp (e Telegram, X, iMessage) monta o card do link lendo as meta tags
 * do HTML, sem executar JS. Esta Function devolve o mesmo `index.html` da SPA
 * com `<title>`, `og:*` e `twitter:*` trocados pelos dados do grupo, buscados no
 * endpoint público da API (`GET /public/invites/:code`). No navegador a SPA
 * assume e mostra a página de convite ao visitante (ver `InvitePage`). Quem já
 * tem sessão vai para `/?convite=CODE`.
 *
 * Se a API falhar, passar do tempo limite ou responder fora do formato, a
 * página sai com o texto de convite genérico e a SPA busca os dados sozinha.
 * Códigos inválidos mantêm o OG da home. A página sempre sai com `noindex`,
 * porque o link dá acesso a um grupo privado.
 *
 * Crawlers de preview (WhatsApp, Telegram, X, Slack etc., ver
 * `isPreviewCrawler`) e pessoas disparam a busca na API. A pessoa tem um tempo
 * limite menor porque o HTML não pode segurar a abertura do link, e recebe os
 * dados em `data-convite` no `#root`, para a SPA pintar o convite sem outra
 * chamada. A busca usa `cf.cacheTtlByStatus` para o edge guardar a resposta.
 *
 * Com `PROXY_SHARED_SECRET` configurado, a busca repassa o IP do visitante e o
 * segredo, como o proxy de `/api/*`. Assim a API conta a quota pelo IP de quem pediu
 * o convite, e não pelo balde anônimo compartilhado dos Workers.
 *
 * Cada navegação de uma pessoa também vira uma abertura no funil de convite (ver
 * `isInviteOpen`), registrada pela API em segundo plano. Esse aviso não leva o
 * código nem dado de quem abriu, e sem o segredo do proxy a abertura não é contada.
 *
 * A resposta sempre leva os cabeçalhos de segurança da regra `/*` do `_headers`
 * (ver `_securityHeaders.ts`), para não depender dos cabeçalhos que o asset traz.
 *
 * A imagem é compartilhada entre os convites; o nome do grupo aparece no título.
 */

import { withSecurityHeaders } from '../_securityHeaders'
import { CLIENT_IP_HEADER, INVITE_OPEN_HEADER, PROXY_SECRET_HEADER } from '../api/[[path]]'

// Tipos mínimos do runtime de Pages/Workers. A pasta functions/ não entra no
// tsconfig do app (que usa os tipos do DOM), então declaramos só o que é usado.
interface AssetsFetcher {
  fetch(input: Request | string): Promise<Response>
}

export interface Env {
  ASSETS: AssetsFetcher
  /** Base da API. Opcional; o padrão é a API de produção. */
  API_URL?: string
  /** Mesmo valor configurado no Worker da API. Sem ele, o IP não é repassado. */
  PROXY_SHARED_SECRET?: string
}

/** IP do visitante e segredo do proxy, repassados à API para a quota por IP. */
export interface ForwardedClient {
  clientIp: string
  secret: string
}

interface PagesContext {
  request: Request
  env: Env
  params: Record<string, string | string[] | undefined>
  waitUntil(promise: Promise<unknown>): void
}

interface RewriterElement {
  setAttribute(name: string, value: string): void
  setInnerContent(content: string): void
  remove(): void
}

interface HTMLRewriterLike {
  on(selector: string, handlers: { element(el: RewriterElement): void }): HTMLRewriterLike
  transform(response: Response): Response
}

declare const HTMLRewriter: { new (): HTMLRewriterLike }

export const DEFAULT_API_URL = 'https://api.palpitae.com.br'
export const API_TIMEOUT_MS = 1500
/** Tempo limite da busca para uma pessoa abrindo o link. A SPA cobre o resto. */
export const VISITOR_API_TIMEOUT_MS = 800
const SITE_URL = 'https://palpitae.com.br'

// Mesmo formato validado pela API (api/src/public/router.ts). Validar aqui poupa
// a chamada quando o link vem truncado ou adulterado.
const INVITE_CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

/** Quanto tempo o edge guarda cada resposta da API (mesmos max-age da rota). */
export const API_CACHE_TTL_S = 300
export const API_MISS_CACHE_TTL_S = 60

// Crawlers que montam card de link. A lista nomeada cobre os que não trazem
// "bot" no nome (facebookexternalhit, WhatsApp, Embedly...); o `bot` genérico
// pega o resto. Uma pessoa classificada como crawler fica sem `data-convite`, e a SPA busca o convite sozinha.
const PREVIEW_CRAWLER_RE =
  /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|slack-imgproxy|discordbot|linkedinbot|googlebot|bingbot|applebot|pinterest|embedly|redditbot|skypeuripreview|vkshare|iframely|bot\b|crawler|spider/i

// Headers de pré-busca do navegador. Quem pré-busca ainda não abriu o link, e a
// presença de qualquer um deles basta.
const PREFETCH_HEADERS = ['Sec-Purpose', 'Purpose', 'X-Purpose', 'X-Moz']

// Todo navegador se apresenta assim. Biblioteca HTTP e User-Agent vazio não.
const BROWSER_UA_RE = /^Mozilla\//

/** Fetch options do runtime da Cloudflare (sem @cloudflare/workers-types aqui). */
interface CfRequestInit extends RequestInit {
  cf?: { cacheTtlByStatus?: Record<string, number>; cacheEverything?: boolean }
}

export interface InvitePreview {
  groupName: string
  competitionName: string | null
  memberCount: number
  adminName: string | null
  pointsExact: number | null
  pointsWinner: number | null
}

export interface InviteMeta {
  title: string
  description: string
}

/** True quando o User-Agent é de um crawler que lê as meta tags do link. */
export function isPreviewCrawler(userAgent: string | null | undefined): boolean {
  return !!userAgent && PREVIEW_CRAWLER_RE.test(userAgent)
}

export function normalizeInviteCode(raw: string | string[] | undefined): string | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase() ?? ''
  return INVITE_CODE_RE.test(value) ? value : null
}

function scoringPoints(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Busca os dados do preview. Devolve null em qualquer falha (status != 200,
 * JSON fora do formato, rede, timeout). Quem chama cai no OG genérico.
 */
export async function fetchInvitePreview(
  code: string,
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = API_TIMEOUT_MS,
  forward?: ForwardedClient,
): Promise<InvitePreview | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const base = apiUrl.replace(/\/+$/, '')
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (forward) {
      headers[CLIENT_IP_HEADER] = forward.clientIp
      headers[PROXY_SECRET_HEADER] = forward.secret
    }
    const init: CfRequestInit = {
      headers,
      signal: controller.signal,
      // Cache de verdade no edge. O Cache-Control da API sozinho não basta,
      // porque subrequests de um Worker só passam pelo cache com `cf`. Erro e
      // 429 não entram (-1 é "não guardar"; 0 expira na hora), porque o 429 de
      // um visitante apareceria para os outros.
      cf: {
        cacheEverything: true,
        cacheTtlByStatus: {
          '200-299': API_CACHE_TTL_S,
          '404': API_MISS_CACHE_TTL_S,
          '429': -1,
          '500-599': -1,
        },
      },
    }
    const res = await fetchImpl(`${base}/public/invites/${encodeURIComponent(code)}`, init)
    if (res.status !== 200) return null
    const body = (await res.json()) as {
      invite?: {
        group_name?: unknown
        competition_name?: unknown
        member_count?: unknown
        admin_name?: unknown
        points_exact?: unknown
        points_winner?: unknown
      }
    }
    const invite = body.invite
    if (!invite || typeof invite.group_name !== 'string' || !invite.group_name.trim()) return null
    const count = Number(invite.member_count)
    return {
      groupName: invite.group_name.trim(),
      competitionName:
        typeof invite.competition_name === 'string' && invite.competition_name.trim()
          ? invite.competition_name.trim()
          : null,
      memberCount: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
      adminName:
        typeof invite.admin_name === 'string' && invite.admin_name.trim()
          ? invite.admin_name.trim()
          : null,
      pointsExact: scoringPoints(invite.points_exact),
      pointsWinner: scoringPoints(invite.points_winner),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Monta título e descrição do card, com fallback quando faltam dados do grupo.
 */
export function buildInviteMeta(preview: InvitePreview | null): InviteMeta {
  if (!preview) {
    return {
      title: 'Você recebeu um convite para um bolão no Palpitae',
      description: 'Abra o link para entrar no grupo e palpitar com a galera.',
    }
  }
  const participants =
    preview.memberCount === 1 ? '1 participante' : `${preview.memberCount} participantes`
  const parts = [preview.competitionName, participants, 'grátis, sem apostas'].filter(Boolean)
  return {
    title: `Entra no bolão "${preview.groupName}" no Palpitae`,
    description: parts.join(' · '),
  }
}

/**
 * Dados do convite para a SPA, no formato da resposta da API. O valor vai em
 * `encodeURIComponent` porque o HTMLRewriter só escapa aspas. Um `&quot;`
 * digitado no nome do grupo voltaria como aspas e quebraria o JSON.
 */
export function serializeInviteEmbed(code: string, preview: InvitePreview): string {
  return encodeURIComponent(
    JSON.stringify({
      code,
      invite: {
        group_name: preview.groupName,
        competition_name: preview.competitionName,
        member_count: preview.memberCount,
        admin_name: preview.adminName,
        points_exact: preview.pointsExact,
        points_winner: preview.pointsWinner,
      },
    }),
  )
}

/**
 * Aplica as meta tags do convite sobre o HTML da SPA. O HTMLRewriter escapa
 * texto e atributos, então o nome do grupo (texto livre do usuário) não injeta
 * markup.
 */
export function rewriteInviteHtml(
  response: Response,
  meta: InviteMeta | null,
  pageUrl: string,
  embed: string | null = null,
): Response {
  const setContent = (value: string) => ({
    element(el: RewriterElement) {
      el.setAttribute('content', value)
    },
  })

  let rewriter = new HTMLRewriter()
    .on('meta[name="robots"]', setContent('noindex'))
    // Uma página noindex com canonical apontando para a home manda sinais
    // contraditórios; sem canonical fica só o noindex.
    .on('link[rel="canonical"]', {
      element(el) {
        el.remove()
      },
    })
    .on('meta[property="og:url"]', setContent(pageUrl))

  if (meta) {
    rewriter = rewriter
      .on('title', {
        element(el) {
          el.setInnerContent(meta.title)
        },
      })
      .on('meta[property="og:image"]', setContent(`${SITE_URL}/og-convite.png`))
      .on('meta[name="twitter:image"]', setContent(`${SITE_URL}/og-convite.png`))
      .on(
        'meta[property="og:image:alt"]',
        setContent('Convite para entrar em um bolão no Palpitae'),
      )
      .on(
        'meta[name="twitter:image:alt"]',
        setContent('Convite para entrar em um bolão no Palpitae'),
      )
      .on('meta[name="description"]', setContent(meta.description))
      .on('meta[property="og:title"]', setContent(meta.title))
      .on('meta[property="og:description"]', setContent(meta.description))
      .on('meta[name="twitter:title"]', setContent(meta.title))
      .on('meta[name="twitter:description"]', setContent(meta.description))
  }

  if (embed) {
    rewriter = rewriter.on('#root', {
      element(el) {
        el.setAttribute('data-convite', embed)
      },
    })
  }

  const headers = new Headers(response.headers)
  headers.set('Content-Type', 'text/html; charset=utf-8')
  headers.set('X-Robots-Tag', 'noindex')
  // O corpo muda a cada grupo; validadores do index.html não servem mais.
  headers.delete('Content-Length')
  headers.delete('ETag')
  // O index.html referencia os assets com hash do deploy atual; não guardar.
  headers.set('Cache-Control', 'no-cache')

  return rewriter.transform(new Response(response.body, { status: 200, statusText: 'OK', headers }))
}

/** IP e segredo para a API contar a quota de quem abriu o link. */
export function forwardedClient(env: Env, request: Request): ForwardedClient | undefined {
  const clientIp = request.headers.get('CF-Connecting-IP')
  return env.PROXY_SHARED_SECRET && clientIp
    ? { clientIp, secret: env.PROXY_SHARED_SECRET }
    : undefined
}

/**
 * True para a navegação de uma pessoa até um convite com código válido: GET de
 * documento, nem crawler, nem pré-busca. `Sec-Fetch-Mode` só vale quando vem,
 * porque Safari antigo não envia.
 */
export function isInviteOpen(request: Request, code: string | null, crawler: boolean): boolean {
  if (!code || crawler || request.method !== 'GET') return false
  if (PREFETCH_HEADERS.some((name) => request.headers.has(name))) return false
  const fetchMode = request.headers.get('Sec-Fetch-Mode')
  if (fetchMode && fetchMode !== 'navigate') return false
  return BROWSER_UA_RE.test(request.headers.get('User-Agent') ?? '')
}

/** Avisa a API da abertura, sem corpo e sem o código. A falha nunca chega à página. */
export async function postInviteOpen(
  apiUrl: string,
  forward: ForwardedClient,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl(`${apiUrl.replace(/\/+$/, '')}/public/invite-opens`, {
      method: 'POST',
      headers: {
        [CLIENT_IP_HEADER]: forward.clientIp,
        [PROXY_SECRET_HEADER]: forward.secret,
        [INVITE_OPEN_HEADER]: '1',
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })
  } catch {
    // Uma abertura perdida não justifica atrasar nem derrubar o convite.
  }
}

/** Registra a abertura em segundo plano, sem segurar a resposta do HTML. */
export function reportInviteOpen(
  context: PagesContext,
  code: string | null,
  crawler: boolean,
  fetchImpl: typeof fetch = fetch,
): void {
  const forward = forwardedClient(context.env, context.request)
  if (!forward || !isInviteOpen(context.request, code, crawler)) return
  context.waitUntil(
    postInviteOpen(context.env.API_URL || DEFAULT_API_URL, forward, fetchImpl),
  )
}

/** Busca o convite com o tempo limite de quem abriu. Código inválido não chama a API. */
export function loadInvitePreview(
  code: string | null,
  crawler: boolean,
  env: Env,
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<InvitePreview | null> {
  if (!code) return Promise.resolve(null)
  return fetchInvitePreview(
    code,
    env.API_URL || DEFAULT_API_URL,
    fetchImpl,
    crawler ? API_TIMEOUT_MS : VISITOR_API_TIMEOUT_MS,
    forwardedClient(env, request),
  )
}

export interface InviteRewrite {
  meta: InviteMeta | null
  pageUrl: string
  embed: string | null
}

/** O que a reescrita aplica sobre o HTML, sem tocar no HTMLRewriter. */
export function planInviteRewrite(
  code: string | null,
  preview: InvitePreview | null,
  crawler: boolean,
): InviteRewrite {
  if (!code) return { meta: null, pageUrl: `${SITE_URL}/`, embed: null }
  return {
    meta: buildInviteMeta(preview),
    pageUrl: `${SITE_URL}/convite/${code}`,
    // Crawler não roda JS, então o nome do admin fica fora do HTML dele.
    embed: preview && !crawler ? serializeInviteEmbed(code, preview) : null,
  }
}

export async function onRequest(context: PagesContext): Promise<Response> {
  // Para não depender dos cabeçalhos que o asset traz, toda saída, inclusive a do
  // asset com erro ou redirect, leva os cabeçalhos de segurança.
  return withSecurityHeaders(await respond(context))
}

async function respond(context: PagesContext): Promise<Response> {
  const { request, env, params } = context
  // URL pura, sem os headers do visitante: um If-None-Match repassado poderia
  // voltar 304 sem corpo, e o HTML reescrito sairia vazio.
  const shell = await env.ASSETS.fetch(new URL('/', request.url).toString())
  if (shell.status !== 200) return shell

  try {
    const code = normalizeInviteCode(params.code)
    const crawler = isPreviewCrawler(request.headers.get('User-Agent'))
    reportInviteOpen(context, code, crawler)
    const preview = await loadInvitePreview(code, crawler, env, request)
    const { meta, pageUrl, embed } = planInviteRewrite(code, preview, crawler)
    return rewriteInviteHtml(shell, meta, pageUrl, embed)
  } catch {
    // Se a reescrita falhar, devolve o index.html original e a SPA busca o convite.
    return shell
  }
}
