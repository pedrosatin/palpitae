import crypto from 'node:crypto'
import type { D1Database } from '@cloudflare/workers-types'
import type { Context } from 'hono'
import { describe, it, expect, vi } from 'vitest'
import type { AppContext } from '../types'
import {
  anonymousIdentity,
  bucketKey,
  clearExpiredSecurityRecords,
  CLIENT_IP_HEADER,
  ipBucketIdentity,
  PROXY_SECRET_HEADER,
} from './limits'

describe('bucketKey', () => {
  it('generates a stable HMAC-SHA256 hex string', async () => {
    const key = await bucketKey('secret', '192.168.1.1')
    expect(key).toMatch(/^[a-f0-9]{64}$/)

    // Same inputs produce same key
    const key2 = await bucketKey('secret', '192.168.1.1')
    expect(key).toBe(key2)

    // Different secret produces different key
    const key3 = await bucketKey('other-secret', '192.168.1.1')
    expect(key).not.toBe(key3)

    // Different identity produces different key
    const key4 = await bucketKey('secret', '192.168.1.2')
    expect(key).not.toBe(key4)
  })

  it('matches Web Crypto HMAC-SHA256', async () => {
    const secret = 'test-secret'
    const identity = '10.0.0.1'

    const key = await bucketKey(secret, identity)

    // Verify using Node crypto directly
    const hmac = crypto.createHmac('sha256', secret)
    hmac.update(identity)
    const expected = hmac.digest('hex')

    expect(key).toBe(expected)
  })
})

describe('ipBucketIdentity', () => {
  it('leaves IPv4 addresses as is', () => {
    expect(ipBucketIdentity('192.168.1.100')).toBe('192.168.1.100')
    expect(ipBucketIdentity('10.0.1.254')).toBe('10.0.1.254')
    expect(ipBucketIdentity('172.16.0.1')).toBe('172.16.0.1')
  })

  it('masks standard IPv6 addresses to /64 prefix', () => {
    expect(ipBucketIdentity('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:db8:85a3:0::/64')
    expect(ipBucketIdentity('fe80:0000:0000:0000:0204:61ff:fe9d:f156')).toBe('fe80:0:0:0::/64')
  })

  it('expands and masks compressed IPv6 addresses', () => {
    expect(ipBucketIdentity('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(ipBucketIdentity('::1')).toBe('0:0:0:0::/64')
    expect(ipBucketIdentity('fe80::')).toBe('fe80:0:0:0::/64')
  })

  it('returns non-IP values as is', () => {
    expect(ipBucketIdentity('not-an-ip')).toBe('not-an-ip')
    expect(ipBucketIdentity('invalid:ip:address:format:too:many:colons:for:no:reason:here')).toBe('invalid:ip:address:format:too:many:colons:for:no:reason:here')
  })

  it('handles edge cases in IPv6 expansion', () => {
    // :: at the end
    expect(ipBucketIdentity('2001:db8::')).toBe('2001:db8:0:0::/64')
    // :: at the start with enough parts
    expect(ipBucketIdentity('::2001:db8')).toBe('0:0:0:0::/64')
  })
})

describe('clearExpiredSecurityRecords', () => {
  it('clears expired records from both tables using batch execution', async () => {
    vi.useFakeTimers()
    const nowSecs = 1700000000
    vi.setSystemTime(new Date(nowSecs * 1000))

    const stmtLimits = { bind: vi.fn().mockReturnThis() }
    const stmtSessions = { bind: vi.fn().mockReturnThis() }

    const mockPrepare = vi.fn().mockImplementation((query) => {
      if (query.includes('request_limits')) return stmtLimits
      if (query.includes('revoked_sessions')) return stmtSessions
      return null
    })

    const mockBatch = vi.fn().mockResolvedValue([])

    const mockDb = {
      prepare: mockPrepare,
      batch: mockBatch,
    } as unknown as D1Database

    await clearExpiredSecurityRecords(mockDb)

    expect(mockPrepare).toHaveBeenCalledTimes(2)
    expect(mockPrepare).toHaveBeenCalledWith('DELETE FROM request_limits WHERE expires_at <= ?')
    expect(mockPrepare).toHaveBeenCalledWith('DELETE FROM revoked_sessions WHERE expires_at <= ?')

    expect(stmtLimits.bind).toHaveBeenCalledWith(nowSecs)
    expect(stmtSessions.bind).toHaveBeenCalledWith(nowSecs)

    expect(mockBatch).toHaveBeenCalledWith([stmtLimits, stmtSessions])

    vi.useRealTimers()
  })
})

describe('anonymousIdentity', () => {
  const createMockContext = (env: any, headers: Record<string, string>) => {
    const getHeader = (name: string) => {
      const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
      return key ? headers[key] : undefined
    }
    return {
      env,
      req: {
        header: vi.fn().mockImplementation(getHeader),
      },
    } as unknown as Context<AppContext>
  }

  it('should return ip identity when proxy secret is valid and forwarded IP is valid', async () => {
    const context = createMockContext(
      { PROXY_SHARED_SECRET: 'test-secret' },
      { [PROXY_SECRET_HEADER]: 'test-secret', [CLIENT_IP_HEADER]: '192.168.1.1' },
    )
    const result = await anonymousIdentity(context)
    expect(result).toEqual({ identity: 'ip:192.168.1.1', shared: false })
  })

  it('should return frontend proxy identity for shared worker without secret', async () => {
    const context = createMockContext(
      { FRONTEND_URL: 'https://test.com' },
      { 'CF-Worker': 'test.com' },
    )
    const result = await anonymousIdentity(context)
    expect(result).toEqual({ identity: 'proxy:anonymous:frontend', shared: true })
  })

  it('should handle other worker egress IP as proxy anonymous worker', async () => {
    const context = createMockContext(
      { FRONTEND_URL: 'https://test.com' },
      { 'CF-Connecting-IP': '2a06:98c0:3600::103' },
    )
    const result = await anonymousIdentity(context)
    expect(result).toEqual({ identity: 'proxy:anonymous:worker', shared: true })
  })

  it('should fallback to local when no matching headers are present', async () => {
    const context = createMockContext({}, {})
    const result = await anonymousIdentity(context)
    expect(result).toEqual({ identity: 'ip:local', shared: false })
  })

  it('should handle direct IP fallback', async () => {
    const context = createMockContext({}, { 'CF-Connecting-IP': '10.0.0.1' })
    const result = await anonymousIdentity(context)
    expect(result).toEqual({ identity: 'ip:10.0.0.1', shared: false })
  })
})
