import { describe, expect, it } from 'vitest'
import { buildAuthUrl, generateNonce, generatePkce, generateState, upsertUser } from './google'

describe('generateState', () => {
  it('returns a URL-safe base64 string', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('is at least 20 characters long', () => {
    expect(generateState().length).toBeGreaterThanOrEqual(20)
  })

  it('generates unique values on each call', () => {
    expect(generateState()).not.toBe(generateState())
  })
})

describe('generateNonce', () => {
  it('returns a URL-safe base64 string', () => {
    expect(generateNonce()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('is at least 20 characters long', () => {
    expect(generateNonce().length).toBeGreaterThanOrEqual(20)
  })

  it('generates unique values on each call', () => {
    expect(generateNonce()).not.toBe(generateNonce())
  })
})

describe('generatePkce', () => {
  it('returns a verifier and challenge that are different', async () => {
    const { verifier, challenge } = await generatePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(verifier).not.toBe(challenge)
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
})
