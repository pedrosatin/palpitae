import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { AppContext } from '../types'
import { HMAC_SHA256, importHmacKey } from '../auth/crypto'
import { resolveSession } from '../auth/middleware'
import { logError } from '../observability/events'

const WINDOW_SECONDS = 60

type Category = 'read' | 'write' | 'oauth'

// Limites por minuto de cada identidade (um usuário logado ou um IP).
export const LIMITS: Record<Category, number> = { read: 300, write: 60, oauth: 30 }

// Teto do balde anônimo compartilhado: tráfego que chega por um Worker sem o
// segredo válido, quando não há como saber o IP do visitante. Há um balde para o
// próprio front (CF-Worker da zona do FRONTEND_URL) e outro para os demais Workers,
// para que um Worker de terceiros não esgote a quota de quem usa o site.
export const SHARED_PROXY_LIMITS: Record<Category, number> = {
  read: 3000,
  write: 600,
  oauth: 300,
}

// Headers que o proxy do Pages (web/functions/api/[[path]].ts) envia.
export const CLIENT_IP_HEADER = 'X-Palpitae-Client-IP'
export const PROXY_SECRET_HEADER = 'X-Palpitae-Proxy-Secret'

// Em subrequests de Worker entre zonas diferentes, a Cloudflare troca o
// CF-Connecting-IP por este endereço fixo e adiciona o header CF-Worker.
// https://developers.cloudflare.com/fundamentals/reference/http-headers/
const WORKER_EGRESS_IP = '2a06:98c0:3600::103'

const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/

// D1 serializes the upsert, including requests from different Worker instances.
// `key` should already be an opaque hash (see bucketKey).
//
// O WHERE do DO UPDATE impede a escrita quando o balde da janela atual já está
// cheio: a requisição recusada só lê a linha, não grava nada, e o RETURNING volta
// vazio. Assim um cliente insistente recebendo 429 não vira uma escrita no D1 por
// requisição.
export async function consumeLimit(
  db: D1Database,
  key: string,
  limit: number,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const windowStart = Math.floor(now / WINDOW_SECONDS) * WINDOW_SECONDS
  const result = await db
    .prepare(`INSERT INTO request_limits (bucket_key, window_start, hits, expires_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT (bucket_key) DO UPDATE SET
        hits = CASE WHEN request_limits.window_start >= excluded.window_start
          THEN request_limits.hits + 1 ELSE 1 END,
        window_start = MAX(request_limits.window_start, excluded.window_start),
        expires_at = MAX(request_limits.expires_at, excluded.expires_at)
      WHERE request_limits.window_start < excluded.window_start
         OR request_limits.hits < ?
      RETURNING hits`)
    .bind(key, windowStart, windowStart + WINDOW_SECONDS, limit)
    .first<{ hits: number }>()
  return result !== null && result.hits <= limit
}

/**
 * Normaliza o IP usado como identidade anônima. IPv4 fica como está. IPv6 é
 * agrupado pelo prefixo /64, que é o que um único cliente costuma receber: contar
 * por endereço completo daria 2^64 baldes a quem controla um /64. Endereço
 * IPv4-mapped (::ffff:a.b.c.d) vira o IPv4. Valor que não parece IPv6 volta igual.
 */
export function ipBucketIdentity(ip: string): string {
  const value = ip.trim().toLowerCase()
  if (!value.includes(':')) return value
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return mapped[1]
  const hextets = expandIpv6(value)
  if (!hextets) return value
  return `${hextets
    .slice(0, 4)
    .map((h) => parseInt(h, 16).toString(16))
    .join(':')}::/64`
}

