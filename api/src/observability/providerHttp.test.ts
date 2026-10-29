import { describe, expect, it, vi } from 'vitest'
import {
  createProviderHttpObserver,
  HTTP_SUCCESS_SAMPLE_RATE,
  isHttpFailure,
  notifyHttpAttempt,
} from './providerHttp'

type Point = { indexes?: string[]; blobs?: string[]; doubles?: number[] }

function fakeAe() {
  return { writeDataPoint: vi.fn() }
}

function written(ae: ReturnType<typeof fakeAe>): Point[] {
  return ae.writeDataPoint.mock.calls.map((c) => c[0] as Point)
}

const COMP = '11111111-2222-4333-8444-555555555555'

describe('createProviderHttpObserver', () => {
  it('não cria observer sem binding do Analytics Engine (dev local, radar, testes)', () => {
    expect(createProviderHttpObserver(undefined, { context: 'poller' })).toBeUndefined()
  })

  it('emite o layout posicional: provider, competition_id, status, contexto | duration_ms, peso', () => {
    const ae = fakeAe()
    const observe = createProviderHttpObserver(
      ae,
      { context: 'poller', competitionId: COMP },
      () => 0.99,
    )

    observe?.({ provider: 'espn', status: 403, durationMs: 128.4 })

    expect(written(ae)).toEqual([
      {
        indexes: ['provider_http_attempt'],
        blobs: ['provider_http_attempt', 'espn', COMP, '403', 'poller'],
        doubles: [128, 1],
      },
    ])
  })

  it('competition_id ausente vira blob vazio e mantém as posições seguintes', () => {
    const ae = fakeAe()
    const observe = createProviderHttpObserver(ae, { context: 'sync' }, () => 0.99)

    observe?.({ provider: 'football-data', status: 500, durationMs: 10 })

    expect(written(ae)[0].blobs).toEqual([
      'provider_http_attempt',
      'football-data',
      '',
      '500',
      'sync',
    ])
  })

  it.each([400, 401, 403, 404, 429, 500, 502, 503, 599])(
    'emite sempre o HTTP %i, mesmo com o sorteio fora da amostra',
    (status) => {
      const ae = fakeAe()
      const observe = createProviderHttpObserver(ae, { context: 'discovery' }, () => 0.9999)

      observe?.({ provider: 'espn', status, durationMs: 5 })

      expect(written(ae)).toHaveLength(1)
      expect(written(ae)[0].doubles?.[1]).toBe(1)
    },
  )

  it('emite sempre a falha sem resposta (status 0: rede, timeout, abort)', () => {
    const ae = fakeAe()
    const observe = createProviderHttpObserver(ae, { context: 'fallback' }, () => 0.9999)

    observe?.({ provider: 'espn', status: 0, durationMs: 10_000 })

    expect(written(ae)[0].blobs?.[3]).toBe('0')
    expect(written(ae)[0].doubles).toEqual([10_000, 1])
  })

  it('amostra ~10% dos sucessos e grava o peso 1/taxa para estimar o total', () => {
    expect(HTTP_SUCCESS_SAMPLE_RATE).toBe(0.1)
    const ae = fakeAe()
    let draw = 0
    const observe = createProviderHttpObserver(ae, { context: 'poller' }, () => draw)

    draw = 0
    observe?.({ provider: 'espn', status: 200, durationMs: 40 })
    draw = 0.0999
    observe?.({ provider: 'espn', status: 304, durationMs: 40 })
    draw = 0.1
    observe?.({ provider: 'espn', status: 200, durationMs: 40 })
    draw = 0.5
    observe?.({ provider: 'football-data', status: 200, durationMs: 40 })

    const points = written(ae)
    expect(points).toHaveLength(2)
    expect(points.map((p) => p.doubles?.[1])).toEqual([10, 10])
  })

  it('com sorteio uniforme real, a fração emitida fica perto de 10%', () => {
    const ae = fakeAe()
    let seed = 42
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    const observe = createProviderHttpObserver(ae, { context: 'poller' }, rng)

    for (let i = 0; i < 10_000; i++) observe?.({ provider: 'espn', status: 200, durationMs: 1 })

    const emitted = written(ae).length
    expect(emitted).toBeGreaterThan(850)
    expect(emitted).toBeLessThan(1150)
  })

  it('nunca grava URL, query, slug, chave nem corpo: só os campos do contrato', () => {
    const ae = fakeAe()
    const observe = createProviderHttpObserver(
      ae,
      { context: 'poller', competitionId: COMP },
      () => 0.99,
    )

    // Um chamador desatento poderia empurrar campos extras no objeto.
    const attempt = {
      provider: 'football-data',
      status: 429,
      durationMs: 12,
      url: 'https://api.football-data.org/v4/competitions/BSA/matches?season=2026',
      apiKey: 'segredo-123',
      body: '{"message":"rate limit"}',
    } as Parameters<NonNullable<typeof observe>>[0]
    observe?.(attempt)

    const serialized = JSON.stringify(written(ae))
    expect(serialized).not.toMatch(/https?:|\.org|segredo|rate limit|season|BSA/i)
    expect(written(ae)[0].blobs).toHaveLength(5)
    expect(written(ae)[0].doubles).toHaveLength(2)
  })

  it('erro do binding não escapa para o cliente do provedor', () => {
    const ae = {
      writeDataPoint: vi.fn(() => {
        throw new Error('AE indisponível')
      }),
    }
    const observe = createProviderHttpObserver(ae, { context: 'poller' }, () => 0)

    expect(() => observe?.({ provider: 'espn', status: 500, durationMs: 1 })).not.toThrow()
  })
})

describe('isHttpFailure', () => {
  it.each([
    [0, true],
    [200, false],
    [204, false],
    [301, false],
    [399, false],
    [400, true],
    [429, true],
    [503, true],
  ])('status %i → falha=%s', (status, expected) => {
    expect(isHttpFailure(status)).toBe(expected)
  })
})

describe('notifyHttpAttempt', () => {
  it('sem observer é no-op', () => {
    expect(() =>
      notifyHttpAttempt(undefined, { provider: 'espn', status: 200, durationMs: 1 }),
    ).not.toThrow()
  })

  it('observer que lança não propaga o erro', () => {
    const observer = vi.fn(() => {
      throw new Error('bug na telemetria')
    })

    expect(() =>
      notifyHttpAttempt(observer, { provider: 'espn', status: 500, durationMs: 1 }),
    ).not.toThrow()
    expect(observer).toHaveBeenCalledOnce()
  })
})
