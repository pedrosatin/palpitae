import { describe, expect, it } from 'vitest'
import {
  buildAuthUrl,
  generateNonce,
  generatePkce,
  generateState,
  upsertUser,
  verifyGoogleIdToken,
  clearJwksCacheForTest,
} from './google'
import { beforeAll, vi, beforeEach, afterEach } from 'vitest'
import { base64UrlEncode } from './encoding'

describe('generateState', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a URL-safe base64 string', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('is exactly 43 characters long (32 bytes base64url encoded)', () => {
    expect(generateState()).toHaveLength(43)
  })

  it('generates unique values on each call', () => {
    expect(generateState()).not.toBe(generateState())
  })

  it('calls crypto.getRandomValues with a 32-byte Uint8Array', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues')
    generateState()
    expect(spy).toHaveBeenCalledTimes(1)
    const arrayArg = spy.mock.calls[0][0] as Uint8Array
    expect(arrayArg).toBeInstanceOf(Uint8Array)
    expect(arrayArg.length).toBe(32)
  })
})

describe('generateNonce', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a URL-safe base64 string', () => {
    expect(generateNonce()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('is exactly 22 characters long (16 bytes base64url encoded)', () => {
    expect(generateNonce()).toHaveLength(22)
  })

  it('generates unique values on each call', () => {
    expect(generateNonce()).not.toBe(generateNonce())
  })

  it('calls crypto.getRandomValues with a 16-byte Uint8Array', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues')
    generateNonce()
    expect(spy).toHaveBeenCalledTimes(1)
    const arrayArg = spy.mock.calls[0][0] as Uint8Array
    expect(arrayArg).toBeInstanceOf(Uint8Array)
    expect(arrayArg.length).toBe(16)
  })
})

describe('generatePkce', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a verifier and challenge that are different', async () => {
    const { verifier, challenge } = await generatePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(verifier).not.toBe(challenge)
  })

  it('verifier is exactly 86 characters long (64 bytes base64url encoded)', async () => {
    const { verifier } = await generatePkce()
    expect(verifier).toHaveLength(86)
  })

  it('calls crypto.getRandomValues with a 64-byte Uint8Array for verifier', async () => {
    const spy = vi.spyOn(crypto, 'getRandomValues')
    await generatePkce()
    expect(spy).toHaveBeenCalledTimes(1)
    const arrayArg = spy.mock.calls[0][0] as Uint8Array
    expect(arrayArg).toBeInstanceOf(Uint8Array)
    expect(arrayArg.length).toBe(64)
  })

  it('challenge is the SHA-256 hash of the verifier (base64url)', async () => {
    const { verifier, challenge } = await generatePkce()
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    const expected = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
    expect(challenge).toBe(expected)
  })

  it('produces unique pairs on each call', async () => {
    const a = await generatePkce()
    const b = await generatePkce()
    expect(a.verifier).not.toBe(b.verifier)
  })
})

describe('upsertUser', () => {
  function makeDb(existingUser: { id: string; email: string } | null) {
    const updates: Array<{ sql: string; bindings: unknown[] }> = []
    const inserts: Array<{ sql: string; bindings: unknown[] }> = []

    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first() {
                if (sql.includes('SELECT id, email FROM users')) return existingUser
                return null
              },
              async run() {
                updates.push({ sql, bindings: args })
              },
            }
          },
        }
      },
      async batch(
        stmts: Array<{
          bind: (...a: unknown[]) => { run: () => Promise<void> }
        }>,
      ) {
        for (const stmt of stmts)
          inserts.push(stmt as unknown as { sql: string; bindings: unknown[] })
      },
      _updates: updates,
      _inserts: inserts,
    } as unknown as D1Database & {
      _updates: typeof updates
      _inserts: typeof inserts
    }

    return db
  }

  it('inserts new user with user_name and last_login', async () => {
    const db = makeDb(null)
    const result = await upsertUser(db, {
      email: 'new@example.com',
      providerId: 'gid-1',
      provider: 'google',
      name: 'Alice',
    })
    expect(result.email).toBe('new@example.com')
    expect(result.id).toBeTruthy()
    expect((db as unknown as ReturnType<typeof makeDb>)._inserts).toHaveLength(2)
  })

  it('updates last_login on every login for existing user', async () => {
    const db = makeDb({ id: 'uid-1', email: 'existing@example.com' })
    const result = await upsertUser(db, {
      email: 'existing@example.com',
      providerId: 'gid-1',
      provider: 'google',
      name: 'Bob',
    })
    expect(result.id).toBe('uid-1')
    const updates = (db as unknown as ReturnType<typeof makeDb>)._updates
    expect(updates).toHaveLength(1)
    expect(updates[0].sql).toContain('last_login')
    expect(updates[0].sql).toContain('COALESCE(user_name')
  })

  it('does not insert new record for existing user', async () => {
    const db = makeDb({ id: 'uid-2', email: 'existing@example.com' })
    await upsertUser(db, {
      email: 'existing@example.com',
      providerId: 'gid-2',
      provider: 'google',
    })
    expect((db as unknown as ReturnType<typeof makeDb>)._inserts).toHaveLength(0)
  })
})

