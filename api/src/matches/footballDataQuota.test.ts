import { describe, expect, it } from 'vitest'
import {
  FD_FREE_REQUESTS_PER_MINUTE,
  FD_MAX_CONCURRENT_REQUESTS,
  FD_RETRY_BACKOFF_MS,
  runWithConcurrency,
} from './footballDataQuota'

describe('footballDataQuota', () => {
  it('documents free-tier budget with headroom under 10 req/min', () => {
    expect(FD_FREE_REQUESTS_PER_MINUTE).toBe(10)
    expect(FD_MAX_CONCURRENT_REQUESTS).toBeGreaterThan(0)
    expect(FD_MAX_CONCURRENT_REQUESTS).toBeLessThan(FD_FREE_REQUESTS_PER_MINUTE)
    expect(FD_RETRY_BACKOFF_MS).toBeGreaterThan(0)
  })

  it('runWithConcurrency caps in-flight workers and preserves order', async () => {
    const items = [1, 2, 3, 4, 5, 6]
    let inFlight = 0
    let peak = 0

    const results = await runWithConcurrency(2, items, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return n * 10
    })

    expect(peak).toBeLessThanOrEqual(2)
    expect(peak).toBe(2)
    expect(results).toEqual([10, 20, 30, 40, 50, 60])
  })

  it('runWithConcurrency returns empty array for empty input', async () => {
    const worker = async () => {
      throw new Error('should not run')
    }
    await expect(runWithConcurrency(4, [], worker)).resolves.toEqual([])
  })
})
