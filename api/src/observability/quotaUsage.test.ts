import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../types'
import {
  CF_GRAPHQL_URL,
  FREE_DAILY_QUOTAS,
  checkQuotaUsage,
  fetchDailyUsage,
  previousUtcDay,
  quotaThreshold,
} from './quotaUsage'

// 00:05 UTC de 14/11/2026: o cron mede o dia 13.
const NOW = new Date('2026-11-14T00:05:00Z')

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AE: { writeDataPoint: vi.fn() },
    CF_ACCOUNT_ID: 'conta',
    CF_ANALYTICS_TOKEN: 'token-analytics',
    ...overrides,
  } as unknown as Env
}

/** Eventos gravados no AE de teste: blobs e doubles de cada data point. */
function events(env: Env) {
  const write = vi.mocked((env.AE as AnalyticsEngineDataset).writeDataPoint)
  return write.mock.calls.map(([point]) => ({ blobs: point?.blobs, doubles: point?.doubles }))
}

function alerts(env: Env) {
  return events(env).filter((e) => e.blobs?.[0] === 'cloudflare_quota_alert')
}

/** Resposta GraphQL com o uso de cada métrica em fração da cota. */
function usageAt(fraction: { read?: number; written?: number; requests?: number }) {
  return {
    data: {
      viewer: {
        accounts: [
          {
            d1AnalyticsAdaptiveGroups: [
              {
                sum: {
                  rowsRead: Math.round((fraction.read ?? 0) * FREE_DAILY_QUOTAS.d1_rows_read),
                  rowsWritten: Math.round(
                    (fraction.written ?? 0) * FREE_DAILY_QUOTAS.d1_rows_written,
                  ),
                },
              },
            ],
            workersInvocationsAdaptive: [
              {
                sum: {
                  requests: Math.round(
                    (fraction.requests ?? 0) * FREE_DAILY_QUOTAS.worker_requests,
                  ),
                },
              },
            ],
          },
        ],
      },
    },
    errors: null,
  }
}

function stubGraphql(body: unknown, status = 200) {
  const fetchFake = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }))
  vi.stubGlobal('fetch', fetchFake)
  return fetchFake
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('previousUtcDay', () => {
  it('devolve o dia UTC anterior, também na virada de mês', () => {
    expect(previousUtcDay(NOW)).toBe('2026-11-13')
    expect(previousUtcDay(new Date('2026-12-01T00:05:00Z'))).toBe('2026-11-30')
  })
})

describe('quotaThreshold', () => {
  it('devolve a maior faixa alcançada', () => {
    expect(quotaThreshold(49_999, 100_000)).toBeNull()
    expect(quotaThreshold(50_000, 100_000)).toBe(50)
    expect(quotaThreshold(79_999, 100_000)).toBe(50)
    expect(quotaThreshold(80_000, 100_000)).toBe(80)
    expect(quotaThreshold(120_000, 100_000)).toBe(80)
  })
})

describe('fetchDailyUsage', () => {
  it('consulta a conta inteira no dia UTC pedido e soma os grupos', async () => {
    const fetchFake = stubGraphql({
      data: {
        viewer: {
          accounts: [
            {
              d1AnalyticsAdaptiveGroups: [
                { sum: { rowsRead: 100, rowsWritten: 10 } },
                { sum: { rowsRead: 50, rowsWritten: 5 } },
              ],
              workersInvocationsAdaptive: [{ sum: { requests: 7 } }, { sum: { requests: 3 } }],
            },
          ],
        },
      },
    })

    const usage = await fetchDailyUsage(makeEnv(), '2026-11-13')

    expect(usage).toEqual({ d1_rows_read: 150, d1_rows_written: 15, worker_requests: 10 })
    const [url, init] = fetchFake.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(CF_GRAPHQL_URL)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token-analytics' })
    const body = JSON.parse(init.body as string) as {
      query: string
      variables: Record<string, string>
    }
    expect(body.query).toContain('d1AnalyticsAdaptiveGroups')
    expect(body.query).toContain('workersInvocationsAdaptive')
    expect(body.variables).toEqual({
      accountTag: 'conta',
      date: '2026-11-13',
      start: '2026-11-13T00:00:00Z',
      end: '2026-11-14T00:00:00Z',
    })
  })

  it('dia sem uso devolve zero em cada métrica', async () => {
    stubGraphql({
      data: {
        viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [], workersInvocationsAdaptive: [] }] },
      },
    })

    await expect(fetchDailyUsage(makeEnv(), '2026-11-13')).resolves.toEqual({
      d1_rows_read: 0,
      d1_rows_written: 0,
      worker_requests: 0,
    })
  })

  it('lança quando a resposta não traz a conta', async () => {
    stubGraphql({ data: { viewer: { accounts: [] } } })

    await expect(fetchDailyUsage(makeEnv(), '2026-11-13')).rejects.toThrow(
      'GraphQL respondeu sem a conta pedida',
    )
  })
})

