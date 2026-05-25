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

function createGroupsListDbMock() {
  const db = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async all() {
              if (sql.includes('FROM groups g')) {
                return {
                  results: [
                    {
                      id: 'group-1',
                      name: 'Meu Grupo',
                      competition_id: 'comp-1',
                      admin_id: 'user-9',
                      created_at: '2026-01-01T00:00:00Z',
                      member_count: 3,
                      user_points: 12,
                    },
                  ],
                }
              }

              return { results: [] }
            },
            async first() {
              if (sql.includes('FROM leaderboard') && sql.includes('total_points >')) {
                return { position: 0 }
              }

              if (sql.includes('FROM users WHERE id = ?')) {
                return { email: 'user@example.com' }
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

async function requestGroupsList(email: string) {
  const token = await signJwt({ sub: 'user-1', email }, JWT_SECRET, 3600)
  const headers = new Headers({
    Cookie: `session=${token}`,
  })

  const app = new Hono<AppContext>()
  app.route('/groups', groupsRouter)

  return app.fetch(
    new Request('http://localhost/groups', {
      method: 'GET',
      headers,
    }),
    {
      ...fakeEnv(email),
      DB: createGroupsListDbMock(),
    },
  )
}

describe('groups router', () => {
  it('returns the total member count for the groups list', async () => {
    const res = await requestGroupsList('user@example.com')

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      groups: Array<{ id: string; member_count: number }>
    }

    expect(body.groups).toHaveLength(1)
    expect(body.groups[0]?.member_count).toBe(3)
  })

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