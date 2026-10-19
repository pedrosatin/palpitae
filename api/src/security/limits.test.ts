import crypto from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { bucketKey, ipBucketIdentity, requestLimits } from './limits'

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

describe('ipBucketIdentity', () => {
  it('returns IPv4 as is', () => {
    expect(ipBucketIdentity('192.168.1.1')).toBe('192.168.1.1')
    expect(ipBucketIdentity('  10.0.0.1  ')).toBe('10.0.0.1')
    expect(ipBucketIdentity('8.8.8.8')).toBe('8.8.8.8')
  })

  it('extracts IPv4 from IPv4-mapped IPv6 addresses', () => {
    expect(ipBucketIdentity('::ffff:192.168.1.1')).toBe('192.168.1.1')
    expect(ipBucketIdentity('::FFFF:10.0.0.1')).toBe('10.0.0.1')
  })

  it('groups IPv6 addresses by /64 prefix', () => {
    // Full IPv6
    expect(ipBucketIdentity('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:db8:85a3:0::/64')
    // Compressed IPv6
    expect(ipBucketIdentity('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3:0::/64')
    // Localhost
    expect(ipBucketIdentity('::1')).toBe('0:0:0:0::/64')
    // Partial compression
    expect(ipBucketIdentity('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(ipBucketIdentity('2a06:98c0:3600::103')).toBe('2a06:98c0:3600:0::/64')
  })

  it('returns non-IP values as is', () => {
    expect(ipBucketIdentity('not-an-ip')).toBe('not-an-ip')
    expect(ipBucketIdentity('invalid:ip:address:format:too:many:colons:for:no:reason:here')).toBe('invalid:ip:address:format:too:many:colons:for:no:reason:here')
  })

  it('handles edge cases in IPv6 expansion', () => {
    // Missing hextets or invalid hex
    expect(ipBucketIdentity('2001:db8:zzzz::')).toBe('2001:db8:zzzz::')
    // Trailing ::
    expect(ipBucketIdentity('2001:db8::')).toBe('2001:db8:0:0::/64')
    // Leading ::
    expect(ipBucketIdentity('::2001:db8')).toBe('0:0:0:0::/64')
  })
})

describe('requestLimits', () => {
  it('handles D1 DB error during consumption gracefully', async () => {
    const { Hono } = await import('hono')
    const app = new Hono()

    // Mock db throwing an error in consumeLimit
    const mockDb = {
      prepare: () => ({
        bind: () => ({
          first: () => Promise.reject(new Error('DB is down!'))
        })
      })
    }

    // Mock logError via c.env.AE (which will just be ignored here, but we should pass something)
    const mockEnv = {
      DB: mockDb,
      AE: {
        writeDataPoint: () => {}
      },
      JWT_SECRET: 'secret',
      FRONTEND_URL: 'http://localhost'
    }

    app.use('*', requestLimits)
    app.get('/', (c) => c.text('ok'))
    app.post('/', (c) => c.text('ok'))

    // Test read operation with DB error (should pass)
    const req1 = new Request('http://localhost/', { method: 'GET' })
    const res1 = await app.fetch(req1, mockEnv)
    expect(res1.status).toBe(200)

    // Test write operation with DB error (should be blocked)
    const req2 = new Request('http://localhost/', { method: 'POST' })
    const res2 = await app.fetch(req2, mockEnv)
    expect(res2.status).toBe(503)
    expect(await res2.json()).toEqual({ error: 'Controle de requisições indisponível' })
  })
})
