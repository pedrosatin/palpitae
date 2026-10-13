import { describe, expect, it } from 'vitest'
import { sessionHash } from './session'

describe('sessionHash', () => {
  it('computes SHA-256 hash correctly for a given token', async () => {
    const token = 'test-token-123'
    const hash = await sessionHash(token)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)

    // Hash of 'test-token-123' using SHA-256 is 19b6b086eebb807f54e6327309dec0ff347a6c3c30bf3bb396f167513eba3475
    expect(hash).toBe('19b6b086eebb807f54e6327309dec0ff347a6c3c30bf3bb396f167513eba3475')
  })

  it('produces different hashes for different tokens', async () => {
    const hash1 = await sessionHash('token1')
    const hash2 = await sessionHash('token2')
    expect(hash1).not.toBe(hash2)
  })

  it('handles empty string correctly', async () => {
    const hash = await sessionHash('')
    // Hash of empty string using SHA-256 is e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
