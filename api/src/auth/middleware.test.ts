import type { Context } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../types'
import { signJwt } from './jwt'
import { requireAuth } from './middleware'

const JWT_SECRET = 'test-secret-middleware'

function buildMockContext(cookieHeader: string | null, dbMock?: any): Context<AppContext> {
  return {
    req: {
      header: (name: string) => (name.toLowerCase() === 'cookie' ? cookieHeader : null),
      raw: new Request('http://localhost', {
        headers: cookieHeader ? { Cookie: cookieHeader } : {},
      }),
    },
    env: { JWT_SECRET, DB: dbMock || { prepare: () => ({ bind: () => ({ first: async () => null }) }) } },
    get: vi.fn(),
    set: vi.fn(),
    json: vi
      .fn()
      .mockImplementation((data, status) => new Response(JSON.stringify(data), { status })),
  } as unknown as Context<AppContext>
}

describe('requireAuth middleware', () => {
  it('returns 401 when session resolution fails with unknown error', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, JWT_SECRET, 3600)
    // Simulate verifySession throwing something other than SessionStorageError.
    // SessionStorageError is explicitly matched in requireAuth.
    // The easiest way is to let verifySession throw a generic error, which it does if row?.revoked is true
    // However, we just return a mocked DB that causes row?.revoked to be true.
    const mockDb = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ revoked: 1, valid_after: null })
        })
      })
    }
    const c = buildMockContext(`session=${token}`, mockDb)
    const next = vi.fn()

    await requireAuth(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(c.json).toHaveBeenCalledWith({ error: 'Unauthorized' }, 401)
  })

  it('returns 503 when session storage is unavailable', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, JWT_SECRET, 3600)
    const mockDb = {
      prepare: () => ({
        bind: () => ({
          first: async () => { throw new Error('DB failure') }
        })
      })
    }
    const c = buildMockContext(`session=${token}`, mockDb)
    const next = vi.fn()

    await requireAuth(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(c.json).toHaveBeenCalledWith({ error: 'Sessão indisponível' }, 503)
  })

  it('returns 401 when no session cookie is present', async () => {
    const c = buildMockContext(null)
    const next = vi.fn()

    await requireAuth(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(c.json).toHaveBeenCalledWith({ error: 'Unauthorized' }, 401)
  })

  it('returns 401 for a malformed token', async () => {
    const c = buildMockContext('session=not.a.valid.token')
    const next = vi.fn()

    await requireAuth(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(c.json).toHaveBeenCalledWith({ error: 'Unauthorized' }, 401)
  })

  it('returns 401 for a token signed with the wrong secret', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, 'wrong-secret', 3600)
    const c = buildMockContext(`session=${token}`)
    const next = vi.fn()

    await requireAuth(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(c.json).toHaveBeenCalledWith({ error: 'Unauthorized' }, 401)
  })

  it('returns 401 for an expired token', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, JWT_SECRET, -1)
    const c = buildMockContext(`session=${token}`)
    const next = vi.fn()

    await requireAuth(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(c.json).toHaveBeenCalledWith({ error: 'Unauthorized' }, 401)
  })

  it('calls next and sets userId and userEmail for a valid token', async () => {
    const token = await signJwt({ sub: 'user-42', email: 'user@example.com' }, JWT_SECRET, 3600)
    const c = buildMockContext(`session=${token}`)
    const next = vi.fn()

    await requireAuth(c, next)

    expect(c.set).toHaveBeenCalledWith('userId', 'user-42')
    expect(c.set).toHaveBeenCalledWith('userEmail', 'user@example.com')
    expect(next).toHaveBeenCalled()
    expect(c.json).not.toHaveBeenCalled()
  })
})
