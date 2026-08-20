import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCachedJson, invalidateApiCache } from './api-cache'

describe('api-cache', () => {
  beforeEach(() => {
    invalidateApiCache()
    vi.restoreAllMocks()
  })

  it('deduplicates concurrent and repeated reads within the TTL window', async () => {
    const loader = vi.fn(async () => ({ groups: ['g1'] }))

    const [first, second] = await Promise.all([
      fetchCachedJson('groups:list', loader, 1_000),
      fetchCachedJson('groups:list', loader, 1_000),
    ])

    const third = await fetchCachedJson('groups:list', loader, 1_000)

    expect(first).toEqual({ groups: ['g1'] })
    expect(second).toEqual({ groups: ['g1'] })
    expect(third).toEqual({ groups: ['g1'] })
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('drops entries when invalidated so the next read fetches again', async () => {
    const loader = vi.fn(async () => ({ matches: ['m1'] }))

    await fetchCachedJson('matches:comp-1', loader, 1_000)
    invalidateApiCache('matches:')
    await fetchCachedJson('matches:comp-1', loader, 1_000)

    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('refetches when the TTL has expired', async () => {
    const loader = vi.fn(async () => ({ data: 'test' }))
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)

    await fetchCachedJson('ttl-test', loader, 500)

    // Within TTL
    dateSpy.mockReturnValue(1400)
    await fetchCachedJson('ttl-test', loader, 500)
    expect(loader).toHaveBeenCalledTimes(1)

    // After TTL
    dateSpy.mockReturnValue(1600)
    await fetchCachedJson('ttl-test', loader, 500)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('uses default TTL if not provided', async () => {
    const loader = vi.fn(async () => ({ data: 'default-ttl' }))
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)

    await fetchCachedJson('default-ttl-test', loader)

    // Within default 30s TTL
    dateSpy.mockReturnValue(30000)
    await fetchCachedJson('default-ttl-test', loader)
    expect(loader).toHaveBeenCalledTimes(1)

    // After default 30s TTL
    dateSpy.mockReturnValue(32000)
    await fetchCachedJson('default-ttl-test', loader)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('removes cache entry if loader throws an error', async () => {
    let callCount = 0
    const loader = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        throw new Error('Network error')
      }
      return { success: true }
    })

    await expect(fetchCachedJson('error-test', loader)).rejects.toThrow('Network error')

    // Next call should retry because the cache entry was removed
    const result = await fetchCachedJson('error-test', loader)
    expect(result).toEqual({ success: true })
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('does not remove cache entry if loader throws an error but cache was already overwritten', async () => {
    let rejectPromise: (reason?: any) => void
    const slowLoader = vi.fn(() => new Promise((_, reject) => {
      rejectPromise = reject
    }))

    const firstCall = fetchCachedJson('overwrite-test', slowLoader)

    // Simulate another request taking over the cache key before the first one fails
    invalidateApiCache('overwrite-test')
    const secondLoader = vi.fn(async () => ({ success: true }))
    const secondCall = fetchCachedJson('overwrite-test', secondLoader)

    rejectPromise!(new Error('First call failed'))

    await expect(firstCall).rejects.toThrow('First call failed')
    await expect(secondCall).resolves.toEqual({ success: true })

    // Third call should still use the second call's cached result
    const thirdCall = await fetchCachedJson('overwrite-test', secondLoader)
    expect(thirdCall).toEqual({ success: true })
    expect(secondLoader).toHaveBeenCalledTimes(1)
  })

  it('clears all cache if no prefix is provided', async () => {
    const loader = vi.fn(async () => ({ val: 1 }))

    await fetchCachedJson('key-1', loader)
    await fetchCachedJson('key-2', loader)

    invalidateApiCache()

    await fetchCachedJson('key-1', loader)
    await fetchCachedJson('key-2', loader)

    expect(loader).toHaveBeenCalledTimes(4)
  })

  it('clears exact matches and prefix matches', async () => {
    const loader = vi.fn(async () => ({ val: 1 }))

    await fetchCachedJson('user:1', loader)
    await fetchCachedJson('user:1:profile', loader)
    await fetchCachedJson('user:10', loader)
    await fetchCachedJson('user:2', loader)

    invalidateApiCache('user:1')

    await fetchCachedJson('user:1', loader) // refetches
    await fetchCachedJson('user:1:profile', loader) // refetches
    await fetchCachedJson('user:10', loader) // refetches
    await fetchCachedJson('user:2', loader) // cached

    expect(loader).toHaveBeenCalledTimes(7)
  })
})
