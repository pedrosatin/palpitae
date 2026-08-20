import { describe, expect, it, vi, beforeEach } from 'vitest'
import app from '../index'
import type { AppContext } from '../types'
import { signJwt } from './jwt'
import * as googleAuth from './google'

const JWT_SECRET = 'test-secret-auth-router'

vi.mock('./google', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./google')>()
  return {
    ...mod,
    exchangeCode: vi.fn(),
    verifyGoogleIdToken: vi.fn(),
    upsertUser: vi.fn(),
  }
})

function fakeEnv(email: string): AppContext['Bindings'] {
  return {
    JWT_SECRET,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'http://localhost:8787',
    FRONTEND_URL: 'http://localhost:5173',
    FOOTBALL_API_KEY: 'test-api-key',
    RESEND_API_KEY: 'test-resend-key',
    DB: {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first() {
                if (sql.includes('FROM users u LEFT JOIN profiles')) {
                  return {
                    id: 'user-1',
                    email,
                    nickname: null,
                    avatar_url: null,
                  }
                }
                return null
              },
            }
          },
        }
      },
    } as unknown as D1Database,
    AE: {
      writeDataPoint() {}
    } as unknown as AnalyticsEngineDataset,
  }
}

async function requestWithCookie(email: string) {
  const token = await signJwt({ sub: 'user-1', email }, JWT_SECRET, 3600)
  const headers = new Headers({ Cookie: `session=${token}` })
  return app.fetch(new Request('http://localhost/auth/me', { headers }), fakeEnv(email))
}

