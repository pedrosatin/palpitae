import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import { metricsRouter } from './metricsRouter'
import type { AppContext, Env } from '../types'

const JWT_SECRET = 'test-secret-metrics-router'
const ADMIN = 'admin@palpitae.com.br'

function makeApp() {
  const app = new Hono<AppContext>()
  app.route('/metrics', metricsRouter)
  return app
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    JWT_SECRET,
    ADMIN_EMAIL: ADMIN,
    CF_ACCOUNT_ID: 'acct',
    AE_SQL_TOKEN: 'tok',
    ...overrides,
  } as unknown as Env
}

async function authHeaders(email: string) {
  const token = await signJwt({ sub: 'user-1', email }, JWT_SECRET, 3600)
  return { Cookie: `session=${token}` }
}

function fetchOk(data: unknown[]) {
  return vi.fn(async () => ({ ok: true, json: async () => ({ data }) }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /metrics/overview', () => {
  it('401 sem sessão', async () => {
    const res = await makeApp().request('/metrics/overview', {}, makeEnv())
    expect(res.status).toBe(401)
  })

  it('403 para usuário que não é o admin', async () => {
    const res = await makeApp().request(
      '/metrics/overview',
      { headers: await authHeaders('outra@pessoa.com') },
      makeEnv(),
    )
    expect(res.status).toBe(403)
  })

  it('aceita o admin com casing diferente do secret', async () => {
    vi.stubGlobal('fetch', fetchOk([]))
    const res = await makeApp().request(
      '/metrics/overview',
      { headers: await authHeaders('Admin@Palpitae.com.BR') },
      makeEnv(),
    )
    expect(res.status).toBe(200)
  })

  it('403 quando ADMIN_EMAIL não está configurado (fechado por padrão)', async () => {
    const res = await makeApp().request(
      '/metrics/overview',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ ADMIN_EMAIL: undefined }),
    )
    expect(res.status).toBe(403)
  })

  it('503 sem credenciais da SQL API', async () => {
    const res = await makeApp().request(
      '/metrics/overview',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ AE_SQL_TOKEN: undefined }),
    )
    expect(res.status).toBe(503)
  })

  it('happy path: 12 queries, janela aplicada em todas e shape esperado', async () => {
    const fetchFake = fetchOk([{ event_type: 'login_success', count: '3' }])
    vi.stubGlobal('fetch', fetchFake)

    const res = await makeApp().request(
      '/metrics/overview?days=7',
      { headers: await authHeaders(ADMIN) },
      makeEnv(),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      days: number
      totals: unknown[]
      daily: unknown[]
      poller: unknown[]
      predictions: unknown
      cache: unknown[]
      loginFailures: unknown[]
      apiCallsDaily: unknown[]
      recentErrors: unknown[]
      sampling: unknown
      whales: unknown[]
      lastRuns: unknown[]
      emailHealth: unknown
    }
    expect(body.days).toBe(7)
    expect(body.totals).toHaveLength(1)
    expect(body.predictions).toBeTruthy()
    expect(body.cache).toHaveLength(1)
    expect(body.recentErrors).toHaveLength(1)
    expect(body.sampling).toBeTruthy()
    expect(body.whales).toHaveLength(1)
    expect(body.lastRuns).toHaveLength(1)
    expect(body.emailHealth).toBeTruthy()

    expect(fetchFake).toHaveBeenCalledTimes(12)
    const bodies = (fetchFake.mock.calls as unknown as [string, { body: string }][]).map(
      (call) => call[1].body,
    )
    for (const sql of bodies) {
      expect(sql).toContain("INTERVAL '7' DAY")
    }
    // Sob sampling cada linha vale _sample_interval linhas reais — contagens
    // somam esse peso (nunca COUNT(*)) e medidas multiplicam por ele.
    const counting = bodies.filter((sql) => sql.includes('SUM(_sample_interval)'))
    expect(counting.length).toBeGreaterThanOrEqual(5)
    expect(bodies.some((sql) => sql.includes('SUM(double1 * _sample_interval)'))).toBe(true)
    expect(bodies.some((sql) => sql.includes('SUM(double3 * _sample_interval)'))).toBe(true)
  })

  it('predictions vira objeto vazio-padrão quando a query não retorna linha', async () => {
    vi.stubGlobal('fetch', fetchOk([]))

    const res = await makeApp().request(
      '/metrics/overview',
      { headers: await authHeaders(ADMIN) },
      makeEnv(),
    )

    const body = (await res.json()) as {
      predictions: { active_users: number; total: number }
      sampling: { avg_sample_interval: number }
      emailHealth: { rounds: number; sent: number; failed: number }
    }
    expect(body.predictions).toEqual({ active_users: 0, total: 0 })
    expect(body.sampling).toEqual({ avg_sample_interval: 1 })
    expect(body.emailHealth).toEqual({ rounds: 0, sent: 0, failed: 0 })
  })

  it('sanea days inválido/excessivo (default 30, teto 90)', async () => {
    const fetchFake = fetchOk([])
    vi.stubGlobal('fetch', fetchFake)
    const headers = await authHeaders(ADMIN)

    let res = await makeApp().request('/metrics/overview?days=abc', { headers }, makeEnv())
    expect(((await res.json()) as { days: number }).days).toBe(30)

    res = await makeApp().request('/metrics/overview?days=5000', { headers }, makeEnv())
    expect(((await res.json()) as { days: number }).days).toBe(90)
  })

  it('502 quando a SQL API falha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' })),
    )
    const res = await makeApp().request(
      '/metrics/overview',
      { headers: await authHeaders(ADMIN) },
      makeEnv(),
    )
    expect(res.status).toBe(502)
  })
})