describe('checkQuotaUsage', () => {
  it('40% de cada cota grava a medição e nenhum alerta', async () => {
    stubGraphql(usageAt({ read: 0.4, written: 0.4, requests: 0.4 }))
    const env = makeEnv()

    await expect(checkQuotaUsage(env, NOW)).resolves.toBe('ok')

    expect(events(env)).toEqual([
      {
        blobs: ['cloudflare_usage', '2026-11-13'],
        doubles: [2_000_000, 40_000, 40_000],
      },
    ])
    expect(alerts(env)).toEqual([])
  })

  it('60% grava o alerta de 50% da métrica', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubGraphql(usageAt({ read: 0.1, written: 0.6, requests: 0.1 }))
    const env = makeEnv()

    await checkQuotaUsage(env, NOW)

    expect(alerts(env)).toEqual([
      {
        blobs: ['cloudflare_quota_alert', 'd1_rows_written', '50', '2026-11-13'],
        doubles: [60_000, 100_000, 60],
      },
    ])
  })

  it('85% grava só o alerta de 80%, sem repetir o de 50%', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubGraphql(usageAt({ read: 0.85, written: 0.1, requests: 0.1 }))
    const env = makeEnv()

    await checkQuotaUsage(env, NOW)

    expect(alerts(env)).toEqual([
      {
        blobs: ['cloudflare_quota_alert', 'd1_rows_read', '80', '2026-11-13'],
        doubles: [4_250_000, 5_000_000, 85],
      },
    ])
  })

  it('grava um alerta por métrica acima de uma faixa', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubGraphql(usageAt({ read: 0.6, written: 0.2, requests: 0.9 }))
    const env = makeEnv()

    await checkQuotaUsage(env, NOW)

    expect(alerts(env).map((e) => e.blobs?.slice(1, 3))).toEqual([
      ['d1_rows_read', '50'],
      ['worker_requests', '80'],
    ])
  })

  it.each(['CF_ANALYTICS_TOKEN', 'CF_ACCOUNT_ID'] as const)(
    'sem %s avisa configuração ausente, não consulta e não lança',
    async (name) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const fetchFake = stubGraphql(usageAt({ read: 0.9 }))
      const env = makeEnv({ [name]: undefined })

      await expect(checkQuotaUsage(env, NOW)).resolves.toBe('config_missing')

      expect(fetchFake).not.toHaveBeenCalled()
      expect(events(env)).toEqual([])
      expect(warn).toHaveBeenCalledWith(
        `[cota] Configuração ausente: ${name}. Medição do dia pulada.`,
      )
    },
  )

  it('resposta não 200 registra a falha sem lançar e sem gravar medição', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubGraphql({ errors: [{ message: 'Authentication error' }] }, 403)
    const env = makeEnv()

    await expect(checkQuotaUsage(env, NOW)).resolves.toBe('error')

    const recorded = events(env)
    expect(recorded).toHaveLength(1)
    expect(recorded[0].blobs?.slice(0, 2)).toEqual(['cloudflare_usage_error', '2026-11-13'])
    expect(recorded[0].blobs?.[2]).toContain('GraphQL respondeu 403')
  })

  it('erro GraphQL com status 200 registra a falha sem lançar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubGraphql({ data: null, errors: [{ message: 'unknown field rowsRead' }] })
    const env = makeEnv()

    await expect(checkQuotaUsage(env, NOW)).resolves.toBe('error')

    expect(events(env).map((e) => e.blobs)).toEqual([
      [
        'cloudflare_usage_error',
        '2026-11-13',
        'GraphQL respondeu com erro: unknown field rowsRead',
      ],
    ])
  })

  it('valor negativo ou não numérico no GraphQL vira falha registrada, sem medição', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const body = usageAt({ read: 0.1 })
    body.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups[0].sum.rowsRead = -1
    stubGraphql(body)
    const env = makeEnv()

    await expect(checkQuotaUsage(env, NOW)).resolves.toBe('error')
    expect(events(env).map((e) => e.blobs?.[0])).toEqual(['cloudflare_usage_error'])

    const nan = usageAt({ read: 0.1 }) as {
      data: {
        viewer: { accounts: { workersInvocationsAdaptive: { sum: { requests: unknown } }[] }[] }
      }
    }
    nan.data.viewer.accounts[0].workersInvocationsAdaptive[0].sum.requests = 'NaN'
    stubGraphql(nan)
    const env2 = makeEnv()
    await expect(checkQuotaUsage(env2, NOW)).resolves.toBe('error')
    expect(events(env2).map((e) => e.blobs?.[0])).toEqual(['cloudflare_usage_error'])
  })

  it('falha ao gravar o evento de erro não faz o passo lançar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubGraphql({}, 500)
    const env = makeEnv()
    vi.mocked((env.AE as AnalyticsEngineDataset).writeDataPoint).mockImplementation(() => {
      throw new Error('AE indisponível')
    })

    await expect(checkQuotaUsage(env, NOW)).resolves.toBe('error')
  })

  it('falha de rede registra a falha sem lançar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    const env = makeEnv()

    await expect(checkQuotaUsage(env, NOW)).resolves.toBe('error')

    expect(events(env).map((e) => e.blobs?.[0])).toEqual(['cloudflare_usage_error'])
  })

  it('a mensagem de erro não leva o token', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubGraphql({ errors: [{ message: 'denied' }] }, 401)
    const env = makeEnv()

    await checkQuotaUsage(env, NOW)

    const logged = JSON.stringify([events(env), error.mock.calls.map(String)])
    expect(logged).not.toContain('token-analytics')
  })
})
