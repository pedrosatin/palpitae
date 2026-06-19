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
                      invite_code: 'INV123',
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

async function requestGroupsList(email: string, inviteCode?: string) {
  const token = await signJwt({ sub: 'user-1', email }, JWT_SECRET, 3600)
  const headers = new Headers({
    Cookie: `session=${token}`,
  })

  const app = new Hono<AppContext>()
  app.route('/groups', groupsRouter)

  const url = inviteCode
    ? `http://localhost/groups?invite_code=${encodeURIComponent(inviteCode)}`
    : 'http://localhost/groups'

  return app.fetch(
    new Request(url, {
      method: 'GET',
      headers,
    }),
    {
      ...fakeEnv(email),
      DB: createGroupsListDbMock(),
    },
  )
}

function createRemoveMemberDbMock({
  isAdmin,
  targetIsMember,
}: {
  isAdmin: boolean
  targetIsMember: boolean
}) {
  const deleteRun = vi.fn().mockResolvedValue({ success: true })

  const db = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM groups WHERE id = ?')) {
                return { owner_user_id: isAdmin ? 'user-1' : 'user-other' }
              }
              if (sql.includes('FROM group_members WHERE group_id = ? AND user_id = ?')) {
                return targetIsMember ? { id: 'member-id' } : null
              }
              if (sql.includes('FROM users WHERE id = ?')) {
                return { email: 'user@example.com' }
              }
              return null
            },
            run: deleteRun,
          }
        },
      }
    },
  }

  return { db: db as unknown as D1Database, deleteRun }
}

async function requestRemoveMember(
  callerId: string,
  callerEmail: string,
  groupId: string,
  targetUserId: string,
  db: D1Database,
) {
  const token = await signJwt({ sub: callerId, email: callerEmail }, JWT_SECRET, 3600)
  const headers = new Headers({ Cookie: `session=${token}` })

  const app = new Hono<AppContext>()
  app.route('/groups', groupsRouter)

  return app.fetch(
    new Request(`http://localhost/groups/${groupId}/members/${targetUserId}`, {
      method: 'DELETE',
      headers,
    }),
    {
      JWT_SECRET,
      GOOGLE_CLIENT_ID: 'cid',
      GOOGLE_CLIENT_SECRET: 'csec',
      BASE_URL: 'http://localhost:8787',
      FRONTEND_URL: 'http://localhost:5173',
      FOOTBALL_API_KEY: 'test-api-key',
      DB: db,
    },
  )
}

function createGroupByIdDbMock(ownerId: string | null) {
  const updateRun = vi.fn().mockResolvedValue({ success: true })

  const db = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM groups WHERE id = ? AND deleted_at IS NULL')) {
                return ownerId ? { owner_user_id: ownerId } : null
              }
              return null
            },
            run: updateRun,
          }
        },
      }
    },
  }

  return { db: db as unknown as D1Database, updateRun }
}

