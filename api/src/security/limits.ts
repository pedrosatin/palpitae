import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { AppContext } from '../types'
import { HMAC_SHA256, importHmacKey } from '../auth/crypto'
import { resolveSession } from '../auth/middleware'
import { logError } from '../observability/events'
import { meterD1Rows, type D1RowUsage } from './d1Usage'

const WINDOW_SECONDS = 60

type Category = 'read' | 'write' | 'oauth'

// Limites por minuto de cada identidade (um usuário logado ou um IP).
export const LIMITS: Record<Category, number> = { read: 300, write: 60, oauth: 30 }

// Teto do balde anônimo compartilhado: tráfego que chega por um Worker sem o
// segredo válido, quando não há como saber o IP do visitante. Há um balde para o
// próprio front e outro para os demais Workers, para que um Worker de terceiros não
// esgote a quota de quem usa o site. O front é o CF-Worker igual ao host do
// FRONTEND_URL, a um domínio pai dele ou ao FRONTEND_WORKER_ZONE.
export const SHARED_PROXY_LIMITS: Record<Category, number> = {
  read: 3000,
  write: 600,
  oauth: 300,
}

// Headers que o proxy do Pages (web/functions/api/[[path]].ts) envia.
export const CLIENT_IP_HEADER = 'X-Palpitae-Client-IP'
export const PROXY_SECRET_HEADER = 'X-Palpitae-Proxy-Secret'
/** Só a Function de convite envia; o proxy público remove (web/functions/api/[[path]].ts). */
export const INVITE_OPEN_HEADER = 'X-Palpitae-Invite-Open'

// Em subrequests de Worker entre zonas diferentes, a Cloudflare troca o
// CF-Connecting-IP por este endereço fixo e adiciona o header CF-Worker.
// https://developers.cloudflare.com/fundamentals/reference/http-headers/
const WORKER_EGRESS_IP = '2a06:98c0:3600::103'

const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/

const DAY_SECONDS = 86_400

// Orçamento diário de linhas do D1 por usuário (ADR-022). O dia vira à 00:00 UTC,
// junto com as cotas do D1 Free. As variáveis D1_DAILY_ROWS_READ_PER_USER e
// D1_DAILY_ROWS_WRITTEN_PER_USER substituem os padrões.
export const DAILY_D1_ROWS = { read: 250_000, written: 5_000 }

// Linhas que a gravação do balde diário escreve em cada requisição, somando as duas
// linhas do balde e as entradas delas no índice de expiração. Valor fixo, porque a
// própria gravação não tem como se medir.
export const DAILY_BUCKET_ROWS_WRITTEN = 4

// Rotas que nunca recusam por orçamento diário. Sair da conta tem de funcionar
// mesmo depois que um token roubado gastou o dia inteiro.
const DAILY_BUDGET_EXEMPT = new Set(['/auth/logout', '/auth/logout-all'])

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

type DailyKeys = { read: string; written: string }
type DailyLimits = { read: number; written: number }

/**
 * Limites diários a partir das variáveis de ambiente. Vazio ou ausente vale o
 * padrão. Um valor que não seja inteiro positivo também volta ao padrão, com erro no
 * log, para que um erro de digitação não tire o limite nem bloqueie todo mundo.
 */
export function dailyD1Limits(env: {
  D1_DAILY_ROWS_READ_PER_USER?: string
  D1_DAILY_ROWS_WRITTEN_PER_USER?: string
}): DailyLimits {
  return {
    read: rowLimit(
      'D1_DAILY_ROWS_READ_PER_USER',
      env.D1_DAILY_ROWS_READ_PER_USER,
      DAILY_D1_ROWS.read,
    ),
    written: rowLimit(
      'D1_DAILY_ROWS_WRITTEN_PER_USER',
      env.D1_DAILY_ROWS_WRITTEN_PER_USER,
      DAILY_D1_ROWS.written,
    ),
  }
}

function rowLimit(name: string, raw: string | undefined, fallback: number): number {
  const value = raw?.trim()
  if (!value) return fallback
  if (/^\d+$/.test(value) && Number(value) > 0) return Number(value)
  console.error(`[limits] ${name} inválido (${JSON.stringify(raw)}): usando ${fallback}.`)
  return fallback
}

function dayStart(now: number): number {
  return Math.floor(now / DAY_SECONDS) * DAY_SECONDS
}

/** Se o usuário já gastou no dia de hoje as linhas lidas ou escritas do orçamento. */
export async function dailyBudgetExhausted(
  db: D1Database,
  keys: DailyKeys,
  limits: DailyLimits,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { results } = await db
    .prepare(
      `SELECT bucket_key, hits FROM request_limits
      WHERE bucket_key IN (?, ?) AND window_start >= ?`,
    )
    .bind(keys.read, keys.written, dayStart(now))
    .all<{ bucket_key: string; hits: number }>()
  return results.some((row) =>
    row.bucket_key === keys.read ? row.hits >= limits.read : row.hits >= limits.written,
  )
}

