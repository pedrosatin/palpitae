import type { D1Database } from '@cloudflare/workers-types'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import { metricsRouter } from '../observability/metricsRouter'
import type { AppContext, Env } from '../types'

const JWT_SECRET = 'test-secret-radar-router'
const ADMIN = 'admin@palpitae.com.br'
const TODAY = '2026-08-18'

function makeApp() {
  const app = new Hono<AppContext>()
  app.route('/metrics', metricsRouter)
  return app
}

function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return { JWT_SECRET, ADMIN_EMAIL: ADMIN, DB: db, ...overrides } as unknown as Env
}

async function authHeaders(email: string) {
  const token = await signJwt({ sub: 'user-1', email }, JWT_SECRET, 3600)
  return { Cookie: `session=${token}` }
}

type Competition = {
  id: string
  name: string
  country: string | null
  type: string | null
  logo_url: string | null
  season: string
  starts_on: string | null
  ends_on: string | null
  wiki_article: string | null
}

type Daily = { radar_id: string; day: string; matches_today: number; pageviews: number | null }

/** D1 fake que despacha por trecho do SQL — mesmo padrão do metricsRouter. */
function makeD1(rows: {
  competitions?: Competition[]
  daily?: Daily[]
  groups?: { slug: string; groups: number }[]
  lastSync?: string | null
}): D1Database {
  function resultFor(sql: string) {
    if (sql.includes('FROM competition_radar_daily')) return { results: rows.daily ?? [] }
    if (sql.includes('MAX(last_seen_at)')) return { last_sync: rows.lastSync ?? null }
    if (sql.includes('FROM competition_radar')) return { results: rows.competitions ?? [] }
    if (sql.includes('FROM groups g JOIN competitions')) return { results: rows.groups ?? [] }
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

function competition(over: Partial<Competition> = {}): Competition {
  return {
    id: 'api-football:13:2026',
    name: 'CONMEBOL Libertadores',
    country: 'World',
    type: 'Cup',
    logo_url: null,
    season: '2026',
    starts_on: '2026-02-04',
    ends_on: '2026-11-28',
    wiki_article: 'Copa Libertadores da América',
    ...over,
  }
}

/**
 * Série diária terminando em TODAY (uma linha por dia, como a PK do D1 garante).
 * `matchesOnLastDay` cai no dia de hoje — é o "está rolando agora".
 */
function series(radarId: string, values: number[], matchesOnLastDay = 0): Daily[] {
  const end = new Date(`${TODAY}T00:00:00Z`)
  return values.map((views, i) => {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - (values.length - 1 - i))
    return {
      radar_id: radarId,
      day: d.toISOString().slice(0, 10),
      matches_today: i === values.length - 1 ? matchesOnLastDay : 0,
      pageviews: views,
    }
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /metrics/radar', () => {
  it('401 sem sessão', async () => {
    const res = await makeApp().request('/metrics/radar', {}, makeEnv(makeD1({})))
    expect(res.status).toBe(401)
  })

  it('403 para usuário que não é o admin', async () => {
    const res = await makeApp().request(
      '/metrics/radar',
      { headers: await authHeaders('outra@pessoa.com') },
      makeEnv(makeD1({})),
    )
    expect(res.status).toBe(403)
  })

  it('agrega média de pageviews, jogos e demanda interna', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))

    const db = makeD1({
      competitions: [
        competition(),
        competition({
          id: 'api-football:71:2026',
          name: 'Serie A',
          country: 'Brazil',
          type: 'League',
          wiki_article: 'Campeonato Brasileiro de Futebol',
        }),
      ],
      daily: [
        ...series('api-football:13:2026', [900, 1100, 1000], 4),
        ...series('api-football:71:2026', [800]),
      ],
      groups: [{ slug: 'campeonato-brasileiro-serie-a-2026', groups: 7 }],
    })

    const res = await makeApp().request(
      '/metrics/radar',
      { headers: await authHeaders(ADMIN) },
      makeEnv(db),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      days: number
      items: {
        name: string
        status: string
        pageviewsAvg: number | null
        matchesToday: number
        supported: boolean
        internalGroups: number
      }[]
    }

    expect(body.days).toBe(30)
    const liberta = body.items.find((i) => i.name === 'CONMEBOL Libertadores')
    expect(liberta?.pageviewsAvg).toBe(1000) // (900 + 1100 + 1000) / 3
    expect(liberta?.matchesToday).toBe(4)
    // Libertadores não é suportada hoje — é exatamente o caso de uso da tela.
    expect(liberta?.supported).toBe(false)
    expect(liberta?.internalGroups).toBe(0)

    const brasileirao = body.items.find((i) => i.name === 'Serie A')
    expect(brasileirao?.supported).toBe(true)
    expect(brasileirao?.internalGroups).toBe(7)
    expect(brasileirao?.status).toBe('ongoing')
  })

  it('ordena por interesse e joga competição sem sinal pro fim', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))

    const db = makeD1({
      competitions: [
        competition({ id: 'a', name: 'Sem artigo', wiki_article: null }),
        competition({ id: 'b', name: 'Pouco interesse' }),
        competition({ id: 'c', name: 'Muito interesse' }),
      ],
      daily: [...series('b', [100]), ...series('c', [5000])],
    })

    const res = await makeApp().request(
      '/metrics/radar',
      { headers: await authHeaders(ADMIN) },
      makeEnv(db),
    )
    const body = (await res.json()) as { items: { name: string }[] }

    expect(body.items.map((i) => i.name)).toEqual([
      'Muito interesse',
      'Pouco interesse',
      'Sem artigo',
    ])
  })

  it('calcula tendência comparando as duas últimas semanas', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))

    const db = makeD1({
      competitions: [competition()],
      // 7 dias a 100, depois 7 dias a 150 → +50%.
      daily: series('api-football:13:2026', [...Array(7).fill(100), ...Array(7).fill(150)]),
    })

    const res = await makeApp().request(
      '/metrics/radar',
      { headers: await authHeaders(ADMIN) },
      makeEnv(db),
    )
    const body = (await res.json()) as { items: { pageviewsTrend: number | null }[] }

    expect(body.items[0].pageviewsTrend).toBe(50)
  })

  it('não inventa tendência sem duas semanas de dados', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))

    const db = makeD1({
      competitions: [competition()],
      daily: series('api-football:13:2026', [100, 150, 200]),
    })

    const res = await makeApp().request(
      '/metrics/radar',
      { headers: await authHeaders(ADMIN) },
      makeEnv(db),
    )
    const body = (await res.json()) as { items: { pageviewsTrend: number | null }[] }

    expect(body.items[0].pageviewsTrend).toBeNull()
  })

  it('deriva o status da janela da temporada', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))

    const db = makeD1({
      competitions: [
        competition({ id: 'a', name: 'Futura', starts_on: '2026-12-01', ends_on: '2027-06-01' }),
        competition({ id: 'b', name: 'Encerrada', starts_on: '2025-01-01', ends_on: '2025-12-01' }),
      ],
    })

    const res = await makeApp().request(
      '/metrics/radar',
      { headers: await authHeaders(ADMIN) },
      makeEnv(db),
    )
    const body = (await res.json()) as { items: { name: string; status: string }[] }

    expect(body.items.find((i) => i.name === 'Futura')?.status).toBe('upcoming')
    expect(body.items.find((i) => i.name === 'Encerrada')?.status).toBe('finished')
  })
})