async function requestGroupMutation(
  method: 'PATCH' | 'DELETE',
  callerId: string,
  callerEmail: string,
  groupId: string,
  db: D1Database,
  body?: Record<string, unknown>,
) {
  const token = await signJwt({ sub: callerId, email: callerEmail }, JWT_SECRET, 3600)
  const headers = new Headers({
    Cookie: `session=${token}`,
    'Content-Type': 'application/json',
  })

  const app = new Hono<AppContext>()
  app.route('/groups', groupsRouter)

  return app.fetch(
    new Request(`http://localhost/groups/${groupId}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    { ...fakeEnv(callerEmail), DB: db },
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

  it('returns the matched group id for an invite code the user already belongs to', async () => {
    const res = await requestGroupsList('user@example.com', 'INV123')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { matched_invite_group_id: string | null }

    expect(body.matched_invite_group_id).toBe('group-1')
  })

  it('allows group creation for any authenticated user', async () => {
    const res = await request('user@example.com', {
      name: 'Os Craques',
      competition_id: 'comp-1',
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { group: { name: string; competition_id: string } }
    expect(body.group.name).toBe('Os Craques')
    expect(body.group.competition_id).toBe('comp-1')
  })

  describe('DELETE /groups/:id/members/:memberId', () => {
    it('removes a member when called by the group admin', async () => {
      const { db, deleteRun } = createRemoveMemberDbMock({ isAdmin: true, targetIsMember: true })
      const res = await requestRemoveMember('user-1', 'admin@example.com', 'group-1', 'user-2', db)

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
      expect(deleteRun).toHaveBeenCalled()
    })

    it('returns 403 when caller is not the group admin', async () => {
      const { db } = createRemoveMemberDbMock({ isAdmin: false, targetIsMember: true })
      const res = await requestRemoveMember('user-1', 'user@example.com', 'group-1', 'user-2', db)

      expect(res.status).toBe(403)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Apenas o administrador pode remover membros')
    })

    it('allows a non-admin member to leave the group themselves', async () => {
      const { db, deleteRun } = createRemoveMemberDbMock({ isAdmin: false, targetIsMember: true })
      const res = await requestRemoveMember('user-2', 'user@example.com', 'group-1', 'user-2', db)

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
      expect(deleteRun).toHaveBeenCalled()
    })

    it('returns 400 when admin tries to remove themselves', async () => {
      const { db } = createRemoveMemberDbMock({ isAdmin: true, targetIsMember: true })
      const res = await requestRemoveMember('user-1', 'admin@example.com', 'group-1', 'user-1', db)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Você não pode remover a si mesmo do grupo')
    })

    it('returns 404 when target is not a member of the group', async () => {
      const { db } = createRemoveMemberDbMock({ isAdmin: true, targetIsMember: false })
      const res = await requestRemoveMember('user-1', 'admin@example.com', 'group-1', 'user-99', db)

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Membro não encontrado no grupo')
    })
  })

  describe('PATCH /groups/:id', () => {
    it('renames the group when called by the owner', async () => {
      const { db, updateRun } = createGroupByIdDbMock('user-1')
      const res = await requestGroupMutation('PATCH', 'user-1', 'admin@example.com', 'group-1', db, {
        name: 'Novo Nome',
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { group: { id: string; name: string } }
      expect(body.group.name).toBe('Novo Nome')
      expect(updateRun).toHaveBeenCalled()
    })

    it('returns 403 when caller is not the owner', async () => {
      const { db, updateRun } = createGroupByIdDbMock('user-other')
      const res = await requestGroupMutation('PATCH', 'user-1', 'user@example.com', 'group-1', db, {
        name: 'Novo Nome',
      })

      expect(res.status).toBe(403)
      expect(updateRun).not.toHaveBeenCalled()
    })

    it('returns 400 for an invalid name length', async () => {
      const { db, updateRun } = createGroupByIdDbMock('user-1')
      const res = await requestGroupMutation('PATCH', 'user-1', 'admin@example.com', 'group-1', db, {
        name: 'x',
      })

      expect(res.status).toBe(400)
      expect(updateRun).not.toHaveBeenCalled()
    })

    it('returns 404 when the group does not exist or is already deleted', async () => {
      const { db } = createGroupByIdDbMock(null)
      const res = await requestGroupMutation('PATCH', 'user-1', 'admin@example.com', 'group-1', db, {
        name: 'Novo Nome',
      })

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /groups/:id', () => {
    it('soft-deletes the group when called by the owner', async () => {
      const { db, updateRun } = createGroupByIdDbMock('user-1')
      const res = await requestGroupMutation('DELETE', 'user-1', 'admin@example.com', 'group-1', db)

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
      expect(updateRun).toHaveBeenCalled()
    })

    it('returns 403 when caller is not the owner', async () => {
      const { db, updateRun } = createGroupByIdDbMock('user-other')
      const res = await requestGroupMutation('DELETE', 'user-1', 'user@example.com', 'group-1', db)

      expect(res.status).toBe(403)
      expect(updateRun).not.toHaveBeenCalled()
    })

    it('returns 404 when the group does not exist or is already deleted', async () => {
      const { db } = createGroupByIdDbMock(null)
      const res = await requestGroupMutation('DELETE', 'user-1', 'admin@example.com', 'group-1', db)

      expect(res.status).toBe(404)
    })
  })
})