function expandIpv6(value: string): string[] | null {
  const halves = value.split('::')
  if (halves.length > 2) return null
  const toHextets = (part: string): string[] | null => {
    if (!part) return []
    const out: string[] = []
    for (const piece of part.split(':')) {
      if (piece.includes('.')) {
        // IPv4 embutido no fim: vira dois hextets.
        const octets = piece.split('.').map(Number)
        if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255))
          return null
        out.push(
          ((octets[0] << 8) | octets[1]).toString(16),
          ((octets[2] << 8) | octets[3]).toString(16),
        )
      } else if (/^[0-9a-f]{1,4}$/.test(piece)) {
        out.push(piece)
      } else {
        return null
      }
    }
    return out
  }
  const head = toHextets(halves[0])
  const tail = halves.length === 2 ? toHextets(halves[1]) : []
  if (!head || !tail) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const missing = 8 - head.length - tail.length
  if (missing < 1) return null
  return [...head, ...Array<string>(missing).fill('0'), ...tail]
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await importHmacKey(secret)
  const signature = await crypto.subtle.sign(HMAC_SHA256, key, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

// HMAC com segredo: um SHA-256 puro de um IPv4 sai por força bruta.
export function bucketKey(secret: string, identity: string): Promise<string> {
  return hmacHex(secret, identity)
}

// Compara os HMACs dos dois valores, byte a byte, sem sair no primeiro byte diferente.
async function sameSecret(provided: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([hmacHex(expected, provided), hmacHex(expected, expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Identidade de uma requisição sem sessão válida.
 *
 * - Proxy com segredo válido: IP do visitante repassado pelo proxy.
 * - Subrequest de Worker sem segredo válido: balde anônimo compartilhado, porque
 *   o CF-Connecting-IP é o endereço de saída da Cloudflare, igual para todos. O
 *   balde é separado por origem: o próprio front (`frontend`) ou qualquer outro
 *   Worker (`worker`).
 * - Acesso direto: CF-Connecting-IP. Headers do proxy sem o segredo são ignorados.
 *
 * IPv6 conta pelo prefixo /64 (ver ipBucketIdentity).
 */
export async function anonymousIdentity(
  c: Context<AppContext>,
): Promise<{ identity: string; shared: boolean }> {
  const secret = c.env.PROXY_SHARED_SECRET
  const providedSecret = c.req.header(PROXY_SECRET_HEADER)
  const forwardedIp = c.req.header(CLIENT_IP_HEADER)?.trim()
  if (
    secret &&
    providedSecret &&
    forwardedIp &&
    IP_PATTERN.test(forwardedIp) &&
    (await sameSecret(providedSecret, secret))
  ) {
    return { identity: `ip:${ipBucketIdentity(forwardedIp)}`, shared: false }
  }
  const connectingIp = c.req.header('CF-Connecting-IP')
  const workerZone = c.req.header('CF-Worker')
  if (workerZone || connectingIp === WORKER_EGRESS_IP) {
    const source = isFrontendZone(workerZone, c.env.FRONTEND_URL) ? 'frontend' : 'worker'
    return { identity: `proxy:anonymous:${source}`, shared: true }
  }
  // Local requests share a dev bucket.
  return {
    identity: `ip:${connectingIp ? ipBucketIdentity(connectingIp) : 'local'}`,
    shared: false,
  }
}

// O CF-Worker traz a zona do Worker que fez o subrequest. É do próprio front quando
// a zona é o host do FRONTEND_URL ou um domínio pai dele.
function isFrontendZone(zone: string | undefined, frontendUrl: string | undefined): boolean {
  if (!zone || !frontendUrl) return false
  let host: string
  try {
    host = new URL(frontendUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  const value = zone.trim().toLowerCase()
  return value === host || host.endsWith(`.${value}`)
}

export const requestLimits = createMiddleware<AppContext>(async (c, next) => {
  if (c.req.path === '/health' || c.req.method === 'OPTIONS') return next()
  const isRead = c.req.method === 'GET' || c.req.method === 'HEAD'
  const origin = c.req.header('Origin')
  if (!isRead && origin && origin !== c.env.FRONTEND_URL && origin !== safeOrigin(c.env.BASE_URL)) {
    return c.json({ error: 'Origem não autorizada' }, 403)
  }
  const category: Category =
    c.req.path.startsWith('/auth/google') || c.req.path.startsWith('/auth/callback')
      ? 'oauth'
      : isRead
        ? 'read'
        : 'write'

  // Sessão válida: só o balde do usuário. O IP não entra, porque pelo proxy do
  // Pages ele não identifica o visitante.
  const session = await resolveSession(c)
  let identity: string
  let limit = LIMITS[category]
  if (session && 'payload' in session) {
    identity = `user:${session.payload.sub}`
  } else {
    const anonymous = await anonymousIdentity(c)
    identity = anonymous.identity
    if (anonymous.shared) limit = SHARED_PROXY_LIMITS[category]
  }

  try {
    const key = await bucketKey(c.env.JWT_SECRET, `${category}:${identity}`)
    if (!(await consumeLimit(c.env.DB, key, limit))) {
      c.header(
        'Retry-After',
        String(WINDOW_SECONDS - (Math.floor(Date.now() / 1000) % WINDOW_SECONDS)),
      )
      return c.json({ error: 'Muitas requisições. Tente novamente em instantes.' }, 429)
    }
  } catch (error) {
    logError(
      c.env.AE,
      'security_storage_error',
      '[limits] Contador de requisições indisponível:',
      error,
      { blobs: ['request_limits', category] },
    )
    // Leitura passa sem contador; escrita e OAuth ficam bloqueadas.
    if (category !== 'read') return c.json({ error: 'Controle de requisições indisponível' }, 503)
  }
  return next()
})

function safeOrigin(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export async function clearExpiredSecurityRecords(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await db.batch([
    db.prepare('DELETE FROM request_limits WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM revoked_sessions WHERE expires_at <= ?').bind(now),
  ])
}
