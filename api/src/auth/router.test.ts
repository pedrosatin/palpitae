import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import app from '../index'
import type { AppContext } from '../types'
import { signJwt } from './jwt'

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
  it('returns create_group true for any authenticated user', async () => {
    const res = await requestWithCookie('user@example.com')
    expect(res.status).toBe(200)
    const body = await res.json() as {
      user: { email: string; feature_flags: { create_group: boolean } }
    }
    expect(body.user.email).toBe('user@example.com')
    expect(body.user.feature_flags.create_group).toBe(true)
  })
})