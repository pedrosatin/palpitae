import type { JwtPayload } from './jwt'
import { verifyJwt } from './jwt'

export class SessionStorageError extends Error {}

export async function sessionHash(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Valida o JWT e consulta, numa única leitura do D1, a revogação do token
 * (logout) e o corte de sessões do usuário (`users.sessions_valid_after`, gravado
 * por `POST /auth/logout-all`). Token com `iat` menor ou igual ao corte é
 * rejeitado, inclusive o da sessão que pediu a saída.
 */
export async function verifySession(
  token: string,
  secret: string,
  db: D1Database,
): Promise<JwtPayload> {
  const payload = await verifyJwt(token, secret)
  const hash = await sessionHash(token)
  let row: { revoked: number; valid_after: number | null } | null
  try {
    row = await db
      .prepare(
        `SELECT
           EXISTS (SELECT 1 FROM revoked_sessions WHERE token_hash = ? AND expires_at > ?) AS revoked,
           (SELECT sessions_valid_after FROM users WHERE id = ?) AS valid_after`,
      )
      .bind(hash, Math.floor(Date.now() / 1000), payload.sub)
      .first<{ revoked: number; valid_after: number | null }>()
  } catch {
    throw new SessionStorageError('Session storage unavailable')
  }
  if (row?.revoked) throw new Error('Session revoked')
  if (isBeforeCutoff(payload, row?.valid_after)) throw new Error('Session revoked')
  return payload
}

/** Sem `iat` numérico o token conta como emitido antes de qualquer corte. */
function isBeforeCutoff(payload: JwtPayload, validAfter: number | null | undefined): boolean {
  if (validAfter === null || validAfter === undefined) return false
  const issuedAt = Number.isFinite(payload.iat) ? payload.iat : 0
  return issuedAt <= validAfter
}

/**
 * Invalida todas as sessões do usuário emitidas até agora. O `iat` do JWT tem
 * resolução de segundos, então um login concluído no mesmo segundo do pedido
 * também cai. `MAX` impede que um relógio atrasado reabra sessões já cortadas.
 */
export async function revokeAllSessions(userId: string, db: D1Database): Promise<void> {
  await db
    .prepare(
      'UPDATE users SET sessions_valid_after = MAX(COALESCE(sessions_valid_after, 0), ?) WHERE id = ?',
    )
    .bind(Math.floor(Date.now() / 1000), userId)
    .run()
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
