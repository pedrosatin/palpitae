import { describe, expect, it } from 'vitest'
import { importHmacKey, HMAC_SHA256 } from './crypto'

describe('crypto', () => {
  describe('HMAC_SHA256', () => {
    it('has the correct name and hash', () => {
      expect(HMAC_SHA256).toEqual({ name: 'HMAC', hash: 'SHA-256' })
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
      expect((key.algorithm as HmacKeyAlgorithm).hash.name).toBe('SHA-256')
      expect(key.usages).toContain('sign')
      expect(key.usages).toContain('verify')

      // Validate the key actually works for HMAC operations
      const data = new TextEncoder().encode('test message payload')
      const signature = await crypto.subtle.sign('HMAC', key, data)

      // Signature should be a 32-byte ArrayBuffer (256 bits) for SHA-256
      expect(signature.byteLength).toBe(32)

      // Verify the signature
      const isValid = await crypto.subtle.verify('HMAC', key, signature, data)
      expect(isValid).toBe(true)

      // Should fail to verify modified data
      const forgedData = new TextEncoder().encode('forged message payload')
      const isForgedValid = await crypto.subtle.verify('HMAC', key, signature, forgedData)
      expect(isForgedValid).toBe(false)
    })
  })
})
