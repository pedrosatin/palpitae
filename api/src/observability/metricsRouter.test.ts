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

  it('happy path: 14 queries, janela aplicada em todas e shape esperado', async () => {
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
      latency: unknown[]
      predictionsDaily: unknown[]
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
    expect(body.latency).toHaveLength(1)
    expect(body.predictionsDaily).toHaveLength(1)

    expect(fetchFake).toHaveBeenCalledTimes(14)
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

/** D1 fake que despacha por trecho do SQL — evita depender de driver real. */
function makeD1(rows: {
  usersInGroup?: number
  usersWhoPredicted?: number
  usersTotal?: number
  usersCreated?: number
  groupsCreated?: number
  membership?: { user_id: string; groups: number }[]
  topCompetitions?: { competition: string; groups: number }[]
}): D1Database {
  const membership = rows.membership ?? []
  const topCompetitions = rows.topCompetitions ?? []

  function resultFor(sql: string) {
    if (sql.includes('FROM group_members gm')) return { results: membership }
    if (sql.includes('FROM groups g JOIN competitions')) return { results: topCompetitions }
    if (sql.includes('FROM group_members')) return { n: rows.usersInGroup ?? 0 }
    if (sql.includes('FROM predictions')) return { n: rows.usersWhoPredicted ?? 0 }
    if (sql.includes('FROM users WHERE')) return { n: rows.usersCreated ?? 0 }
    if (sql.includes('FROM users')) return { n: rows.usersTotal ?? 0 }
    if (sql.includes('FROM groups WHERE')) return { n: rows.groupsCreated ?? 0 }
    throw new Error(`SQL não mapeado no fake: ${sql}`)
  }

  return {
    prepare: (sql: string) => {
      const stmt = {
        bind: () => stmt,
        first: async () => resultFor(sql),
        all: async () => resultFor(sql),
      }
      return stmt
    },
  } as unknown as D1Database
}

describe('GET /metrics/business', () => {
  it('401 sem sessão', async () => {
    const res = await makeApp().request('/metrics/business', {}, makeEnv({ DB: makeD1({}) }))
    expect(res.status).toBe(401)
  })

  it('403 para usuário que não é o admin', async () => {
    const res = await makeApp().request(
      '/metrics/business',
      { headers: await authHeaders('outra@pessoa.com') },
      makeEnv({ DB: makeD1({}) }),
    )
    expect(res.status).toBe(403)
  })

  it('happy path: KPIs do D1 e média/mediana de grupos por usuário', async () => {
    const db = makeD1({
      usersInGroup: 12,
      usersWhoPredicted: 9,
      usersTotal: 20,
      usersCreated: 3,
      groupsCreated: 2,
      membership: [
        { user_id: 'u1', groups: 1 },
        { user_id: 'u2', groups: 2 },
        { user_id: 'u3', groups: 3 },
      ],
      topCompetitions: [{ competition: 'Brasileirão', groups: 5 }],
    })

    const res = await makeApp().request(
      '/metrics/business?days=7',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ DB: db }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      days: number
      usersTotal: number
      usersInGroup: number
      usersWhoPredicted: number
      usersCreatedInPeriod: number
      groupsCreatedInPeriod: number
      avgGroupsPerUser: number
      medianGroupsPerUser: number
      topCompetitions: { competition: string; groups: number }[]
    }
    expect(body).toEqual({
      days: 7,
      usersTotal: 20,
      usersInGroup: 12,
      usersWhoPredicted: 9,
      usersCreatedInPeriod: 3,
      groupsCreatedInPeriod: 2,
      avgGroupsPerUser: 2,
      medianGroupsPerUser: 2,
      topCompetitions: [{ competition: 'Brasileirão', groups: 5 }],
    })
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

describe('GET /metrics/archive/query', () => {
  function ndjson(...rows: Record<string, unknown>[]): string {
    return `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`
  }

  it('agrega o corpo dos NDJSON por tipo e por dia, ponderando pelo sampling', async () => {
    const files: Record<string, string> = {
      'events/2026/05/01.ndjson': ndjson(
        { blob1: 'login_success', _sample_interval: 1 },
        { blob1: 'prediction_saved', _sample_interval: 3 }, // vale 3 eventos
      ),
      'events/2026/05/02.ndjson': ndjson({ blob1: 'login_success', _sample_interval: 1 }),
    }
    const get = vi.fn(async (key: string) => (files[key] ? { text: async () => files[key] } : null))
    const res = await makeApp().request(
      '/metrics/archive/query?from=2026-05-01&to=2026-05-02',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ EVENTS: { get } as unknown as R2Bucket }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      filesRead: number
      totalEvents: number
      byType: { event_type: string; count: number }[]
      byDay: { day: string; count: number }[]
    }
    expect(body.filesRead).toBe(2)
    expect(body.totalEvents).toBe(5) // 1 + 3 + 1
    // Ordenado por contagem desc: prediction_saved (3) antes de login_success (2).
    expect(body.byType).toEqual([
      { event_type: 'prediction_saved', count: 3 },
      { event_type: 'login_success', count: 2 },
    ])
    expect(body.byDay).toEqual([
      { day: '2026-05-01', count: 4 },
      { day: '2026-05-02', count: 1 },
    ])
  })

  it('400 para from/to inválidos ou invertidos', async () => {
    const headers = await authHeaders(ADMIN)
    const env = makeEnv({ EVENTS: {} as unknown as R2Bucket })

    let res = await makeApp().request(
      '/metrics/archive/query?from=xx&to=2026-05-02',
      { headers },
      env,
    )
    expect(res.status).toBe(400)

    res = await makeApp().request(
      '/metrics/archive/query?from=2026-05-05&to=2026-05-01',
      { headers },
      env,
    )
    expect(res.status).toBe(400)
  })

  it('400 quando o intervalo excede o teto', async () => {
    const res = await makeApp().request(
      '/metrics/archive/query?from=2026-01-01&to=2026-12-31',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ EVENTS: {} as unknown as R2Bucket }),
    )
    expect(res.status).toBe(400)
  })

  it('503 sem bucket configurado', async () => {
    const res = await makeApp().request(
      '/metrics/archive/query?from=2026-05-01&to=2026-05-02',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ EVENTS: undefined }),
    )
    expect(res.status).toBe(503)
  })
})
