type CacheEntry<T> = {
  expiresAt: number
  promise: Promise<T>
}

const responseCache = new Map<string, CacheEntry<unknown>>()

export function fetchCachedJson<T>(
  cacheKey: string,
  loader: () => Promise<T>,
  ttlMs = 30_000,
): Promise<T> {
  const now = Date.now()
  const cached = responseCache.get(cacheKey)

  if (cached && cached.expiresAt > now) {
    return cached.promise as Promise<T>
  }

  const promise = loader().catch((error) => {
    const current = responseCache.get(cacheKey)
    if (current?.promise === promise) {
      responseCache.delete(cacheKey)
    }
    throw error
  })

  responseCache.set(cacheKey, {
    expiresAt: now + ttlMs,
    promise,
  })

  return promise
}

export function invalidateApiCache(cacheKeyPrefix?: string) {
  if (!cacheKeyPrefix) {
    responseCache.clear()
    return
  }

  for (const key of responseCache.keys()) {
    if (key === cacheKeyPrefix || key.startsWith(cacheKeyPrefix)) {
      responseCache.delete(key)
    }
  }
}
