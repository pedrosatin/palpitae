import { describe, expect, expectTypeOf, it } from 'vitest'
import { importHmacKey, HMAC_SHA256 } from './crypto'

describe('crypto', () => {
  describe('HMAC_SHA256', () => {
    it('has the correct name and hash', () => {
      expect(HMAC_SHA256).toEqual({ name: 'HMAC', hash: 'SHA-256' })
      expectTypeOf<typeof HMAC_SHA256>().toEqualTypeOf<{
        readonly name: 'HMAC'
        readonly hash: 'SHA-256'
      }>()
    })
  })

  describe('importHmacKey', () => {
    it('imports a secret string as a CryptoKey for signing and verifying', async () => {
      const secret = 'my-super-secret-key'
      const key = await importHmacKey(secret)

      expect(key).toBeDefined()
      expect(key.type).toBe('secret')
      expect(key.extractable).toBe(false)
      expect(key.algorithm.name).toBe('HMAC')
      expect(key.usages).toContain('sign')
      expect(key.usages).toContain('verify')
    })
  })
})
