import { describe, expect, it, vi } from 'vitest'
import { verifySession, SessionStorageError, sessionHash, revokeAllSessions, revokeSession } from './session'
import { signJwt } from './jwt'
import type { D1Database } from '@cloudflare/workers-types'

const SECRET = 'test-secret'

describe('sessionHash', () => {
  it('returns a stable SHA-256 hash in hex format', async () => {
    const hash1 = await sessionHash('token123')
    const hash2 = await sessionHash('token123')
    const hash3 = await sessionHash('different')

    expect(hash1).toBe(hash2)
    expect(hash1).not.toBe(hash3)
    expect(hash1).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('verifySession', () => {
  const createMockDb = (row: any) => ({
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(row)
  } as unknown as D1Database)

  it('returns payload for a valid session', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'test@example.com' }, SECRET, 3600)
    const db = createMockDb({ revoked: 0, valid_after: null })

    const payload = await verifySession(token, SECRET, db)

    expect(payload.sub).toBe('user-1')
    expect(payload.email).toBe('test@example.com')
  })

  it('throws SessionStorageError if DB query fails', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'test@example.com' }, SECRET, 3600)
    const db = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockRejectedValue(new Error('DB Error'))
    } as unknown as D1Database

    await expect(verifySession(token, SECRET, db)).rejects.toThrow(SessionStorageError)
  })

  it('throws if session is explicitly revoked in DB', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'test@example.com' }, SECRET, 3600)
    const db = createMockDb({ revoked: 1, valid_after: null })

    await expect(verifySession(token, SECRET, db)).rejects.toThrow('Session revoked')
  })

  it('throws if token issued before cutoff (valid_after)', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'test@example.com' }, SECRET, 3600)
    const db = createMockDb({ revoked: 0, valid_after: Math.floor(Date.now() / 1000) + 100 })

    await expect(verifySession(token, SECRET, db)).rejects.toThrow('Session revoked')
  })

  it('throws if token issued exactly at cutoff (valid_after)', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'test@example.com' }, SECRET, 3600)
    // We decode token to get exact iat
    const [, body] = token.split('.')
    const payload = JSON.parse(atob(body!.replace(/-/g, '+').replace(/_/g, '/')))
    const iat = payload.iat

    const db = createMockDb({ revoked: 0, valid_after: iat })

    await expect(verifySession(token, SECRET, db)).rejects.toThrow('Session revoked')
  })

  it('accepts if token issued after cutoff (valid_after)', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'test@example.com' }, SECRET, 3600)
    const [, body] = token.split('.')
    const payload = JSON.parse(atob(body!.replace(/-/g, '+').replace(/_/g, '/')))
    const iat = payload.iat

    const db = createMockDb({ revoked: 0, valid_after: iat - 100 })

    const result = await verifySession(token, SECRET, db)
    expect(result.sub).toBe('user-1')
  })

  it('throws for invalid JWT format/signature before checking DB', async () => {
    const db = createMockDb({ revoked: 0, valid_after: null })
    await expect(verifySession('invalid-token', SECRET, db)).rejects.toThrow('Invalid JWT format')
    expect(db.prepare).not.toHaveBeenCalled()
  })
})

describe('revokeAllSessions', () => {
  it('updates users table with current timestamp', async () => {
    const mockRun = vi.fn().mockResolvedValue({ success: true })
    const mockBind = vi.fn().mockReturnValue({ run: mockRun })
    const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind })

    const db = { prepare: mockPrepare } as unknown as D1Database

    await revokeAllSessions('user-1', db)

    expect(mockPrepare).toHaveBeenCalledWith(
      'UPDATE users SET sessions_valid_after = MAX(COALESCE(sessions_valid_after, 0), ?) WHERE id = ?'
    )

    // Bind args: timestamp, userId
    const bindArgs = mockBind.mock.calls[0]
    expect(bindArgs[0]).toBeTypeOf('number')
    expect(bindArgs[0]).toBeCloseTo(Math.floor(Date.now() / 1000), -1)
    expect(bindArgs[1]).toBe('user-1')

    expect(mockRun).toHaveBeenCalled()
  })
})

describe('revokeSession', () => {
  it('inserts token hash into revoked_sessions', async () => {
    const mockRun = vi.fn().mockResolvedValue({ success: true })
    const mockBind = vi.fn().mockReturnValue({ run: mockRun })
    const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind })

    const db = { prepare: mockPrepare } as unknown as D1Database

    const token = await signJwt({ sub: 'user-1', email: 'test@example.com' }, SECRET, 3600)
    await revokeSession(token, SECRET, db)

    expect(mockPrepare).toHaveBeenCalledWith(
      'INSERT OR IGNORE INTO revoked_sessions (token_hash, expires_at) VALUES (?, ?)'
    )

    const hash = await sessionHash(token)
    const [, body] = token.split('.')
    const payload = JSON.parse(atob(body!.replace(/-/g, '+').replace(/_/g, '/')))

    expect(mockBind).toHaveBeenCalledWith(hash, payload.exp)
    expect(mockRun).toHaveBeenCalled()
  })

  it('silently returns if token is invalid', async () => {
    const mockPrepare = vi.fn()
    const db = { prepare: mockPrepare } as unknown as D1Database

    await revokeSession('invalid-token', SECRET, db)

    expect(mockPrepare).not.toHaveBeenCalled()
  })
})
