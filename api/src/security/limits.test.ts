import { describe, it, expect } from 'vitest'
import { bucketKey } from './limits'
import crypto from 'node:crypto'

describe('bucketKey', () => {
  it('generates a stable HMAC-SHA256 hex string', async () => {
    const secret = 'my-super-secret'
    const identity = 'user-123'
    const result = await bucketKey(secret, identity)

    expect(result).toMatch(/^[0-9a-f]{64}$/)

    // Verify determinism
    const result2 = await bucketKey(secret, identity)
    expect(result).toBe(result2)
  })

  it('generates different keys for different identities', async () => {
    const secret = 'my-super-secret'
    const key1 = await bucketKey(secret, 'user-1')
    const key2 = await bucketKey(secret, 'user-2')
    expect(key1).not.toBe(key2)
  })

  it('generates different keys for different secrets', async () => {
    const identity = 'user-1'
    const key1 = await bucketKey('secret-1', identity)
    const key2 = await bucketKey('secret-2', identity)
    expect(key1).not.toBe(key2)
  })

  it('matches standard HMAC-SHA256 hex output', async () => {
    const secret = 'test-secret'
    const identity = 'test-identity'
    const result = await bucketKey(secret, identity)

    const expected = crypto.createHmac('sha256', secret).update(identity).digest('hex')
    expect(result).toBe(expected)
  })
})
