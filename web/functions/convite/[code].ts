/**
 * Pages Function de `/convite/:code`: preview do link de convite.
 *
 * O WhatsApp (e Telegram, X, iMessage) monta o card do link lendo as meta tags
 * do HTML, sem executar JS. Esta Function devolve o mesmo `index.html` da SPA
 * com `<title>`, `og:*` e `twitter:*` trocados pelos dados do grupo, buscados no
 * endpoint público da API (`GET /public/invites/:code`). No navegador a SPA
 * assume e redireciona para `/?convite=CODE` (ver `InviteRedirect` em App.tsx).
 *
 * Regra de ouro: o convite nunca quebra. Código inválido, API fora do ar, lenta
 * (> API_TIMEOUT_MS) ou resposta estranha → o HTML sai com o OG genérico da home.
 * Em qualquer caso a página leva `noindex`: é um link privado, não conteúdo.
 *
 * og:image segue a genérica (/og-image.png); imagem dinâmica por grupo fica
 * para depois.
 */

// Tipos mínimos do runtime de Pages/Workers. A pasta functions/ não entra no
// tsconfig do app (que usa os tipos do DOM), então declaramos só o que é usado.
interface AssetsFetcher {
  fetch(input: Request | string): Promise<Response>
}

export interface Env {
  ASSETS: AssetsFetcher
  /** Base da API. Opcional; o padrão é a API de produção. */
  API_URL?: string
}

interface PagesContext {
  request: Request
  env: Env
  params: Record<string, string | string[] | undefined>
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
const SITE_URL = 'https://palpitae.com.br'

// Mesmo formato validado pela API (api/src/public/router.ts). Validar aqui poupa
// a chamada quando o link vem truncado ou adulterado.
const INVITE_CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/

export interface InvitePreview {
  groupName: string
  competitionName: string | null
  memberCount: number
}

export interface InviteMeta {
  title: string
  description: string
}

export function normalizeInviteCode(raw: string | string[] | undefined): string | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase() ?? ''
  return INVITE_CODE_RE.test(value) ? value : null
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
): Promise<InvitePreview | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const base = apiUrl.replace(/\/+$/, '')
    const res = await fetchImpl(`${base}/public/invites/${encodeURIComponent(code)}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (res.status !== 200) return null
    const body = (await res.json()) as {
      invite?: { group_name?: unknown; competition_name?: unknown; member_count?: unknown }
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
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Textos do card. Sem dados do grupo, null: o HTML mantém o OG genérico. */
export function buildInviteMeta(preview: InvitePreview | null): InviteMeta | null {
  if (!preview) return null
  const participants =
    preview.memberCount === 1 ? '1 participante' : `${preview.memberCount} participantes`
  const parts = [preview.competitionName, participants, 'grátis, sem apostas'].filter(Boolean)
  return {
    title: `Entre no bolão ${preview.groupName} no Palpitae`,
    description: parts.join(' · '),
  }
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
      .on('meta[name="description"]', setContent(meta.description))
      .on('meta[property="og:title"]', setContent(meta.title))
      .on('meta[property="og:description"]', setContent(meta.description))
      .on('meta[name="twitter:title"]', setContent(meta.title))
      .on('meta[name="twitter:description"]', setContent(meta.description))
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

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env, params } = context
  const url = new URL(request.url)
  // URL pura, sem os headers do visitante: um If-None-Match repassado poderia
  // voltar 304 sem corpo, e o HTML reescrito sairia vazio.
  const shell = await env.ASSETS.fetch(new URL('/', url).toString())
  if (shell.status !== 200) return shell

  try {
    const code = normalizeInviteCode(params.code)
    const preview = code ? await fetchInvitePreview(code, env.API_URL || DEFAULT_API_URL) : null
    const pageUrl = code ? `${SITE_URL}/convite/${code}` : `${SITE_URL}/`
    return rewriteInviteHtml(shell, buildInviteMeta(preview), pageUrl)
  } catch {
    // Último recurso: a SPA sem personalização ainda resolve o convite.
    return shell
  }
}
