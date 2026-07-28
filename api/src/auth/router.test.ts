import { describe, expect, it, vi, afterEach } from 'vitest'
import app from '../index'
import type { AppContext } from '../types'
import { signJwt } from './jwt'
import * as google from './google'

const JWT_SECRET = 'test-secret-auth-router'

function fakeEnv(email: string): AppContext['Bindings'] {
  return {
    JWT_SECRET,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'http://localhost:8787',
    FRONTEND_URL: 'http://localhost:5173',
    FOOTBALL_API_KEY: 'test-api-key',
    RESEND_API_KEY: 'test-resend-key',
    AE: { writeDataPoint() {} } as unknown as AnalyticsEngineDataset,
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
  }
}

async function requestWithCookie(email: string) {
  const token = await signJwt({ sub: 'user-1', email }, JWT_SECRET, 3600)
  const headers = new Headers({ Cookie: `session=${token}` })
  return app.fetch(new Request('http://localhost/auth/me', { headers }), fakeEnv(email))
}

describe('auth router', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('redirects to frontend with error message when code exchange fails', async () => {
    vi.spyOn(google, 'exchangeCode').mockRejectedValue(new Error('Network Error'))

    const req = new Request('http://localhost/auth/callback?code=123&state=abc')
    // Set necessary cookies to pass early validation
    req.headers.set('Cookie', 'oauth_state=abc; oauth_nonce=def; oauth_verifier=ghi')

    const res = await app.fetch(req, fakeEnv('test@example.com'))

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('http://localhost:5173?auth_error=Network%20Error')
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
})
