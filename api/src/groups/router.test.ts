import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import { groupsRouter } from './router'
import type { AppContext } from '../types'

const JWT_SECRET = 'test-secret-groups-router'

function createDbMock(email: string) {
  const batch = vi.fn().mockResolvedValue(undefined)

  const db = {
    batch,
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM competitions WHERE id = ?')) {
                return { id: 'comp-1' }
              }

              if (sql.includes('FROM groups WHERE invite_code = ?')) {
                return null
              }

              if (sql.includes('FROM users WHERE id = ?')) {
                return { email }
              }

              return null
            },
            async run() {
              return { success: true }
            },
          }
        },
      }
    },
  }

  return db as unknown as D1Database
}

function fakeEnv(email: string): AppContext['Bindings'] {
  return {
    JWT_SECRET,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'http://localhost:8787',
    FRONTEND_URL: 'http://localhost:5173',
    FOOTBALL_API_KEY: 'test-api-key',
    DB: createDbMock(email),
  }
}

async function request(email: string, body: Record<string, unknown>) {
  const token = await signJwt({ sub: 'user-1', email }, JWT_SECRET, 3600)
  const headers = new Headers({
    Cookie: `session=${token}`,
    'Content-Type': 'application/json',
  })

  const app = new Hono<AppContext>()
  app.route('/groups', groupsRouter)

  return app.fetch(
    new Request('http://localhost/groups', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    fakeEnv(email),
  )
}

describe('groups router', () => {
  it('blocks group creation for users outside the allowlist', async () => {
    const res = await request('user@example.com', {
      name: 'Os Craques',
      competition_id: 'comp-1',
    })

    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Você não tem permissão para criar grupos')
  })

  it('allows group creation for the allowlisted email', async () => {
    const res = await request('pedro5satin@gmail.com', {
      name: 'Os Craques',
      competition_id: 'comp-1',
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { group: { name: string; competition_id: string } }
    expect(body.group.name).toBe('Os Craques')
    expect(body.group.competition_id).toBe('comp-1')
  })
})