import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { signJwt } from '../auth/jwt'
import type { AppContext } from '../types'
import { notificationsRouter } from './router'
import { signUnsubToken } from './unsubscribeToken'

const JWT_SECRET = 'test-secret-notifications'

type Captured = { sqls: string[]; binds: unknown[][]; row?: { email_unsubscribed_at: string | null } }

function fakeDb(captured: Captured) {
  return {
    prepare(sql: string) {
      captured.sqls.push(sql)
      const stmt = {
        bind(...args: unknown[]) {
          captured.binds.push(args)
          return stmt
        },
        async run() {
          return { success: true }
        },
        async first<T>() {
          return (captured.row ?? null) as T | null
        },
      }
      return stmt
    },
  } as unknown as D1Database
}

function fakeEnv(db: D1Database): AppContext['Bindings'] {
  return {
    JWT_SECRET,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'http://localhost:8787',
    FRONTEND_URL: 'http://localhost:5173',
    FOOTBALL_API_KEY: 'fk',
    RESEND_API_KEY: 'rk',
    DB: db,
  }
}

function app() {
  const a = new Hono<AppContext>()
  a.route('/notifications', notificationsRouter)
  return a
}

async function authHeaders() {
  const token = await signJwt({ sub: 'user-1', email: 'u@x.com' }, JWT_SECRET, 3600)
  return new Headers({ Cookie: `session=${token}` })
}

describe('notifications router — unsubscribe', () => {
  it('GET /unsubscribe with a valid token marks the user unsubscribed', async () => {
    const captured: Captured = { sqls: [], binds: [] }
    const token = await signUnsubToken('user-42', JWT_SECRET)

    const res = await app().fetch(
      new Request(`http://localhost/notifications/unsubscribe?token=${token}`),
      fakeEnv(fakeDb(captured)),
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('não receberá')
    expect(captured.sqls.some((s) => s.includes('email_unsubscribed_at = datetime'))).toBe(true)
    expect(captured.binds[0]).toEqual(['user-42'])
  })

  it('GET /unsubscribe without a token returns 400', async () => {
    const res = await app().fetch(
      new Request('http://localhost/notifications/unsubscribe'),
      fakeEnv(fakeDb({ sqls: [], binds: [] })),
    )
    expect(res.status).toBe(400)
  })

  it('GET /unsubscribe with a tampered token returns 400 and writes nothing', async () => {
    const captured: Captured = { sqls: [], binds: [] }
    const res = await app().fetch(
      new Request('http://localhost/notifications/unsubscribe?token=abc.def'),
      fakeEnv(fakeDb(captured)),
    )
    expect(res.status).toBe(400)
    expect(captured.sqls).toHaveLength(0)
  })

  it('POST /unsubscribe (one-click) with a valid token returns 200', async () => {
    const captured: Captured = { sqls: [], binds: [] }
    const token = await signUnsubToken('user-7', JWT_SECRET)

    const res = await app().fetch(
      new Request(`http://localhost/notifications/unsubscribe?token=${token}`, { method: 'POST' }),
      fakeEnv(fakeDb(captured)),
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('unsubscribed')
    expect(captured.binds[0]).toEqual(['user-7'])
  })
})

describe('notifications router — preferences', () => {
  it('GET /preferences requires auth', async () => {
    const res = await app().fetch(
      new Request('http://localhost/notifications/preferences'),
      fakeEnv(fakeDb({ sqls: [], binds: [] })),
    )
    expect(res.status).toBe(401)
  })

  it('GET /preferences returns round_reminders=true when not unsubscribed', async () => {
    const res = await app().fetch(
      new Request('http://localhost/notifications/preferences', { headers: await authHeaders() }),
      fakeEnv(fakeDb({ sqls: [], binds: [], row: { email_unsubscribed_at: null } })),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ round_reminders: true })
  })

  it('GET /preferences returns round_reminders=false when unsubscribed', async () => {
    const res = await app().fetch(
      new Request('http://localhost/notifications/preferences', { headers: await authHeaders() }),
      fakeEnv(fakeDb({ sqls: [], binds: [], row: { email_unsubscribed_at: '2026-06-21T10:00:00Z' } })),
    )
    await expect(res.json()).resolves.toEqual({ round_reminders: false })
  })

  it('PATCH /preferences {round_reminders:true} re-subscribes (sets NULL)', async () => {
    const captured: Captured = { sqls: [], binds: [] }
    const res = await app().fetch(
      new Request('http://localhost/notifications/preferences', {
        method: 'PATCH',
        headers: new Headers([...(await authHeaders()), ['Content-Type', 'application/json']]),
        body: JSON.stringify({ round_reminders: true }),
      }),
      fakeEnv(fakeDb(captured)),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ round_reminders: true })
    expect(captured.sqls.some((s) => s.includes('email_unsubscribed_at = NULL'))).toBe(true)
  })

  it('PATCH /preferences {round_reminders:false} opts out', async () => {
    const captured: Captured = { sqls: [], binds: [] }
    const res = await app().fetch(
      new Request('http://localhost/notifications/preferences', {
        method: 'PATCH',
        headers: new Headers([...(await authHeaders()), ['Content-Type', 'application/json']]),
        body: JSON.stringify({ round_reminders: false }),
      }),
      fakeEnv(fakeDb(captured)),
    )
    await expect(res.json()).resolves.toEqual({ round_reminders: false })
    expect(captured.sqls.some((s) => s.includes("email_unsubscribed_at = datetime('now')"))).toBe(true)
  })

  it('PATCH /preferences rejects a non-boolean body', async () => {
    const res = await app().fetch(
      new Request('http://localhost/notifications/preferences', {
        method: 'PATCH',
        headers: new Headers([...(await authHeaders()), ['Content-Type', 'application/json']]),
        body: JSON.stringify({ round_reminders: 'yes' }),
      }),
      fakeEnv(fakeDb({ sqls: [], binds: [] })),
    )
    expect(res.status).toBe(400)
  })
})