describe('auth router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /google', () => {
    it('stores valid relative redirect queries', async () => {
      const res = await app.fetch(
        new Request('http://localhost/auth/google?redirect=?foo=bar'),
        fakeEnv('test@example.com'),
      )
      expect(res.status).toBe(302)
      const cookies = res.headers.get('Set-Cookie') || ''
      expect(cookies).toContain(`oauth_redirect=${encodeURIComponent('/?foo=bar')};`)
    })

    it('stores valid path redirects', async () => {
      const res = await app.fetch(
        new Request('http://localhost/auth/google?redirect=/group/123'),
        fakeEnv('test@example.com'),
      )
      expect(res.status).toBe(302)
      const cookies = res.headers.get('Set-Cookie') || ''
      expect(cookies).toContain(`oauth_redirect=${encodeURIComponent('/group/123')};`)
    })

    it('blocks absolute URL redirects', async () => {
      const res = await app.fetch(
        new Request('http://localhost/auth/google?redirect=https://evil.com'),
        fakeEnv('test@example.com'),
      )
      expect(res.status).toBe(302)
      const cookies = res.headers.get('Set-Cookie') || ''
      expect(cookies).not.toContain('oauth_redirect=')
    })

    it('blocks protocol-relative URL redirects', async () => {
      const res = await app.fetch(
        new Request('http://localhost/auth/google?redirect=//evil.com'),
        fakeEnv('test@example.com'),
      )
      expect(res.status).toBe(302)
      const cookies = res.headers.get('Set-Cookie') || ''
      expect(cookies).not.toContain('oauth_redirect=')
    })

    it('blocks backslash absolute redirects', async () => {
      const res = await app.fetch(
        new Request('http://localhost/auth/google?redirect=\\\\evil.com'),
        fakeEnv('test@example.com'),
      )
      expect(res.status).toBe(302)
      const cookies = res.headers.get('Set-Cookie') || ''
      expect(cookies).not.toContain('oauth_redirect=')
    })
  })

  it('returns create_group true for any authenticated user', async () => {
    const res = await requestWithCookie('user@example.com')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      user: { email: string; feature_flags: { create_group: boolean } }
    }
    expect(body.user.email).toBe('user@example.com')
    expect(body.user.feature_flags.create_group).toBe(true)
  })

  it('handles logout by clearing the session cookie', async () => {
    const res = await app.fetch(new Request('http://localhost/auth/logout', { method: 'POST' }), fakeEnv('user@example.com'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    const setCookie = res.headers.get('Set-Cookie')
    expect(setCookie).toContain('session=')
    expect(setCookie).toContain('Max-Age=0')
  })

  it('initiates google oauth flow and redirects', async () => {
    const res = await app.fetch(new Request('http://localhost/auth/google'), fakeEnv('user@example.com'))
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(location).toContain('client_id=cid')

    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some(c => c.startsWith('oauth_state='))).toBe(true)
    expect(setCookies.some(c => c.startsWith('oauth_nonce='))).toBe(true)
    expect(setCookies.some(c => c.startsWith('oauth_verifier='))).toBe(true)
  })

  it('initiates google oauth flow with redirect cookie if provided', async () => {
    const res = await app.fetch(new Request('http://localhost/auth/google?redirect=?group=123'), fakeEnv('user@example.com'))
    expect(res.status).toBe(302)
    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some(c => c.startsWith('oauth_redirect='))).toBe(true)
  })

  it('callback redirects with error if error query param is present', async () => {
    const res = await app.fetch(new Request('http://localhost/auth/callback?error=access_denied'), fakeEnv('user@example.com'))
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('http://localhost:5173?auth_error=access_denied')
  })

  it('callback redirects with other error if unknown error query param is present', async () => {
    const res = await app.fetch(new Request('http://localhost/auth/callback?error=unknown_error'), fakeEnv('user@example.com'))
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('http://localhost:5173?auth_error=unknown_error')
  })

  it('callback redirects with session_expired if cookies are missing', async () => {
    const res = await app.fetch(new Request('http://localhost/auth/callback?state=abc&code=123'), fakeEnv('user@example.com'))
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('http://localhost:5173?auth_error=session_expired')
  })

  it('callback redirects with state_mismatch if state does not match cookie', async () => {
    const headers = new Headers({
      Cookie: 'oauth_state=def; oauth_nonce=nonce; oauth_verifier=verifier'
    })
    const res = await app.fetch(new Request('http://localhost/auth/callback?state=abc&code=123', { headers }), fakeEnv('user@example.com'))
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('http://localhost:5173?auth_error=state_mismatch')
  })

  it('callback works properly with valid parameters', async () => {
    vi.mocked(googleAuth.exchangeCode).mockResolvedValue({ id_token: 'id_token_123', access_token: 'access_token_123' })
    vi.mocked(googleAuth.verifyGoogleIdToken).mockResolvedValue({
      sub: 'google_id',
      email: 'user@example.com',
      email_verified: true,
      name: 'User',
      picture: 'pic.jpg'
    })
    vi.mocked(googleAuth.upsertUser).mockResolvedValue({ id: 'user-1', email: 'user@example.com' })

    const headers = new Headers({
      Cookie: 'oauth_state=abc; oauth_nonce=nonce; oauth_verifier=verifier; oauth_redirect=?group=123'
    })
    const res = await app.fetch(new Request('http://localhost/auth/callback?state=abc&code=123', { headers }), fakeEnv('user@example.com'))
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('http://localhost:5173/?group=123')

    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some(c => c.startsWith('session='))).toBe(true)

    expect(googleAuth.exchangeCode).toHaveBeenCalledWith({
      code: '123',
      codeVerifier: 'verifier',
      clientId: 'cid',
      clientSecret: 'csec',
      redirectUri: 'http://localhost:8787/auth/callback',
    })
    expect(googleAuth.verifyGoogleIdToken).toHaveBeenCalledWith('id_token_123', 'cid', 'nonce')
    expect(googleAuth.upsertUser).toHaveBeenCalled()
  })

  it('callback redirects with error if exchangeCode throws', async () => {
    vi.mocked(googleAuth.exchangeCode).mockRejectedValue(new Error('Auth error'))

    const headers = new Headers({
      Cookie: 'oauth_state=abc; oauth_nonce=nonce; oauth_verifier=verifier'
    })
    const res = await app.fetch(new Request('http://localhost/auth/callback?state=abc&code=123', { headers }), fakeEnv('user@example.com'))
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('http://localhost:5173?auth_error=Auth%20error')
  })

  it('callback unhandled error is caught', async () => {
    vi.mocked(googleAuth.exchangeCode).mockRejectedValue('unhandled error')

    const headers = new Headers({
      Cookie: 'oauth_state=abc; oauth_nonce=nonce; oauth_verifier=verifier'
    })
    const res = await app.fetch(new Request('http://localhost/auth/callback?state=abc&code=123', { headers }), fakeEnv('user@example.com'))
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('http://localhost:5173?auth_error=auth_failed')
  })

  it('callback works properly with valid parameters and missing redirect cookie', async () => {
    vi.mocked(googleAuth.exchangeCode).mockResolvedValue({ id_token: 'id_token_123', access_token: 'access_token_123' })
    vi.mocked(googleAuth.verifyGoogleIdToken).mockResolvedValue({
      sub: 'google_id',
      email: 'user@example.com',
      email_verified: true,
      name: 'User',
      picture: 'pic.jpg'
    })
    vi.mocked(googleAuth.upsertUser).mockResolvedValue({ id: 'user-1', email: 'user@example.com' })

    const headers = new Headers({
      Cookie: 'oauth_state=abc; oauth_nonce=nonce; oauth_verifier=verifier'
    })
    const res = await app.fetch(new Request('http://localhost/auth/callback?state=abc&code=123', { headers }), fakeEnv('user@example.com'))
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('http://localhost:5173')
  })

  it('callback treats a bare storedRedirect value as a relative path', async () => {
    vi.mocked(googleAuth.exchangeCode).mockResolvedValue({ id_token: 'id_token_123', access_token: 'access_token_123' })
    vi.mocked(googleAuth.verifyGoogleIdToken).mockResolvedValue({
      sub: 'google_id',
      email: 'user@example.com',
      email_verified: true,
      name: 'User',
      picture: 'pic.jpg'
    })
    vi.mocked(googleAuth.upsertUser).mockResolvedValue({ id: 'user-1', email: 'user@example.com' })

    const headers = new Headers({
      Cookie: 'oauth_state=abc; oauth_nonce=nonce; oauth_verifier=verifier; oauth_redirect=invalid'
    })
    const res = await app.fetch(new Request('http://localhost/auth/callback?state=abc&code=123', { headers }), fakeEnv('user@example.com'))
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('http://localhost:5173/invalid')
  })

  it('returns 404 from me endpoint if user is not found', async () => {
    // Override fakeEnv specifically for this test
    function fakeEnvNotFound(): AppContext['Bindings'] {
      return {
        ...fakeEnv(''),
        DB: {
          prepare(_sql: string) {
            return {
              bind() {
                return {
                  async first() {
                    return null
                  },
                }
              },
            }
          },
        } as unknown as D1Database,
      }
    }

    const token = await signJwt({ sub: 'user-1', email: 'user@example.com' }, JWT_SECRET, 3600)
    const headers = new Headers({ Cookie: `session=${token}` })
    const res = await app.fetch(new Request('http://localhost/auth/me', { headers }), fakeEnvNotFound())
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'User not found' })
  })

  // Visita anônima é o caso comum (toda visita chama /auth/me). Responder 200
  // em vez de 401 evita que o navegador logue essa checagem de rotina como
  // erro no console (reprovava Best Practices no Lighthouse).
  it('returns 200 with authenticated: false from me endpoint when there is no session cookie', async () => {
    const res = await app.fetch(new Request('http://localhost/auth/me'), fakeEnv('user@example.com'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ authenticated: false })
  })

  it('returns 200 with authenticated: false from me endpoint for an invalid session token', async () => {
    const headers = new Headers({ Cookie: 'session=not-a-valid-jwt' })
    const res = await app.fetch(new Request('http://localhost/auth/me', { headers }), fakeEnv('user@example.com'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ authenticated: false })
  })

  it('cookieDomain function tests through cookieOptions', async () => {
    const res = await app.fetch(new Request('http://localhost/auth/google'), fakeEnv('user@example.com'))
    const setCookies = res.headers.getSetCookie()
    // By default the base url is http://localhost:8787 which does not start with https
    expect(setCookies.some(c => c.includes('Secure'))).toBe(false)
    expect(setCookies.some(c => c.includes('Domain='))).toBe(false)
  })

  it('cookieDomain function tests through cookieOptions with https', async () => {
    const httpsEnv = { ...fakeEnv('user@example.com'), BASE_URL: 'https://api.palpitae.com.br' }
    const res = await app.fetch(new Request('https://api.palpitae.com.br/auth/google'), httpsEnv)
    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some(c => c.includes('Secure'))).toBe(true)
    expect(setCookies.some(c => c.includes('Domain=.palpitae.com.br'))).toBe(true)
  })

  it('cookieDomain function tests without dot in hostname', async () => {
    const localhostEnv = { ...fakeEnv('user@example.com'), BASE_URL: 'https://localhost:8787' }
    const res = await app.fetch(new Request('https://localhost:8787/auth/google'), localhostEnv)
    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some(c => c.includes('Secure'))).toBe(true)
    expect(setCookies.some(c => c.includes('Domain='))).toBe(false)
  })

  it('cookieDomain function tests with only two parts in hostname', async () => {
    const exampleEnv = { ...fakeEnv('user@example.com'), BASE_URL: 'https://example.com' }
    const res = await app.fetch(new Request('https://example.com/auth/google'), exampleEnv)
    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some(c => c.includes('Secure'))).toBe(true)
    expect(setCookies.some(c => c.includes('Domain='))).toBe(false)
  })
})
