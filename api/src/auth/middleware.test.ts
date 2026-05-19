import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { describe, expect, it } from 'vitest'
import type { AppContext } from '../types'
import { signJwt } from './jwt'
import { requireAuth } from './middleware'

const JWT_SECRET = 'test-secret-middleware'

function buildApp() {
  const app = new Hono<AppContext>()
  app.use('/protected', requireAuth)
  app.get('/protected', (c) => c.json({ userId: c.get('userId') }))
  return app
}

function fakeEnv(): AppContext['Bindings'] {
  return {
    JWT_SECRET,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'http://localhost:8787',
    FRONTEND_URL: 'http://localhost:5173',
    FOOTBALL_API_KEY: 'test-api-key',
    DB: {} as D1Database,
  }
}

async function requestWithCookie(app: Hono<AppContext>, cookie?: string) {
  const headers = new Headers()
  if (cookie) headers.set('Cookie', cookie)
  return app.fetch(new Request('http://localhost/protected', { headers }), fakeEnv())
}

describe('requireAuth middleware', () => {
  it('returns 401 when no session cookie is present', async () => {
    const app = buildApp()
    const res = await requestWithCookie(app)
    expect(res.status).toBe(401)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 for a malformed token', async () => {
    const app = buildApp()
    const res = await requestWithCookie(app, 'session=not.a.valid.token')
    expect(res.status).toBe(401)
  })

  it('returns 401 for a token signed with the wrong secret', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, 'wrong-secret', 3600)
    const app = buildApp()
    const res = await requestWithCookie(app, `session=${token}`)
    expect(res.status).toBe(401)
  })

  it('returns 401 for an expired token', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, JWT_SECRET, -1)
    const app = buildApp()
    const res = await requestWithCookie(app, `session=${token}`)
    expect(res.status).toBe(401)
  })

  it('calls next and sets userId for a valid token', async () => {
    const token = await signJwt({ sub: 'user-42', email: 'user@example.com' }, JWT_SECRET, 3600)
    const app = buildApp()
    const res = await requestWithCookie(app, `session=${token}`)
    expect(res.status).toBe(200)
    const body = await res.json() as { userId: string }
    expect(body.userId).toBe('user-42')
  })
})
