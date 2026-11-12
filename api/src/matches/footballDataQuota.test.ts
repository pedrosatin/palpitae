import { afterEach, describe, expect, it } from 'vitest'
import realHeaders from './__fixtures__/football-data-headers-200.json'
import {
  clearFootballDataPause,
  FD_FREE_REQUESTS_PER_MINUTE,
  FD_MAX_CONCURRENT_REQUESTS,
  FD_QUOTA_DEFAULT_PAUSE_MS,
  FD_QUOTA_MAX_PAUSE_MS,
  FD_RETRY_BACKOFF_MS,
  footballDataPausedUntil,
  noteFootballDataResponse,
  readFootballDataQuota,
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

describe('readFootballDataQuota', () => {
  const NOW = Date.parse('2026-11-12T12:02:13Z')

  it('lê a cota da resposta autenticada real e usa o maior dos dois resets', () => {
    expect(readFootballDataQuota(new Headers(realHeaders.headers), NOW)).toEqual({
      remaining: 9,
      resetSeconds: 60,
    })
  })

  it('aceita a grafia da resposta anônima e da documentação', () => {
    expect(
      readFootballDataQuota(
        new Headers({ 'X-Requests-Available': '49', 'X-RequestCounter-Reset': '86400' }),
        NOW,
      ),
    ).toEqual({ remaining: 49, resetSeconds: 86_400 })
    expect(readFootballDataQuota(new Headers({ 'X-RequestsAvailable': '0' }), NOW)).toEqual({
      remaining: 0,
      resetSeconds: null,
    })
  })

  it('Retry-After vale em segundos e como data HTTP', () => {
    expect(readFootballDataQuota(new Headers({ 'Retry-After': '42' }), NOW).resetSeconds).toBe(42)
    expect(
      readFootballDataQuota(new Headers({ 'Retry-After': 'Thu, 12 Nov 2026 12:03:00 GMT' }), NOW)
        .resetSeconds,
    ).toBe(47)
  })

  it('cabeçalho ausente ou inválido vira desconhecido, sem erro', () => {
    expect(readFootballDataQuota(undefined, NOW)).toEqual({ remaining: null, resetSeconds: null })
    expect(readFootballDataQuota(new Headers(), NOW)).toEqual({
      remaining: null,
      resetSeconds: null,
    })
    expect(
      readFootballDataQuota(
        new Headers({
          'x-requests-available-minute': '-1',
          'X-RequestCounter-Reset': '1.5',
          'x-request_counter-reset': 'NaN',
          'Retry-After': '-5',
        }),
        NOW,
      ),
    ).toEqual({ remaining: null, resetSeconds: null })
  })
})

describe('noteFootballDataResponse', () => {
  const NOW = 1_000_000
  afterEach(() => clearFootballDataPause())

  it('resposta com cota sobrando não pausa', () => {
    noteFootballDataResponse(200, { remaining: 9, resetSeconds: 60 }, NOW)
    noteFootballDataResponse(500, { remaining: null, resetSeconds: null }, NOW)
    expect(footballDataPausedUntil()).toBe(0)
  })

  it('429 pausa pelo reset, com piso no backoff e teto de 1 h', () => {
    noteFootballDataResponse(429, { remaining: 0, resetSeconds: 37 }, NOW)
    expect(footballDataPausedUntil()).toBe(NOW + 37_000)

    clearFootballDataPause()
    noteFootballDataResponse(429, { remaining: null, resetSeconds: 0 }, NOW)
    expect(footballDataPausedUntil()).toBe(NOW + FD_RETRY_BACKOFF_MS)

    clearFootballDataPause()
    noteFootballDataResponse(429, { remaining: null, resetSeconds: 86_400 }, NOW)
    expect(footballDataPausedUntil()).toBe(NOW + FD_QUOTA_MAX_PAUSE_MS)
  })

  it('cota zerada sem reset usa a pausa padrão', () => {
    noteFootballDataResponse(200, { remaining: 0, resetSeconds: null }, NOW)
    expect(footballDataPausedUntil()).toBe(NOW + FD_QUOTA_DEFAULT_PAUSE_MS)
  })

  it('uma pausa em curso nunca encurta', () => {
    noteFootballDataResponse(429, { remaining: 0, resetSeconds: 50 }, NOW)
    noteFootballDataResponse(429, { remaining: 0, resetSeconds: 10 }, NOW + 1_000)
    expect(footballDataPausedUntil()).toBe(NOW + 50_000)
  })
})