describe('buildAuthUrl', () => {
  const base = {
    clientId: 'test-client-id',
    redirectUri: 'http://localhost:8787/auth/callback',
    state: 'test-state',
    nonce: 'test-nonce',
    codeChallenge: 'test-challenge',
  }

  it('points to Google OAuth endpoint', () => {
    const url = new URL(buildAuthUrl(base))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
  })

  it('sets response_type=code', () => {
    expect(new URL(buildAuthUrl(base)).searchParams.get('response_type')).toBe('code')
  })

  it('includes openid in scope', () => {
    expect(new URL(buildAuthUrl(base)).searchParams.get('scope')).toContain('openid')
  })

  it('passes state, nonce, and PKCE challenge', () => {
    const url = new URL(buildAuthUrl(base))
    expect(url.searchParams.get('state')).toBe('test-state')
    expect(url.searchParams.get('nonce')).toBe('test-nonce')
    expect(url.searchParams.get('code_challenge')).toBe('test-challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('sets the correct client_id and redirect_uri', () => {
    const url = new URL(buildAuthUrl(base))
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8787/auth/callback')
  })

  it('builds the exact expected complete URL string', () => {
    const urlString = buildAuthUrl(base)
    expect(urlString).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=test-client-id&redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fauth%2Fcallback&scope=openid+email+profile&state=test-state&nonce=test-nonce&code_challenge=test-challenge&code_challenge_method=S256&access_type=online&prompt=select_account',
    )
  })
})

describe('verifyGoogleIdToken', () => {
  const clientId = 'test-client-id'
  const expectedNonce = 'test-nonce'

  let keyPair: CryptoKeyPair
  let jwk: JsonWebKey

  beforeAll(async () => {
    keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )
    jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  })

  beforeEach(() => {
    mockFetchJwks()
    clearJwksCacheForTest()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetchJwks(keys: any[] = [{ kid: 'test-kid', n: jwk.n, e: jwk.e }]) {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      headers: new Headers({ 'Cache-Control': 'max-age=3600' }),
      json: async () => ({ keys }),
    }))
  }

  function mockFetchError() {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      text: async () => 'Internal Server Error',
    }))
  }

  async function generateToken(claimsOverrides: any = {}, headerOverrides: any = {}) {
    const header = { kid: 'test-kid', alg: 'RS256', ...headerOverrides }
    const claims = {
      sub: 'test-user',
      email: 'test@example.com',
      email_verified: true,
      name: 'Test User',
      picture: 'https://example.com/pic.jpg',
      aud: clientId,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: expectedNonce,
      ...claimsOverrides,
    }

    const rawHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)).buffer)
    const rawPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)).buffer)
    const signingInput = new TextEncoder().encode(`${rawHeader}.${rawPayload}`)
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keyPair.privateKey,
      signingInput,
    )
    const rawSig = base64UrlEncode(signature)

    return `${rawHeader}.${rawPayload}.${rawSig}`
  }

  it('verifies a valid token', async () => {
    mockFetchJwks()
    const token = await generateToken()
    const info = await verifyGoogleIdToken(token, clientId, expectedNonce)
    expect(info.sub).toBe('test-user')
    expect(info.email).toBe('test@example.com')
    expect(info.email_verified).toBe(true)
    expect(info.name).toBe('Test User')
    expect(info.picture).toBe('https://example.com/pic.jpg')
  })

  it('rejects invalid format', async () => {
    await expect(verifyGoogleIdToken('invalid.token', clientId, expectedNonce)).rejects.toThrow(
      'Invalid ID token format',
    )
  })

  it('rejects expired token', async () => {
    const token = await generateToken({ exp: Math.floor(Date.now() / 1000) - 3600 })
    await expect(verifyGoogleIdToken(token, clientId, expectedNonce)).rejects.toThrow(
      'ID token expired',
    )
  })

  it('rejects audience mismatch', async () => {
    const token = await generateToken({ aud: 'other-client' })
    await expect(verifyGoogleIdToken(token, clientId, expectedNonce)).rejects.toThrow(
      'ID token audience mismatch',
    )
  })

  it('rejects issuer mismatch', async () => {
    const token = await generateToken({ iss: 'https://invalid-issuer.com' })
    await expect(verifyGoogleIdToken(token, clientId, expectedNonce)).rejects.toThrow(
      'ID token issuer mismatch',
    )
  })

  it('rejects nonce mismatch', async () => {
    const token = await generateToken({ nonce: 'other-nonce' })
    await expect(verifyGoogleIdToken(token, clientId, expectedNonce)).rejects.toThrow(
      'Nonce mismatch',
    )
  })

  it('rejects unverified email', async () => {
    const token = await generateToken({ email_verified: false })
    await expect(verifyGoogleIdToken(token, clientId, expectedNonce)).rejects.toThrow(
      'Google email not verified',
    )
  })

  it('rejects on JWKS fetch failure', async () => {
    mockFetchError()
    const token = await generateToken()
    await expect(verifyGoogleIdToken(token, clientId, expectedNonce)).rejects.toThrow(
      'Failed to fetch Google JWKS',
    )
  })

  it('rejects when signing key not in JWKS', async () => {
    mockFetchJwks([{ kid: 'other-kid', n: jwk.n, e: jwk.e }])
    const token = await generateToken()
    await expect(verifyGoogleIdToken(token, clientId, expectedNonce)).rejects.toThrow(
      'Signing key not found in Google JWKS',
    )
  })

  it('rejects invalid signature', async () => {
    mockFetchJwks()
    const token = await generateToken()
    const parts = token.split('.')
    // Muddle the signature
    const invalidToken = `${parts[0]}.${parts[1]}.badsignature`
    await expect(verifyGoogleIdToken(invalidToken, clientId, expectedNonce)).rejects.toThrow(
      'ID token signature invalid',
    )
  })
})
