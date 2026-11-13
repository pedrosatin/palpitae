/**
 * HS256 JWT implementation using Web Crypto API.
 * Compatible with Cloudflare Workers and Node.js 18+.
 */

import { base64UrlEncode, base64UrlDecodeCanonical } from './encoding'
import { HMAC_SHA256, importHmacKey } from './crypto'

const ALGORITHM = HMAC_SHA256
const importKey = importHmacKey

export interface JwtPayload {
  sub: string
  email: string
  jti?: string
  iat: number
  exp: number
}

export async function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  }

  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).buffer as ArrayBuffer,
  )
  const body = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(fullPayload)).buffer as ArrayBuffer,
  )
  const signingInput = `${header}.${body}`

  const key = await importKey(secret)
  const signature = await crypto.subtle.sign(ALGORITHM, key, new TextEncoder().encode(signingInput))

  return `${signingInput}.${base64UrlEncode(signature)}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT format')

  const [header, body, sig] = parts as [string, string, string]
  const signingInput = `${header}.${body}`

  // Cada token tem uma única escrita aceita. A revogação do logout guarda o hash
  // do texto do token, e uma segunda escrita da mesma assinatura escaparia dela.
  let bodyBytes: ArrayBuffer
  let sigBytes: ArrayBuffer
  try {
    base64UrlDecodeCanonical(header)
    bodyBytes = base64UrlDecodeCanonical(body)
    sigBytes = base64UrlDecodeCanonical(sig)
  } catch {
    throw new Error('Invalid JWT encoding')
  }

  const key = await importKey(secret)
  const valid = await crypto.subtle.verify(
    ALGORITHM,
    key,
    sigBytes,
    new TextEncoder().encode(signingInput),
  )

  if (!valid) throw new Error('Invalid JWT signature')

  const payload = JSON.parse(new TextDecoder().decode(bodyBytes)) as JwtPayload

  const now = Math.floor(Date.now() / 1000)
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new Error('JWT expired')
  if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string') {
    throw new Error('Invalid JWT claims')
  }

  return payload
}