describe('GET /metrics/archive', () => {
  it('lista os NDJSON do mês corrente e do anterior (não events/ inteiro)', async () => {
    // Um arquivo por prefixo pedido — independe da data em que o teste roda.
    const list = vi.fn(async ({ prefix }: { prefix: string }) => ({
      objects: [{ key: `${prefix}15.ndjson`, size: 123, uploaded: new Date('2026-06-30T00:05:00Z') }],
      truncated: false,
    }))
    const res = await makeApp().request(
      '/metrics/archive',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ EVENTS: { list } as unknown as R2Bucket }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { files: { key: string; size: number }[] }

    // Prefixos relativos à data real: mês corrente + anterior (UTC).
    const monthPrefix = (back: number) => {
      const now = new Date()
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
      return `events/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/`
    }
    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenCalledWith({ prefix: monthPrefix(0), limit: 1000 })
    expect(list).toHaveBeenCalledWith({ prefix: monthPrefix(1), limit: 1000 })
    expect(body.files).toHaveLength(2)
    expect(body.files[0]).toMatchObject({ size: 123 })
  })

  it('503 sem bucket configurado', async () => {
    const res = await makeApp().request(
      '/metrics/archive',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ EVENTS: undefined }),
    )
    expect(res.status).toBe(503)
  })
})

describe('GET /metrics/history', () => {
  const SUMMARY_KEY = 'summaries/daily-v1.json'

  /** Bucket fake: NDJSON por chave + resumo opcional; grava puts em memória. */
  function fakeBucket(files: Record<string, string>, summaryJson?: unknown) {
    const puts: Record<string, string> = {}
    return {
      puts,
      bucket: {
        list: vi.fn(async () => ({
          objects: Object.keys(files).map((key) => ({ key, size: 1, uploaded: new Date() })),
          truncated: false,
        })),
        get: vi.fn(async (key: string) => {
          if (key === SUMMARY_KEY) {
            return summaryJson === undefined ? null : { json: async () => summaryJson }
          }
          return key in files ? { text: async () => files[key] } : null
        }),
        put: vi.fn(async (key: string, value: string) => {
          puts[key] = value
        }),
      } as unknown as R2Bucket,
    }
  }

  const ndjsonLine = (blob1: string, sample = 1, double1 = 0) =>
    JSON.stringify({ blob1, _sample_interval: sample, double1 })

  it('503 sem bucket configurado', async () => {
    const res = await makeApp().request(
      '/metrics/history',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ EVENTS: undefined }),
    )
    expect(res.status).toBe(503)
  })

  it('parseia NDJSON com peso de sampling, cacheia o resumo e ordena os dias', async () => {
    const { bucket, puts } = fakeBucket({
      // Dia com sampling (peso 2) + palpite em lote (double1 = 3)
      'events/2026/06/22.ndjson': [
        ndjsonLine('login_success', 2),
        ndjsonLine('prediction_saved', 2, 3),
        'linha corrompida{{{',
      ].join('\n'),
      'events/2026/06/21.ndjson': ndjsonLine('group_created'),
    })

    const res = await makeApp().request(
      '/metrics/history',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ EVENTS: bucket }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      days: { day: string; events: Record<string, number>; predictions: number }[]
      pending: number
    }
    expect(body.pending).toBe(0)
    expect(body.days.map((d) => d.day)).toEqual(['2026-06-21', '2026-06-22'])
    expect(body.days[1].events).toEqual({ login_success: 2, prediction_saved: 2 })
    expect(body.days[1].predictions).toBe(6) // 3 palpites × peso 2
    // Resumo persistido pro próximo request não re-parsear
    expect(JSON.parse(puts[SUMMARY_KEY]).days['2026-06-21']).toBeTruthy()
  })

  it('dia já resumido não é re-parseado nem re-gravado', async () => {
    const cached = {
      days: { '2026-06-21': { events: { group_created: 1 }, predictions: 0 } },
    }
    const { bucket } = fakeBucket({ 'events/2026/06/21.ndjson': ndjsonLine('group_created') }, cached)

    const res = await makeApp().request(
      '/metrics/history',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ EVENTS: bucket }),
    )

    expect(res.status).toBe(200)
    const get = (bucket as unknown as { get: ReturnType<typeof vi.fn> }).get
    const put = (bucket as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(get).toHaveBeenCalledTimes(1) // só o resumo — nunca o NDJSON
    expect(put).not.toHaveBeenCalled()
  })

  it('limita o parse por request e reporta o backlog em pending', async () => {
    const files: Record<string, string> = {}
    for (let d = 1; d <= 35; d++) {
      files[`events/2026/05/${String(d).padStart(2, '0')}.ndjson`] = ndjsonLine('login_success')
    }
    const { bucket } = fakeBucket(files)

    const res = await makeApp().request(
      '/metrics/history',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ EVENTS: bucket }),
    )

    const body = (await res.json()) as { days: unknown[]; pending: number }
    expect(body.days).toHaveLength(30)
    expect(body.pending).toBe(5)
  })
})
