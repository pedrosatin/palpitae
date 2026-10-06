import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import type { AppContext } from '../types'
import { sessionHash, verifySession } from '../auth/session'

const WINDOW_SECONDS = 60

// D1 serializes the upsert, including requests from different Worker instances.
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
          THEN MIN(request_limits.hits + 1, ?) ELSE 1 END,
        window_start = MAX(request_limits.window_start, excluded.window_start),
        expires_at = MAX(request_limits.expires_at, excluded.expires_at)
      RETURNING hits`)
    .bind(await sessionHash(key), windowStart, windowStart + WINDOW_SECONDS, limit + 1)
    .first<{ hits: number }>()
  if (!result) throw new Error('Request limit unavailable')
  return result.hits <= limit
}

export const requestLimits = createMiddleware<AppContext>(async (c, next) => {
  if (c.req.path === '/health' || c.req.method === 'OPTIONS') return next()
  const isRead = c.req.method === 'GET' || c.req.method === 'HEAD'
  const origin = c.req.header('Origin')
  if (
    !isRead &&
    origin &&
    origin !== c.env.FRONTEND_URL &&
    origin !== new URL(c.env.BASE_URL).origin
  ) {
    return c.json({ error: 'Origem não autorizada' }, 403)
  }
  const category =
    c.req.path.startsWith('/auth/google') || c.req.path.startsWith('/auth/callback')
      ? 'oauth'
      : isRead
        ? 'read'
        : 'write'
  const limit = category === 'oauth' ? 30 : isRead ? 300 : 60
  // CF-Connecting-IP is supplied by Cloudflare. Local requests share a dev bucket.
  const identities = [`ip:${c.req.header('CF-Connecting-IP') ?? 'local'}`]
  const token = getCookie(c, 'session')
  if (token) {
    try {
      const payload = await verifySession(token, c.env.JWT_SECRET, c.env.DB)
      identities.push(`user:${payload.sub}`)
    } catch {
      // An invalid cookie never supplies a user identity.
    }
  }
  try {
    for (const identity of identities) {
      if (!(await consumeLimit(c.env.DB, `${category}:${identity}`, limit))) {
        c.header(
          'Retry-After',
          String(WINDOW_SECONDS - (Math.floor(Date.now() / 1000) % WINDOW_SECONDS)),
        )
        return c.json({ error: 'Muitas requisições. Tente novamente em instantes.' }, 429)
      }
    }
  } catch {
    return c.json({ error: 'Controle de requisições indisponível' }, 503)
  }
  return next()
})

export async function clearExpiredSecurityRecords(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await db.batch([
    db.prepare('DELETE FROM request_limits WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM revoked_sessions WHERE expires_at <= ?').bind(now),
  ])
}
