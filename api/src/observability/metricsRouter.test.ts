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
  it('lista events/ inteiro paginando por cursor, com a contagem do customMetadata', async () => {
    // 1ª página truncada + 2ª final — o handler precisa seguir o cursor.
    const pages = [
      {
        objects: [
          {
            key: 'events/2026/05/01.ndjson',
            size: 123,
            uploaded: new Date('2026-05-02T00:05:00Z'),
            customMetadata: { events: '42' },
          },
        ],
        truncated: true,
        cursor: 'cur-1',
      },
      {
        objects: [
          {
            // Export antigo, sem metadata — events deve virar null.
            key: 'events/2026/05/02.ndjson',
            size: 456,
            uploaded: new Date('2026-05-03T00:05:00Z'),
          },
        ],
        truncated: false,
      },
    ]
    const list = vi.fn(async () => pages.shift())
    const res = await makeApp().request(
      '/metrics/archive',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ EVENTS: { list } as unknown as R2Bucket }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      files: { key: string; size: number; events: number | null }[]
    }

    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenNthCalledWith(1, {
      prefix: 'events/',
      limit: 1000,
      cursor: undefined,
    })
    expect(list).toHaveBeenNthCalledWith(2, {
      prefix: 'events/',
      limit: 1000,
      cursor: 'cur-1',
    })
    expect(body.files).toHaveLength(2)
    expect(body.files[0]).toMatchObject({
      key: 'events/2026/05/01.ndjson',
      size: 123,
      events: 42,
    })
    expect(body.files[1]).toMatchObject({
      key: 'events/2026/05/02.ndjson',
      size: 456,
      events: null,
    })
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
