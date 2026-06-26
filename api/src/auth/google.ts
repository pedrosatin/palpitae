/**
 * Google OAuth 2.0 Authorization Code flow with PKCE.
 * Handles URL generation, code exchange, ID token verification, and user upsert.
 */

import { base64UrlEncode, base64UrlDecode } from './encoding'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'

// ---------------------------------------------------------------------------
// PKCE + state/nonce generators
// ---------------------------------------------------------------------------

export function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer)
}

export function generateNonce(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer)
}

export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(64)).buffer as ArrayBuffer)
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = base64UrlEncode(hash)
  return { verifier, challenge }
}

// ---------------------------------------------------------------------------
// Auth URL builder
// ---------------------------------------------------------------------------

export function buildAuthUrl(params: {
  clientId: string
  redirectUri: string
  state: string
  nonce: string
  codeChallenge: string
}): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', params.state)
  url.searchParams.set('nonce', params.nonce)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('access_type', 'online')
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export async function exchangeCode(params: {
  code: string
  codeVerifier: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<{ id_token: string; access_token: string }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      code_verifier: params.codeVerifier,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token exchange failed: ${body}`)
  }

  return res.json() as Promise<{ id_token: string; access_token: string }>
}

// ---------------------------------------------------------------------------
// ID token verification
// ---------------------------------------------------------------------------

interface JwksKey {
  kid: string
  n: string
  e: string
}

export interface GoogleUserInfo {
  sub: string
  email: string
  email_verified: boolean
  name?: string
  picture?: string
}

type GoogleIdTokenClaims = GoogleUserInfo & {
  aud: string | string[]
  iss: string
  exp: number
  nonce: string
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  expectedNonce: string,
): Promise<GoogleUserInfo> {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('Invalid ID token format')
  const [rawHeader, rawPayload, rawSig] = parts as [string, string, string]

  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(rawHeader))) as { kid: string }
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(rawPayload))) as GoogleIdTokenClaims

  // Validate standard claims
  const now = Math.floor(Date.now() / 1000)
  if (claims.exp < now) throw new Error('ID token expired')

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audiences.includes(clientId)) throw new Error('ID token audience mismatch')

  const validIssuers = ['https://accounts.google.com', 'accounts.google.com']
  if (!validIssuers.includes(claims.iss)) throw new Error('ID token issuer mismatch')

  if (claims.nonce !== expectedNonce) throw new Error('Nonce mismatch')
  if (!claims.email_verified) throw new Error('Google email not verified')

  // Verify signature against Google's JWKS
  // Workers fetch respects Cache-Control headers, so this is cached automatically
  const jwksRes = await fetch(GOOGLE_JWKS_URL)
  if (!jwksRes.ok) throw new Error('Failed to fetch Google JWKS')
  const jwks = (await jwksRes.json()) as { keys: JwksKey[] }

  const jwk = jwks.keys.find((k) => k.kid === header.kid)
  if (!jwk) throw new Error('Signing key not found in Google JWKS')

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig' },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  const signingInput = new TextEncoder().encode(`${rawHeader}.${rawPayload}`)
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    base64UrlDecode(rawSig),
    signingInput,
  )

  if (!valid) throw new Error('ID token signature invalid')

  return {
    sub: claims.sub,
    email: claims.email,
    email_verified: claims.email_verified,
    name: claims.name,
    picture: claims.picture,
  }
}

// ---------------------------------------------------------------------------
// User upsert
// ---------------------------------------------------------------------------

export async function upsertUser(
  db: D1Database,
  data: {
    email: string
    providerId: string
    provider: string
    name?: string
    avatarUrl?: string
  },
): Promise<{ id: string; email: string }> {
  const now = new Date().toISOString()

  const existing = await db
    .prepare('SELECT id, email FROM users WHERE provider = ? AND provider_id = ?')
    .bind(data.provider, data.providerId)
    .first<{ id: string; email: string }>()

  if (existing) {
    await db
      .prepare('UPDATE users SET last_login = ?, user_name = COALESCE(user_name, ?) WHERE id = ?')
      .bind(now, data.name ?? null, existing.id)
      .run()
    return existing
  }

  const id = crypto.randomUUID()

  await db.batch([
    db
      .prepare(
        'INSERT INTO users (id, email, provider, provider_id, created_at, user_name, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, data.email, data.provider, data.providerId, now, data.name ?? null, now),
    db
      .prepare('INSERT INTO profiles (user_id, nickname, avatar_url) VALUES (?, ?, ?)')
      .bind(id, data.name ?? null, data.avatarUrl ?? null),
  ])

  return { id, email: data.email }
}
