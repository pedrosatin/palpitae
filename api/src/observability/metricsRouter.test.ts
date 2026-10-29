/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
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
    DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as unknown as D1Database,
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

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
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

/**
 * Fixture em SQLite real (migrations aplicadas), relógio do próprio SQLite:
 * datas relativas a datetime('now') no formato ISO com "Z" que o app grava.
 *
 * Brasileirão aparece em duas temporadas com o MESMO nome (2026 e 2025) para
 * provar que a lista não agrupa só por nome. Bob está em dois grupos do 2026
 * (membros distintos, não memberships). O grupo excluído tem membro e palpite
 * recente que não podem vazar em nenhuma contagem.
 */
function createBusinessFixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const ago = (days: number) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${days} days')`

  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id, user_name, created_at) VALUES
      ('alice', 'alice@example.com', 'google', 'g-alice', 'Alice', datetime('now', '-100 days')),
      ('bob', 'bob@example.com', 'google', 'g-bob', 'Bob', datetime('now', '-100 days')),
      ('carol', 'carol@example.com', 'google', 'g-carol', 'Carol', datetime('now', '-3 days')),
      ('dave', 'dave@example.com', 'google', 'g-dave', 'Dave', datetime('now', '-100 days')),
      ('erin', 'erin@example.com', 'google', 'g-erin', 'Erin', datetime('now', '-100 days'));

    DELETE FROM competitions;

    INSERT INTO competitions (id, name, slug, provider, season, status, type, visibility) VALUES
      ('comp-br26', 'Brasileirão Série A', 'brasileirao-2026', 'football-data', '2026', 'ongoing', 'league', 'public'),
      ('comp-br25', 'Brasileirão Série A', 'brasileirao-2025', 'football-data', '2025', 'finished', 'league', 'public'),
      ('comp-pilot', 'Liga Piloto', 'liga-piloto-2026', 'espn', '2026', 'ongoing', 'league', 'pilot'),
      ('comp-empty', 'Copa Vazia', 'copa-vazia-2026', 'espn', '2026', 'upcoming', 'cup', 'pilot');

    INSERT INTO teams (id, name, short_name, slug) VALUES
      ('fla', 'Flamengo', 'FLA', 'flamengo'),
      ('pal', 'Palmeiras', 'PAL', 'palmeiras');

    INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status) VALUES
      ('m-br26-1', 'comp-br26', 'fd-1', 'football-data', 'fla', 'pal', '2026-06-01T19:00:00Z', 'finished'),
      ('m-br26-2', 'comp-br26', 'fd-2', 'football-data', 'pal', 'fla', '2026-06-08T19:00:00Z', 'finished'),
      ('m-br25-1', 'comp-br25', 'fd-3', 'football-data', 'fla', 'pal', '2025-06-01T19:00:00Z', 'finished'),
      ('m-pilot-1', 'comp-pilot', 'espn-1', 'espn', 'fla', 'pal', '2026-06-01T19:00:00Z', 'finished');

    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code, created_at, deleted_at) VALUES
      ('g-br26-a', 'Bolão da Firma', 'comp-br26', 'alice', 'SECRET-AAAA', datetime('now', '-60 days'), NULL),
      ('g-br26-b', 'Bolão da Família', 'comp-br26', 'bob', 'SECRET-BBBB', datetime('now', '-2 days'), NULL),
      ('g-br26-del', 'Bolão Apagado', 'comp-br26', 'dave', 'SECRET-DDDD', datetime('now', '-2 days'), datetime('now', '-1 days')),
      ('g-br25', 'Bolão Antigo', 'comp-br25', 'alice', 'SECRET-OLD1', datetime('now', '-300 days'), NULL),
      ('g-pilot', 'Bolão Piloto', 'comp-pilot', 'carol', 'SECRET-PPPP', datetime('now', '-20 days'), NULL),
      ('g-pilot-del', 'Piloto Apagado', 'comp-pilot', 'erin', 'SECRET-EEEE', datetime('now', '-20 days'), datetime('now', '-5 days'));

    INSERT INTO group_members (id, group_id, user_id) VALUES
      ('gm-1', 'g-br26-a', 'alice'),
      ('gm-2', 'g-br26-a', 'bob'),
      ('gm-3', 'g-br26-b', 'bob'),
      ('gm-4', 'g-br26-b', 'carol'),
      ('gm-5', 'g-br26-del', 'dave'),
      ('gm-6', 'g-br25', 'alice'),
      ('gm-7', 'g-pilot', 'carol'),
      ('gm-8', 'g-pilot-del', 'erin');

    INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, created_at, updated_at) VALUES
      -- g-br26-a: dois usuários e dois jogos recentes — continua 1 grupo ativo.
      ('p-1', 'alice', 'g-br26-a', 'm-br26-1', 1, 0, ${ago(30)}, ${ago(2)}),
      ('p-2', 'alice', 'g-br26-a', 'm-br26-2', 2, 0, ${ago(3)}, ${ago(3)}),
      ('p-3', 'bob', 'g-br26-a', 'm-br26-1', 0, 0, ${ago(1)}, ${ago(1)}),
      -- g-br26-b: último palpite há 15 dias — fora da janela de 14d.
      ('p-4', 'bob', 'g-br26-b', 'm-br26-1', 3, 1, ${ago(15)}, ${ago(15)}),
      -- Grupos excluídos com palpite recente: não contam em nada.
      ('p-5', 'dave', 'g-br26-del', 'm-br26-1', 1, 1, ${ago(1)}, ${ago(1)}),
      ('p-6', 'erin', 'g-pilot-del', 'm-pilot-1', 1, 1, ${ago(1)}, ${ago(1)}),
      ('p-7', 'alice', 'g-br25', 'm-br25-1', 2, 2, ${ago(200)}, ${ago(200)}),
      -- g-pilot: dentro da janela por pouco (13 dias).
      ('p-8', 'carol', 'g-pilot', 'm-pilot-1', 0, 1, ${ago(13)}, ${ago(13)});
  `)
  return db
}

interface CompetitionRow {
  id: string
  name: string
  slug: string
  season: string | null
  provider: string | null
  visibility: string
  status: string
  groups_current: number
  members: number
  active_groups_14d: number
}

describe('GET /metrics/business', () => {
  it('401 sem sessão', async () => {
    const res = await makeApp().request(
      '/metrics/business',
      {},
      makeEnv({ DB: createBusinessFixture() }),
    )
    expect(res.status).toBe(401)
  })

  it('403 para usuário que não é o admin', async () => {
    const res = await makeApp().request(
      '/metrics/business',
      { headers: await authHeaders('outra@pessoa.com') },
      makeEnv({ DB: createBusinessFixture() }),
    )
    expect(res.status).toBe(403)
  })

  it('KPIs do D1 ignoram grupos soft-deleted', async () => {
    const res = await makeApp().request(
      '/metrics/business?days=7',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ DB: createBusinessFixture() }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      days: 7,
      usersTotal: 5,
      // dave e erin só estão (e só palpitaram) em grupos excluídos.
      usersInGroup: 3,
      usersWhoPredicted: 3,
      usersCreatedInPeriod: 1,
      // g-br26-b; g-br26-del também é recente, mas está excluído.
      groupsCreatedInPeriod: 1,
      // alice 2, bob 2, carol 2 grupos não excluídos.
      avgGroupsPerUser: 2,
      medianGroupsPerUser: 2,
      activeGroupDays: 14,
    })
  })

  it('lista todas as temporadas, inclusive sem grupo, sem multiplicar contagens', async () => {
    const res = await makeApp().request(
      '/metrics/business',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ DB: createBusinessFixture() }),
    )

    const body = (await res.json()) as {
      competitions: CompetitionRow[]
      topCompetitions: { competition: string; groups: number }[]
    }
    expect(body.competitions).toEqual([
      {
        id: 'comp-br26',
        name: 'Brasileirão Série A',
        slug: 'brasileirao-2026',
        season: '2026',
        provider: 'football-data',
        visibility: 'public',
        status: 'ongoing',
        groups_current: 2,
        members: 3,
        active_groups_14d: 1,
      },
      {
        id: 'comp-br25',
        name: 'Brasileirão Série A',
        slug: 'brasileirao-2025',
        season: '2025',
        provider: 'football-data',
        visibility: 'public',
        status: 'finished',
        groups_current: 1,
        members: 1,
        active_groups_14d: 0,
      },
      {
        id: 'comp-pilot',
        name: 'Liga Piloto',
        slug: 'liga-piloto-2026',
        season: '2026',
        provider: 'espn',
        visibility: 'pilot',
        status: 'ongoing',
        groups_current: 1,
        members: 1,
        active_groups_14d: 1,
      },
      {
        id: 'comp-empty',
        name: 'Copa Vazia',
        slug: 'copa-vazia-2026',
        season: '2026',
        provider: 'espn',
        visibility: 'pilot',
        status: 'upcoming',
        groups_current: 0,
        members: 0,
        active_groups_14d: 0,
      },
    ])
    // Formato legado para o front ainda não atualizado: só quem tem grupo.
    expect(body.topCompetitions).toEqual([
      { competition: 'Brasileirão Série A', groups: 2 },
      { competition: 'Brasileirão Série A', groups: 1 },
      { competition: 'Liga Piloto', groups: 1 },
    ])
  })

  it('não expõe e-mails, ids de usuário, nomes de grupo nem convites', async () => {
    const res = await makeApp().request(
      '/metrics/business',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ DB: createBusinessFixture() }),
    )

    const raw = await res.text()
    for (const leaked of ['@example.com', 'alice', 'Bolão', 'SECRET-', 'g-br26-a']) {
      expect(raw).not.toContain(leaked)
    }
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
