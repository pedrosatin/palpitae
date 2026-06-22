import { describe, expect, it } from 'vitest'
import { base64UrlEncode } from '../auth/encoding'
import { signJwt } from '../auth/jwt'
import { signUnsubToken, verifyUnsubToken } from './unsubscribeToken'

const SECRET = 'test-unsub-secret'

describe('unsubscribe token', () => {
  it('round-trips a user id', async () => {
    const token = await signUnsubToken('user-123', SECRET)
    await expect(verifyUnsubToken(token, SECRET)).resolves.toBe('user-123')
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signUnsubToken('user-123', SECRET)
    await expect(verifyUnsubToken(token, 'other-secret')).rejects.toThrow()
  })

  it('rejects a tampered user id', async () => {
    const token = await signUnsubToken('user-123', SECRET)
    const [, sig] = token.split('.')
    const forgedId = base64UrlEncode(new TextEncoder().encode('user-999').buffer as ArrayBuffer)
    const forged = `${forgedId}.${sig}`
    await expect(verifyUnsubToken(forged, SECRET)).rejects.toThrow()
  })

  it('rejects a malformed token', async () => {
    await expect(verifyUnsubToken('not-a-token', SECRET)).rejects.toThrow()
  })

  it('is not accepted as an auth JWT and vice-versa', async () => {
    // An auth JWT must not verify as an unsubscribe token (different format/scope).
    const jwt = await signJwt({ sub: 'user-123', email: 'a@x.com' }, SECRET, 3600)
    await expect(verifyUnsubToken(jwt, SECRET)).rejects.toThrow()
  })
})