/**
 * Soma ao balde do dia as linhas da requisição. Um balde de outro dia recomeça do
 * valor desta requisição. A gravação escreve as duas linhas numa só consulta.
 */
export async function chargeDailyBudget(
  db: D1Database,
  keys: DailyKeys,
  usage: D1RowUsage,
  now = Math.floor(Date.now() / 1000),
): Promise<void> {
  const start = dayStart(now)
  const end = start + DAY_SECONDS
  await db
    .prepare(
      `INSERT INTO request_limits (bucket_key, window_start, hits, expires_at)
      VALUES (?, ?, ?, ?), (?, ?, ?, ?)
      ON CONFLICT (bucket_key) DO UPDATE SET
        hits = CASE WHEN request_limits.window_start >= excluded.window_start
          THEN request_limits.hits + excluded.hits ELSE excluded.hits END,
        window_start = MAX(request_limits.window_start, excluded.window_start),
        expires_at = MAX(request_limits.expires_at, excluded.expires_at)`,
    )
    .bind(
      keys.read,
      start,
      usage.rowsRead,
      end,
      keys.written,
      start,
      usage.rowsWritten + DAILY_BUCKET_ROWS_WRITTEN,
      end,
    )
    .run()
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
export async function sameSecret(provided: string, expected: string): Promise<boolean> {
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
    const source = isFrontendZone(workerZone, c.env.FRONTEND_URL, c.env.FRONTEND_WORKER_ZONE)
      ? 'frontend'
      : 'worker'
    return { identity: `proxy:anonymous:${source}`, shared: true }
  }
  // Local requests share a dev bucket.
  return {
    identity: `ip:${connectingIp ? ipBucketIdentity(connectingIp) : 'local'}`,
    shared: false,
  }
}

// O CF-Worker traz a zona do Worker que fez o subrequest. É do próprio front quando
// é igual ao host do FRONTEND_URL, ou a um domínio pai dele, ou ao FRONTEND_WORKER_ZONE.
// Esse é o `<projeto>.pages.dev` que a Cloudflare preenche no proxy do Pages. A
// comparação com o FRONTEND_WORKER_ZONE é exata, sem sufixo, e valor vazio não casa
// nada.
function isFrontendZone(
  zone: string | undefined,
  frontendUrl: string | undefined,
  frontendWorkerZone: string | undefined,
): boolean {
  const value = zone?.trim().toLowerCase()
  if (!value) return false
  const pagesZone = frontendWorkerZone?.trim().toLowerCase()
  if (pagesZone && value === pagesZone) return true
  if (!frontendUrl) return false
  let host: string
  try {
    host = new URL(frontendUrl).hostname.toLowerCase()
  } catch {
    return false
  }
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

  // Daqui em diante toda consulta da requisição passa pelo medidor, inclusive as do
  // próprio limitador. O env é copiado, porque o objeto original serve a outras requisições.
  const db = c.env.DB
  const usage: D1RowUsage = { rowsRead: 0, rowsWritten: 0 }
  c.env = { ...c.env, DB: meterD1Rows(db, usage) }

  // Sessão válida: só o balde do usuário. O IP não entra, porque pelo proxy do
  // Pages ele não identifica o visitante.
  const session = await resolveSession(c)
  const userId = session && 'payload' in session ? session.payload.sub : null
  let identity: string
  let limit = LIMITS[category]
  let daily: DailyKeys | null = null
  if (userId) {
    identity = `user:${userId}`
  } else {
    const anonymous = await anonymousIdentity(c)
    identity = anonymous.identity
    if (anonymous.shared) limit = SHARED_PROXY_LIMITS[category]
  }

  try {
    if (userId) {
      const [read, written] = await Promise.all([
        bucketKey(c.env.JWT_SECRET, `d1_read:${identity}`),
        bucketKey(c.env.JWT_SECRET, `d1_written:${identity}`),
      ])
      daily = { read, written }
      // Vem antes do balde por minuto, que gravaria uma linha. A recusa por orçamento
      // só lê.
      if (
        !DAILY_BUDGET_EXEMPT.has(c.req.path) &&
        (await dailyBudgetExhausted(c.env.DB, daily, dailyD1Limits(c.env)))
      ) {
        const now = Math.floor(Date.now() / 1000)
        c.header('Retry-After', String(dayStart(now) + DAY_SECONDS - now))
        return c.json(
          {
            error:
              'Você atingiu o limite diário de uso. Tente de novo depois das 21h, horário de Brasília.',
          },
          429,
        )
      }
    }
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

  await next()

  if (!daily) return
  // A resposta já foi montada, e uma falha aqui só fica no log.
  try {
    await chargeDailyBudget(db, daily, usage)
  } catch (error) {
    logError(
      c.env.AE,
      'security_storage_error',
      '[limits] Orçamento diário do D1 indisponível:',
      error,
      { blobs: ['request_limits', 'daily_d1'] },
    )
  }
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
