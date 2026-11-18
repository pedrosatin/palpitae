/**
 * Pages Function de `/grupo/:publicId`: preview do link de pedido de entrada.
 *
 * Mesmo papel da Function de `/convite/:code`, com menos dados: só nome,
 * campeonato e total de membros. Sempre `noindex`.
 */

import { withSecurityHeaders } from '../_securityHeaders'
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from '../api/[[path]]'

interface AssetsFetcher {
  fetch(input: Request | string): Promise<Response>
}

export interface Env {
  ASSETS: AssetsFetcher
  API_URL?: string
  PROXY_SHARED_SECRET?: string
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
export const SITE_URL = 'https://palpitae.com.br'
export const API_TIMEOUT_MS = 1500
export const VISITOR_API_TIMEOUT_MS = 800

const PUBLIC_ID_RE = /^[a-f0-9]{32}$/

type GroupPreview = {
  group_name: string
  competition_name: string | null
  member_count: number
}

export function normalizePublicId(raw: string | undefined): string | null {
  const value = raw?.trim().toLowerCase() ?? ''
  return PUBLIC_ID_RE.test(value) ? value : null
}

export function buildGroupMeta(preview: GroupPreview | null): { title: string; description: string } | null {
  if (!preview) return null
  const title = `Pedido para ${preview.group_name} — Palpitae`
  const parts = [
    preview.competition_name,
    `${preview.member_count} ${preview.member_count === 1 ? 'participante' : 'participantes'}`,
  ].filter(Boolean)
  return {
    title,
    description: parts.length
      ? `${parts.join(' · ')}. Peça para entrar no bolão grátis.`
      : 'Peça para entrar no bolão grátis no Palpitae.',
  }
}

async function fetchGroupPreview(
  publicId: string,
  apiUrl: string,
  timeoutMs: number,
  request: Request,
  env: Env,
): Promise<GroupPreview | null> {
  const headers: Record<string, string> = {}
  const clientIp = request.headers.get('CF-Connecting-IP')
  if (env.PROXY_SHARED_SECRET && clientIp) {
    headers[CLIENT_IP_HEADER] = clientIp
    headers[PROXY_SECRET_HEADER] = env.PROXY_SHARED_SECRET
  }
  try {
    const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/public/groups/${publicId}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      cf: { cacheTtlByStatus: { '200-299': 300, 404: 60, '500-599': 0 } },
    } as RequestInit)
    if (!res.ok) return null
    const body = (await res.json()) as { group?: GroupPreview }
    if (!body.group?.group_name || typeof body.group.member_count !== 'number') return null
    return body.group
  } catch {
    return null
  }
}

function rewriteHtml(
  response: Response,
  meta: { title: string; description: string } | null,
  pageUrl: string,
): Response {
  const setContent = (value: string) => ({
    element(el: RewriterElement) {
      el.setAttribute('content', value)
    },
  })

  let rewriter = new HTMLRewriter()
    .on('meta[name="robots"]', setContent('noindex'))
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
  headers.delete('Content-Length')
  headers.delete('ETag')
  headers.set('Cache-Control', 'no-cache')
  return rewriter.transform(new Response(response.body, { status: 200, statusText: 'OK', headers }))
}

export async function onRequest(context: PagesContext): Promise<Response> {
  return withSecurityHeaders(await respond(context))
}

async function respond(context: PagesContext): Promise<Response> {
  const { request, env, params } = context
  const shell = await env.ASSETS.fetch(new URL('/', request.url).toString())
  if (!shell.ok) return shell

  const raw = params.publicId
  const publicId = normalizePublicId(typeof raw === 'string' ? raw : undefined)
  const pageUrl = publicId ? `${SITE_URL}/grupo/${publicId}` : `${SITE_URL}/`
  const ua = request.headers.get('User-Agent') ?? ''
  const crawler = /bot|crawl|slurp|facebookexternalhit|whatsapp|telegram|twitterbot|linkedinbot/i.test(
    ua,
  )

  const preview = publicId
    ? await fetchGroupPreview(
        publicId,
        env.API_URL || DEFAULT_API_URL,
        crawler ? API_TIMEOUT_MS : VISITOR_API_TIMEOUT_MS,
        request,
        env,
      )
    : null

  return rewriteHtml(shell, buildGroupMeta(preview), pageUrl)
}
