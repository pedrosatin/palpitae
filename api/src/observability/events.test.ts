import { describe, expect, it, vi, afterEach } from 'vitest'
import { hashUserId, logError, logEvent } from './events'

type Point = {
  indexes?: string[]
  blobs?: (string | null | undefined)[]
  doubles?: number[]
}

function fakeAe() {
  const calls: Point[] = []
  const ae = {
    writeDataPoint: (p: Point) => calls.push(p),
  } as unknown as AnalyticsEngineDataset
  return { ae, calls }
}

describe('logEvent', () => {
  it('writes the positional contract: index + blob1 = event_type', () => {
    const { ae, calls } = fakeAe()
    logEvent(ae, 'login_success', { blobs: ['x'], doubles: [1] })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      indexes: ['login_success'],
      blobs: ['login_success', 'x'],
      doubles: [1],
    })
  })

  it('coerces null/undefined blobs to empty string', () => {
    const { ae, calls } = fakeAe()
    logEvent(ae, 'prediction_saved', { blobs: [null, undefined] })
    expect(calls[0].blobs).toEqual(['prediction_saved', '', ''])
  })

  it('truncates each blob to at most 256 chars', () => {
    const { ae, calls } = fakeAe()
    const long = 'a'.repeat(300)
    logEvent(ae, 'prediction_saved', { blobs: [long] })
    expect(calls[0].blobs?.[1]).toHaveLength(256)
    expect(calls[0].blobs?.[1]).toBe('a'.repeat(256))
  })

  it('is a no-op when the binding is undefined', () => {
    expect(() => logEvent(undefined, 'login_success', { blobs: ['x'] })).not.toThrow()
  })
})

describe('logError', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls console.error and logs event with Error object', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ae, calls } = fakeAe()
    const err = new Error('Test error')

    logError(ae, 'football_api_error', 'Sync failed:', err, { blobs: ['comp-1'] })

    expect(consoleSpy).toHaveBeenCalledWith('Sync failed:', err)
    expect(calls).toHaveLength(1)
    expect(calls[0].blobs).toEqual(['football_api_error', 'comp-1', 'Test error'])
  })

  it('calls console.error and logs event with non-Error object', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ae, calls } = fakeAe()

    logError(ae, 'football_api_error', 'Sync failed:', 'String error', { blobs: ['comp-1'] })

    expect(consoleSpy).toHaveBeenCalledWith('Sync failed:', 'String error')
    expect(calls).toHaveLength(1)
    expect(calls[0].blobs).toEqual(['football_api_error', 'comp-1', 'String error'])
  })
})

describe('hashUserId', () => {
  it('is deterministic and returns 16 hex chars', async () => {
    const a = await hashUserId('some-uuid')
    const b = await hashUserId('some-uuid')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
  })

  it('produces different hashes for different ids', async () => {
    const a = await hashUserId('id-one')
    const b = await hashUserId('id-two')
    expect(a).not.toBe(b)
  })
})
