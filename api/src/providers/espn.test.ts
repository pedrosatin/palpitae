import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { espnScoreboardUrl, fetchEspnScoreboard } from './espn'

describe('fetchEspnScoreboard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('consulta a URL do scoreboard com a data compacta', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ events: [] })))

    const promise = fetchEspnScoreboard('bra.1', '20261007')
    await vi.advanceTimersByTimeAsync(0)

    await expect(promise).resolves.toEqual({ events: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard?date=20261007',
    )
  })

  it('retenta uma vez com backoff em 429 e aceita a segunda resposta', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('Too many requests', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [], leagues: [] })))

    const promise = fetchEspnScoreboard('eng.1', '20261005')
    // Avança o backoff do retry; sem isso o teste trava esperando o delay.
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(promise).resolves.toEqual({ events: [], leagues: [] })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retenta em 5xx e lança se a segunda tentativa também falhar', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('boom', { status: 502 }))
      .mockResolvedValueOnce(new Response('boom de novo', { status: 503 }))

    const promise = fetchEspnScoreboard('bra.2', '20261005')
    const assertion = expect(promise).rejects.toThrow(
      'ESPN respondeu 503 em bra.2: boom de novo',
    )
    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('não retenta erro de cliente (4xx)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('nope', { status: 404 }))

    await expect(fetchEspnScoreboard('nao.existe', '20261005')).rejects.toThrow(
      'ESPN respondeu 404 em nao.existe: nope',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('expõe a URL montada (documentação viva do formato)', () => {
    expect(espnScoreboardUrl('conmebol.libertadores', '20260818')).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.libertadores/scoreboard?date=20260818',
    )
  })
})
