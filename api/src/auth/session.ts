import type { JwtPayload } from './jwt'
import { verifyJwt } from './jwt'
import { googleSubOf } from './permissions'

export class SessionStorageError extends Error {}

export async function sessionHash(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Valida o JWT e consulta, numa única leitura do D1, a revogação do token
 * (logout), a conta e o corte de sessões dela (`users.sessions_valid_after`,
 * gravado por `POST /auth/logout-all`). Token com `iat` menor ou igual ao corte é
 * rejeitado, inclusive o da sessão que pediu a saída, e token de conta que não
 * existe mais também. O e-mail devolvido é o gravado na conta, não o do token:
 * admin e acesso ao piloto seguem o e-mail atual da conta Google. O `sub` do Google
 * também vem da conta (`provider_id` quando `provider = 'google'`), para o
 * `ADMIN_GOOGLE_SUB` amarrar o admin à identidade e não só ao e-mail.
 */
export async function verifySession(
  token: string,
  secret: string,
  db: D1Database,
): Promise<SessionPayload> {
  const payload = await verifyJwt(token, secret)
  const hash = await sessionHash(token)
  let row: SessionRow | null
  try {
    row = await db
      .prepare(
        `SELECT
           EXISTS (SELECT 1 FROM revoked_sessions WHERE token_hash = ? AND expires_at > ?) AS revoked,
           u.sessions_valid_after AS valid_after,
           u.email AS email,
           u.provider AS provider,
           u.provider_id AS provider_id
         FROM (SELECT 1) LEFT JOIN users u ON u.id = ?`,
      )
      .bind(hash, Math.floor(Date.now() / 1000), payload.sub)
      .first<SessionRow>()
  } catch {
    throw new SessionStorageError('Session storage unavailable')
  }
  if (row?.revoked) throw new Error('Session revoked')
  if (!row?.email) throw new Error('User not found')
  if (isBeforeCutoff(payload, row.valid_after)) throw new Error('Session revoked')
  return { ...payload, email: row.email, googleSub: googleSubOf(row.provider, row.provider_id) }
}

/** Payload do token com os dados da conta lidos do D1 na validação. */
export type SessionPayload = JwtPayload & { googleSub?: string }

type SessionRow = {
  revoked: number
  valid_after: number | null
  email: string | null
  provider?: string | null
  provider_id?: string | null
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
