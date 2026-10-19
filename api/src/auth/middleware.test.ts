import type { Context } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../types'
import { signJwt } from './jwt'
import { requireAuth, resolveSession } from './middleware'

const JWT_SECRET = 'test-secret-middleware'

function buildMockContext(cookieHeader: string | null): Context<AppContext> {
  return {
    req: {
      header: (name: string) => (name.toLowerCase() === 'cookie' ? cookieHeader : null),
      raw: new Request('http://localhost', {
        headers: cookieHeader ? { Cookie: cookieHeader } : {},
      }),
    },
    env: { JWT_SECRET, DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } },
    get: vi.fn(),
    set: vi.fn(),
    json: vi
      .fn()
      .mockImplementation((data, status) => new Response(JSON.stringify(data), { status })),
  } as unknown as Context<AppContext>
}

describe('requireAuth middleware', () => {
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

describe('resolveSession', () => {
  it('returns cached session if it exists in context', async () => {
    const c = buildMockContext(null)
    const cachedState = { payload: { sub: 'user-1', email: 'test@example.com' } }
    vi.mocked(c.get).mockReturnValue(cachedState)

    const result = await resolveSession(c)

    expect(result).toBe(cachedState)
    expect(c.set).not.toHaveBeenCalled()
  })

  it('returns undefined if no session cookie is present', async () => {
    const c = buildMockContext(null)
    vi.mocked(c.get).mockReturnValue(undefined)

    const result = await resolveSession(c)

    expect(result).toBeUndefined()
    expect(c.set).not.toHaveBeenCalled()
  })

  it('returns state with payload for a valid session token', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'test@example.com' }, JWT_SECRET, 3600)
    const c = buildMockContext(`session=${token}`)
    vi.mocked(c.get).mockReturnValue(undefined)

    const result = await resolveSession(c)

    expect(result).toEqual({
      payload: expect.objectContaining({ sub: 'user-1', email: 'test@example.com' }),
    })
    expect(c.set).toHaveBeenCalledWith('session', result)
  })

  it('returns state with error if session verification fails', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'test@example.com' }, 'wrong-secret', 3600)
    const c = buildMockContext(`session=${token}`)
    vi.mocked(c.get).mockReturnValue(undefined)

    const result = await resolveSession(c)

    expect(result?.error).toBeInstanceOf(Error)
    expect(c.set).toHaveBeenCalledWith('session', result)
  })
})
