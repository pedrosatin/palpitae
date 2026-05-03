import { describe, expect, it } from 'vitest'
import { signJwt, verifyJwt } from './jwt'

const SECRET = 'test-secret-for-unit-tests-only'

describe('signJwt', () => {
  it('produces a 3-part dot-separated JWT', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, SECRET, 3600)
    expect(token.split('.')).toHaveLength(3)
  })

  it('encodes sub and email in the payload', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, SECRET, 3600)
    const [, body] = token.split('.')
    const payload = JSON.parse(atob(body!.replace(/-/g, '+').replace(/_/g, '/')))
    expect(payload.sub).toBe('user-1')
    expect(payload.email).toBe('a@b.com')
  })
})

describe('verifyJwt', () => {
  it('returns the payload for a valid token', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, SECRET, 3600)
    const payload = await verifyJwt(token, SECRET)
    expect(payload.sub).toBe('user-1')
    expect(payload.email).toBe('a@b.com')
  })

  it('throws for a token signed with a different secret', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, SECRET, 3600)
    await expect(verifyJwt(token, 'wrong-secret')).rejects.toThrow('Invalid JWT signature')
  })

  it('throws for a tampered payload', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, SECRET, 3600)
    const [h, , s] = token.split('.')
    const tamperedBody = btoa(JSON.stringify({ sub: 'attacker', email: 'evil@x.com', iat: 0, exp: 9999999999 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    await expect(verifyJwt(`${h}.${tamperedBody}.${s}`, SECRET)).rejects.toThrow()
  })

  it('throws for an expired token', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, SECRET, -1)
    await expect(verifyJwt(token, SECRET)).rejects.toThrow('JWT expired')
  })

  it('throws for a malformed token', async () => {
    await expect(verifyJwt('not.a.valid.jwt', SECRET)).rejects.toThrow('Invalid JWT format')
  })
})
