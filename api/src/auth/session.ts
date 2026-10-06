import type { JwtPayload } from './jwt'
import { verifyJwt } from './jwt'

export class SessionStorageError extends Error {}

export async function sessionHash(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifySession(
  token: string,
  secret: string,
  db: D1Database,
): Promise<JwtPayload> {
  const payload = await verifyJwt(token, secret)
  const hash = await sessionHash(token)
  let revoked: { token_hash: string } | null
  try {
    revoked = await db
      .prepare('SELECT token_hash FROM revoked_sessions WHERE token_hash = ? AND expires_at > ?')
      .bind(hash, Math.floor(Date.now() / 1000))
      .first<{ token_hash: string }>()
  } catch {
    throw new SessionStorageError('Session storage unavailable')
  }
  if (revoked?.token_hash === hash) throw new Error('Session revoked')
  return payload
}

export async function revokeSession(token: string, secret: string, db: D1Database): Promise<void> {
  let payload: JwtPayload
  try {
    payload = await verifyJwt(token, secret)
  } catch {
    return
  }
  await db
    .prepare('INSERT OR IGNORE INTO revoked_sessions (token_hash, expires_at) VALUES (?, ?)')
    .bind(await sessionHash(token), payload.exp)
    .run()
}
