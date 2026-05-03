/**
 * HS256 JWT implementation using Web Crypto API.
 * Compatible with Cloudflare Workers and Node.js 18+.
 */

import { base64UrlEncode, base64UrlDecode } from './encoding'

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    ALGORITHM,
    false,
    ['sign', 'verify'],
  )
}

export interface JwtPayload {
  sub: string
  email: string
  iat: number
  exp: number
}

export async function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: JwtPayload = { ...payload, iat: now, exp: now + expiresInSeconds }

  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).buffer as ArrayBuffer)
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(fullPayload)).buffer as ArrayBuffer)
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

  const key = await importKey(secret)
  const valid = await crypto.subtle.verify(
    ALGORITHM,
    key,
    base64UrlDecode(sig),
    new TextEncoder().encode(signingInput),
  )

  if (!valid) throw new Error('Invalid JWT signature')

  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(body)),
  ) as JwtPayload

  const now = Math.floor(Date.now() / 1000)
  if (payload.exp < now) throw new Error('JWT expired')

  return payload
}
