import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ESPN_MIN_INTERVAL_MS,
  ESPN_RETRY_BACKOFF_MS,
  ESPN_TIMEOUT_MS,
  espnScoreboardUrl,
  fetchEspnScoreboard,
  resetEspnClientForTests,
  setEspnMinIntervalForTests,
  setEspnTimeoutForTests,
} from './espn'

describe('fetchEspnScoreboard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    // O setup global zera o delay; aqui restauramos 1,3s para medir pacing.
    resetEspnClientForTests()
    setEspnMinIntervalForTests(ESPN_MIN_INTERVAL_MS)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetEspnClientForTests()
  })

  it('consulta a URL do scoreboard com a data compacta no parâmetro dates', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ events: [] })))

    await expect(fetchEspnScoreboard('bra.1', '20261007')).resolves.toEqual({ events: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard?dates=20261007',
    )
  })

  it('consulta a URL do scoreboard sem query string quando yyyymmdd é omitido', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ events: [] })))

    await expect(fetchEspnScoreboard('conmebol.libertadores')).resolves.toEqual({ events: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.libertadores/scoreboard',
    )
  })

  it('serializa chamadas com intervalo mínimo entre inícios e sem sobreposição HTTP', async () => {
    vi.useFakeTimers()
    let inFlight = 0
    let peak = 0
    const startedAt: number[] = []

    vi.mocked(fetch).mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      startedAt.push(Date.now())
      await new Promise((resolve) => setTimeout(resolve, 50))
      inFlight--
      return new Response(JSON.stringify({ events: [] }))
    })

    const first = fetchEspnScoreboard('bra.1', '20261001')
    const second = fetchEspnScoreboard('bra.1', '20261002')

    await vi.advanceTimersByTimeAsync(50)
    await first
    expect(fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(ESPN_MIN_INTERVAL_MS - 51)
    expect(fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(50)
    await second

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(peak).toBe(1)
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(ESPN_MIN_INTERVAL_MS)
  })

  it('retenta uma vez com backoff em 429 e aceita a segunda resposta', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('Too many requests', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [], leagues: [] })))

    const promise = fetchEspnScoreboard('eng.1', '20261005')
    await vi.advanceTimersByTimeAsync(ESPN_RETRY_BACKOFF_MS)

    await expect(promise).resolves.toEqual({ events: [], leagues: [] })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retenta em 5xx e lança se a segunda tentativa também falhar', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('boom', { status: 502 }))
      .mockResolvedValueOnce(new Response('boom de novo', { status: 503 }))

    const promise = fetchEspnScoreboard('bra.2', '20261005')
    const assertion = expect(promise).rejects.toThrow(
      'ESPN respondeu 503 em bra.2: boom de novo',
    )
    await vi.advanceTimersByTimeAsync(ESPN_RETRY_BACKOFF_MS)
    await assertion
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('não retenta 403 Akamai nem outros 4xx (sem tempestade de retry)', async () => {
    setEspnMinIntervalForTests(0)
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

    await expect(fetchEspnScoreboard('bra.1', '20261005')).rejects.toThrow(
      'ESPN respondeu 403 em bra.1: Forbidden',
    )
    expect(fetch).toHaveBeenCalledTimes(1)

    vi.mocked(fetch).mockResolvedValueOnce(new Response('nope', { status: 404 }))
    await expect(fetchEspnScoreboard('nao.existe', '20261005')).rejects.toThrow(
      'ESPN respondeu 404 em nao.existe: nope',
    )
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('aborta a tentativa quando o timeout do AbortSignal dispara', async () => {
    setEspnMinIntervalForTests(0)
    setEspnTimeoutForTests(30)
    vi.mocked(fetch).mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal
          if (!signal) {
            reject(new Error('signal ausente'))
            return
          }
          if (signal.aborted) {
            reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
            return
          }
          signal.addEventListener('abort', () => {
            reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
          })
        }),
    )

    await expect(fetchEspnScoreboard('bra.1', '20261005')).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error ||
        (typeof DOMException !== 'undefined' && err instanceof DOMException),
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('expõe a URL montada com e sem data como documentação viva do formato', () => {
    expect(espnScoreboardUrl('conmebol.libertadores', '20260818')).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.libertadores/scoreboard?dates=20260818',
    )
    expect(espnScoreboardUrl('conmebol.libertadores')).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.libertadores/scoreboard',
    )
  })

  it('documenta timeout, retry e pacing exportados', () => {
    expect(ESPN_TIMEOUT_MS).toBe(10_000)
    expect(ESPN_RETRY_BACKOFF_MS).toBe(500)
    expect(ESPN_MIN_INTERVAL_MS).toBe(1_300)
  })
})
