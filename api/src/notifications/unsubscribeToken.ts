/**
 * Dedicated, stateless token for one-click e-mail unsubscribe links.
 *
 * Deliberately NOT a JWT: the auth middleware (`requireAuth`) accepts any valid
 * HS256 JWT signed with JWT_SECRET, so reusing the session token here would turn
 * an unsubscribe URL — which travels inside every e-mail — into a bearer session
 * token. This token carries only the user id and a separate HMAC, so it can be
 * verified to act on the right user but is useless as a credential.
 *
 * No expiry: an unsubscribe link from an old e-mail must keep working forever.
 * The HMAC is domain-separated with a fixed prefix so a token minted here can
 * never collide with any other HMAC use of JWT_SECRET.
 */

import { base64UrlDecode, base64UrlEncode } from '../auth/encoding'

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const
const PREFIX = 'unsub:'

function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), ALGORITHM, false, [
    'sign',
    'verify',
  ])
}

/** Mints `<base64url(userId)>.<base64url(hmac)>` for the unsubscribe link. */
export async function signUnsubToken(userId: string, secret: string): Promise<string> {
  const key = await importKey(secret)
  const message = new TextEncoder().encode(PREFIX + userId)
  const sig = await crypto.subtle.sign(ALGORITHM, key, message)
  const idPart = base64UrlEncode(new TextEncoder().encode(userId).buffer as ArrayBuffer)
  return `${idPart}.${base64UrlEncode(sig)}`
}

/**
 * Verifies a token and returns the user id. Throws on a malformed or tampered
 * token. Uses crypto.subtle.verify for a constant-time signature comparison.
 */
export async function verifyUnsubToken(token: string, secret: string): Promise<string> {
  const parts = token.split('.')
  if (parts.length !== 2) throw new Error('Invalid unsubscribe token format')

  const [idPart, sigPart] = parts as [string, string]
  const userId = new TextDecoder().decode(base64UrlDecode(idPart))

  const key = await importKey(secret)
  const valid = await crypto.subtle.verify(
    ALGORITHM,
    key,
    base64UrlDecode(sigPart),
    new TextEncoder().encode(PREFIX + userId),
  )
  if (!valid) throw new Error('Invalid unsubscribe token signature')

  return userId
}
