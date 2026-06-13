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
})