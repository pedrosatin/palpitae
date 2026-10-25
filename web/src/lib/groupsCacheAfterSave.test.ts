import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCachedJson, invalidateApiCache } from './api-cache'

/**
 * Regressão issue #120 / R1: GET /groups fica 30s em fetchCachedJson
 * (`groups:list:user`). Após gravar palpites a home precisa refetchar;
 * sem invalidateApiCache('groups:') o N antigo permanece dentro do TTL.
 */
describe('groups list cache after prediction save', () => {
  beforeEach(() => {
    invalidateApiCache()
    vi.restoreAllMocks()
  })

  it('keeps stale pending_predictions within TTL when save does not invalidate', async () => {
    let pending = 4
    const loader = vi.fn(async () => ({ groups: [{ id: 'g1', pending_predictions: pending }] }))

    const first = await fetchCachedJson('groups:list:user-a:default', loader, 30_000)
    expect(first.groups[0].pending_predictions).toBe(4)
    expect(loader).toHaveBeenCalledTimes(1)

    // Simula PUT /predictions ok sem invalidar (bug pré-R1).
    pending = 2

    const second = await fetchCachedJson('groups:list:user-a:default', loader, 30_000)
    expect(second.groups[0].pending_predictions).toBe(4)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('refetches pending_predictions within TTL after invalidateApiCache(groups:)', async () => {
    let pending = 4
    const loader = vi.fn(async () => ({ groups: [{ id: 'g1', pending_predictions: pending }] }))

    await fetchCachedJson('groups:list:user-a:default', loader, 30_000)
    expect(loader).toHaveBeenCalledTimes(1)

    pending = 2
    // Fluxo pós-sucesso de save individual/bulk/import.
    invalidateApiCache('groups:')

    const refreshed = await fetchCachedJson('groups:list:user-a:default', loader, 30_000)
    expect(refreshed.groups[0].pending_predictions).toBe(2)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('does not treat a failed save as success when invalidate is skipped', async () => {
    let pending = 4
    const loader = vi.fn(async () => ({ groups: [{ id: 'g1', pending_predictions: pending }] }))

    await fetchCachedJson('groups:list:user-a:default', loader, 30_000)

    // Erro de gravação: não chama invalidate; contagem local permanece a do servidor.
    pending = 2
    const stillCached = await fetchCachedJson('groups:list:user-a:default', loader, 30_000)
    expect(stillCached.groups[0].pending_predictions).toBe(4)
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
