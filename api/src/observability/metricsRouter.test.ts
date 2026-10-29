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
function createBusinessFixture(extraSql = '') {
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

    INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, scored_at) VALUES
      ('m-br26-1', 'comp-br26', 'fd-1', 'football-data', 'fla', 'pal', '2026-06-01T19:00:00Z', 'finished', 1, 0, '2026-06-01T21:00:00Z'),
      ('m-br26-2', 'comp-br26', 'fd-2', 'football-data', 'pal', 'fla', '2026-06-08T19:00:00Z', 'finished', 2, 2, '2026-06-08T21:00:00Z'),
      ('m-br25-1', 'comp-br25', 'fd-3', 'football-data', 'fla', 'pal', '2025-06-01T19:00:00Z', 'finished', 0, 1, '2025-06-01T21:00:00Z'),
      ('m-pilot-1', 'comp-pilot', 'espn-1', 'espn', 'fla', 'pal', '2026-06-01T19:00:00Z', 'finished', 3, 1, '2026-06-01T21:00:00Z');

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
  if (extraSql) sqlite.exec(extraSql)
  return db
}

/**
 * Jogos para a saúde de resultados, todos relativos ao relógio do SQLite.
 * Brasileirão 2026 tem grupos, membros e palpites: se a agregação de jogos
 * multiplicasse linhas (ou vice-versa), os números dele sairiam errados.
 * Os horários ficam a 1 min das fronteiras para absorver o tempo do teste.
 */
function healthMatchesSql() {
  const at = (...modifiers: string[]) =>
    `strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ${modifiers.map((m) => `'${m}'`).join(', ')})`
  const row = (
    id: string,
    comp: string,
    start: string,
    status: string,
    extra: { home?: number; away?: number; postponed?: number; scoredAt?: string } = {},
  ) =>
    `('${id}', '${comp}', 'ext-${id}', 'football-data', 'fla', 'pal', ${start}, '${status}', ` +
    `${extra.home ?? 'NULL'}, ${extra.away ?? 'NULL'}, ${extra.postponed ?? 0}, ` +
    `${extra.scoredAt ? `'${extra.scoredAt}'` : 'NULL'})`
  return `
    INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, postponed, scored_at) VALUES
      -- Atrasados contados (br26): scheduled e live, 1 min além das 3h.
      ${row('h-late-sched', 'comp-br26', at('-3 hours', '-1 minutes'), 'scheduled')},
      ${row('h-late-live', 'comp-br26', at('-5 hours'), 'live')},
      -- Placar parcial (só um lado) ainda é jogo sem placar.
      ${row('h-late-partial', 'comp-br26', at('-4 hours'), 'live', { home: 1 })},
      -- start_time com offset -03:00 (4h atrás em UTC) e com milissegundos.
      ${row('h-late-offset', 'comp-br26', `strftime('%Y-%m-%dT%H:%M:%S-03:00', 'now', '-3 hours', '-4 hours')`, 'scheduled')},
      ${row('h-late-ms', 'comp-br26', `strftime('%Y-%m-%dT%H:%M:%S.123Z', 'now', '-6 hours')`, 'scheduled')},
      -- Fora da contagem de atrasados: dentro da janela de 3h, no futuro,
      -- adiado, com placar 0x0 (zero não é ausência) e offset ainda na janela.
      ${row('h-in-window', 'comp-br26', at('-2 hours', '-59 minutes'), 'live')},
      ${row('h-future', 'comp-br26', at('+2 hours'), 'scheduled')},
      ${row('h-postponed', 'comp-br26', at('-5 hours'), 'scheduled', { postponed: 1 })},
      ${row('h-zero-zero', 'comp-br26', at('-5 hours'), 'live', { home: 0, away: 0 })},
      ${row('h-offset-in-window', 'comp-br26', `strftime('%Y-%m-%dT%H:%M:%S-03:00', 'now', '-3 hours', '-2 hours')`, 'scheduled')},
      -- Finished sem scored_at (contados) e com scored_at (não contado).
      ${row('h-fin-unscored-1', 'comp-br26', at('-2 days'), 'finished', { home: 1, away: 0 })},
      ${row('h-fin-unscored-2', 'comp-br26', at('-2 days'), 'finished')},
      ${row('h-fin-scored', 'comp-br26', at('-2 days'), 'finished', { home: 2, away: 0, scoredAt: '2026-06-01T21:00:00Z' })},
      -- Outra temporada com o mesmo nome: contagens separadas por id.
      ${row('h-br25-late', 'comp-br25', at('-1 days'), 'scheduled')},
      ${row('h-br25-unscored', 'comp-br25', at('-1 days'), 'finished', { home: 1, away: 1 })},
      -- Piloto: finished/atrasado só em jogo adiado ou já pontuado.
      ${row('h-pilot-postponed', 'comp-pilot', at('-9 hours'), 'live', { postponed: 1 })};
  `
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
  overdue_no_score: number
  finished_unscored: number
}

describe('GET /metrics/ops', () => {
  const COMP_A = '11111111-2222-4333-8444-555555555555'
  const COMP_B = '66666666-7777-4888-8999-aaaaaaaaaaaa'

  /** Responde cada query da SQL API pela forma do SQL, com linhas fixas. */
  function fetchBySql(rows: {
    httpByProvider?: unknown[]
    httpByCompetition?: unknown[]
    firstSeen?: unknown[]
    apiErrors?: unknown[]
    fallbackRuns?: unknown[]
    fallbackFailures?: unknown[]
  }) {
    return vi.fn(async (_url: string, init: { body: string }) => {
      const sql = init.body
      let data: unknown[] = []
      if (sql.includes('MIN(timestamp)')) data = rows.firstSeen ?? []
      else if (sql.includes("blob1 = 'provider_http_attempt'") && sql.includes('GROUP BY provider'))
        data = rows.httpByProvider ?? []
      else if (sql.includes("blob1 = 'provider_http_attempt'")) data = rows.httpByCompetition ?? []
      else if (sql.includes("blob1 = 'football_api_error'")) data = rows.apiErrors ?? []
      else if (sql.includes("blob1 = 'match_results_fallback'") && sql.includes("blob3 = ''"))
        data = rows.fallbackRuns ?? []
      else if (sql.includes("blob1 = 'match_results_fallback'")) data = rows.fallbackFailures ?? []
      return { ok: true, json: async () => ({ data }) }
    })
  }

  async function getOps(fetchFake: ReturnType<typeof fetchBySql>, query = '') {
    vi.stubGlobal('fetch', fetchFake)
    return makeApp().request(
      `/metrics/ops${query}`,
      { headers: await authHeaders(ADMIN) },
      makeEnv(),
    )
  }

  type OpsBody = {
    days: number
    httpFirstSeenAt: string | null
    httpByProvider: Record<string, unknown>[]
    httpByCompetition: Record<string, unknown>[]
    apiErrors: { context: string; competition_id: string; count: number }[]
    fallback: {
      competition_id: string
      runs: number
      updated: number
      skipped: number
      failures: number
    }[]
  }

  it('401 sem sessão, 403 para não-admin e 503 sem credenciais da SQL API', async () => {
    const app = makeApp()
    expect((await app.request('/metrics/ops', {}, makeEnv())).status).toBe(401)
    expect(
      (
        await app.request(
          '/metrics/ops',
          { headers: await authHeaders('outra@pessoa.com') },
          makeEnv(),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await app.request(
          '/metrics/ops',
          { headers: await authHeaders(ADMIN) },
          makeEnv({ CF_ACCOUNT_ID: undefined }),
        )
      ).status,
    ).toBe(503)
  })

  it('502 quando a SQL API falha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' })),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await makeApp().request(
      '/metrics/ops',
      { headers: await authHeaders(ADMIN) },
      makeEnv(),
    )
    expect(res.status).toBe(502)
  })

  it('agrega pela janela e pelo peso: _sample_interval × double2, nunca COUNT(*)', async () => {
    const fetchFake = fetchBySql({})
    const res = await getOps(fetchFake, '?days=7')
    expect(res.status).toBe(200)

    const bodies = (fetchFake.mock.calls as unknown as [string, { body: string }][]).map(
      (c) => c[1].body,
    )
    expect(bodies).toHaveLength(6)
    expect(bodies.some((sql) => /COUNT\(\*\)/.test(sql))).toBe(false)

    const http = bodies.filter((sql) => sql.includes("blob1 = 'provider_http_attempt'"))
    const windowed = http.filter((sql) => !sql.includes('MIN(timestamp)'))
    expect(windowed).toHaveLength(2)
    for (const sql of windowed) {
      expect(sql).toContain("INTERVAL '7' DAY")
      expect(sql).toContain('SUM((_sample_interval * double2)) AS attempts')
      expect(sql).toContain('SUM(_sample_interval) AS events')
    }
    // O "desde quando existe coleta" não pode herdar a janela: senão um período
    // curto sem eventos pareceria instrumentação ausente.
    const firstSeen = http.find((sql) => sql.includes('MIN(timestamp)'))
    expect(firstSeen).not.toContain('INTERVAL')

    for (const sql of bodies.filter((q) => q.includes("blob1 = 'match_results_fallback'"))) {
      expect(sql).toContain('SUM(_sample_interval)')
      expect(sql).toContain("INTERVAL '7' DAY")
    }
  })

  it('sem eventos devolve listas vazias e httpFirstSeenAt nulo (ausência ≠ zero)', async () => {
    const res = await getOps(fetchBySql({}))
    const body = (await res.json()) as OpsBody

    expect(body.httpFirstSeenAt).toBeNull()
    expect(body.httpByProvider).toEqual([])
    expect(body.httpByCompetition).toEqual([])
    expect(body.apiErrors).toEqual([])
    expect(body.fallback).toEqual([])
  })

  it('devolve tentativas HTTP por provedor/contexto/status e por competição, com números', async () => {
    const res = await getOps(
      fetchBySql({
        firstSeen: [{ first_at: '2026-10-20 10:00:00' }],
        httpByProvider: [
          {
            provider: 'espn',
            context: 'poller',
            status: '403',
            attempts: '12',
            events: '12',
            avg_ms: '210.5',
            max_ms: '900',
          },
          {
            provider: 'espn',
            context: 'poller',
            status: '200',
            attempts: '300',
            events: '30',
            avg_ms: '80',
            max_ms: '400',
          },
        ],
        httpByCompetition: [
          {
            competition_id: COMP_A,
            provider: 'espn',
            status: '403',
            attempts: '12',
            events: '12',
            avg_ms: '210',
            max_ms: '900',
          },
          {
            competition_id: '',
            provider: 'football-data',
            status: '429',
            attempts: '2',
            events: '2',
            avg_ms: '50',
            max_ms: '60',
          },
        ],
      }),
    )
    const body = (await res.json()) as OpsBody

    expect(body.httpFirstSeenAt).toBe('2026-10-20 10:00:00')
    expect(body.httpByProvider[0]).toEqual({
      provider: 'espn',
      context: 'poller',
      status: '403',
      attempts: 12,
      events: 12,
      avg_ms: 210.5,
      max_ms: 900,
    })
    // 300 tentativas estimadas a partir de 30 eventos amostrados: a diferença
    // entre `attempts` e `events` é a amostragem de 10% dos sucessos.
    expect(body.httpByProvider[1]).toMatchObject({ attempts: 300, events: 30 })
    expect(body.httpByCompetition.map((r) => r.competition_id)).toEqual([COMP_A, ''])
  })

  it('classifica football_api_error pela forma posicional e soma por origem e competição', async () => {
    const res = await getOps(
      fetchBySql({
        apiErrors: [
          { blob2: COMP_A, blob3: '30', count: '2' }, // poller: [comp, round]
          { blob2: COMP_A, blob3: '31', count: '1' }, // mesma comp, outra rodada
          { blob2: 'fixture_discovery', blob3: COMP_B, count: '4' },
          { blob2: 'sync_endpoint', blob3: 'football-data.org respondeu 500', count: '1' },
          { blob2: 'sync_endpoint', blob3: 'outra mensagem', count: '2' },
        ],
      }),
    )
    const body = (await res.json()) as OpsBody

    expect(body.apiErrors).toEqual([
      { context: 'fixture_discovery', competition_id: COMP_B, count: 4 },
      { context: 'poller', competition_id: COMP_A, count: 3 },
      { context: 'sync_endpoint', competition_id: '', count: 3 },
    ])
    // Mensagem livre do provedor nunca sai no payload.
    expect(JSON.stringify(body)).not.toContain('respondeu 500')
  })

  it('une execuções e falhas do fallback por competição, ordenando falhas primeiro', async () => {
    const res = await getOps(
      fetchBySql({
        fallbackRuns: [
          { competition_id: COMP_A, runs: '10', updated: '3', skipped: '7' },
          { competition_id: COMP_B, runs: '5', updated: '0', skipped: '0' },
        ],
        fallbackFailures: [
          { competition_id: COMP_B, failures: '2' },
          { competition_id: '', failures: '1' },
        ],
      }),
    )
    const body = (await res.json()) as OpsBody

    expect(body.fallback).toEqual([
      { competition_id: COMP_B, runs: 5, updated: 0, skipped: 0, failures: 2 },
      { competition_id: '', runs: 0, updated: 0, skipped: 0, failures: 1 },
      { competition_id: COMP_A, runs: 10, updated: 3, skipped: 7, failures: 0 },
    ])
  })

  it('descarta como "sem liga" qualquer valor de competição que não seja UUID (blob legado)', async () => {
    const res = await getOps(
      fetchBySql({
        fallbackRuns: [{ competition_id: 'ESPN down too', runs: '1', updated: '0', skipped: '0' }],
        httpByCompetition: [
          {
            competition_id: 'texto livre',
            provider: 'espn',
            status: '200',
            attempts: '10',
            events: '1',
            avg_ms: '1',
            max_ms: '1',
          },
        ],
      }),
    )
    const body = (await res.json()) as OpsBody

    expect(body.fallback[0].competition_id).toBe('')
    expect(body.httpByCompetition[0].competition_id).toBe('')
    expect(JSON.stringify(body)).not.toContain('texto livre')
    expect(JSON.stringify(body)).not.toContain('ESPN down too')
  })

  it('não emite logEvent (endpoints /metrics são leitura)', async () => {
    const ae = { writeDataPoint: vi.fn() }
    vi.stubGlobal('fetch', fetchBySql({}))
    await makeApp().request(
      '/metrics/ops',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ AE: ae as unknown as AnalyticsEngineDataset }),
    )
    expect(ae.writeDataPoint).not.toHaveBeenCalled()
  })
})

describe('GET /metrics/competition-activity', () => {
  const COMP_A = '11111111-2222-4333-8444-555555555555'
  const COMP_B = '66666666-7777-4888-8999-aaaaaaaaaaaa'
  const COMP_GONE = '99999999-0000-4000-8000-000000000000'

  function fetchBySql(rows: {
    groups?: unknown[]
    predictions?: unknown[]
    since?: unknown[]
    daily?: unknown[]
  }) {
    return vi.fn(async (_url: string, init: { body: string }) => {
      const sql = init.body
      let data: unknown[] = []
      if (sql.includes('MIN(timestamp)')) data = rows.since ?? []
      else if (sql.includes('toStartOfInterval')) data = rows.daily ?? []
      else if (sql.includes("blob1 = 'group_created'")) data = rows.groups ?? []
      else if (sql.includes("blob1 = 'prediction_saved'")) data = rows.predictions ?? []
      return { ok: true, json: async () => ({ data }) }
    })
  }

  function competitionsDb() {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    sqlite.exec(`
      INSERT INTO competitions (id,name,slug,season,status) VALUES
        ('${COMP_A}','Brasileirão Série A','br-a','2026','ongoing'),
        ('${COMP_B}','Libertadores','liberta','2026','ongoing');
    `)
    return db
  }

  type ActivityBody = {
    days: number
    predictionsDimensionSince: string | null
    groupsDaily: { day: string; competition_id: string; groups_created: number }[]
    groupsDailyTruncated: boolean
    competitions: {
      competition_id: string
      name: string | null
      season: string | null
      groups_created: number
      prediction_saves: number
      predictions: number
    }[]
  }

  async function getActivity(
    fetchFake: ReturnType<typeof fetchBySql>,
    query = '',
    db = competitionsDb(),
  ) {
    vi.stubGlobal('fetch', fetchFake)
    return makeApp().request(
      `/metrics/competition-activity${query}`,
      { headers: await authHeaders(ADMIN) },
      makeEnv({ DB: db }),
    )
  }

  it('401 sem sessão, 403 para não-admin e 503 sem credenciais da SQL API', async () => {
    const app = makeApp()
    const env = makeEnv({ DB: competitionsDb() })
    expect((await app.request('/metrics/competition-activity', {}, env)).status).toBe(401)
    expect(
      (
        await app.request(
          '/metrics/competition-activity',
          { headers: await authHeaders('outra@pessoa.com') },
          env,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await app.request(
          '/metrics/competition-activity',
          { headers: await authHeaders(ADMIN) },
          makeEnv({ DB: competitionsDb(), AE_SQL_TOKEN: undefined }),
        )
      ).status,
    ).toBe(503)
  })

  it('502 quando a SQL API falha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' })),
    )
    const res = await makeApp().request(
      '/metrics/competition-activity',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ DB: competitionsDb() }),
    )
    expect(res.status).toBe(502)
  })

  it('pondera pelo sampling e filtra pela janela: nunca COUNT(*), blob3/blob6 como dimensão', async () => {
    const fetchFake = fetchBySql({})
    const res = await getActivity(fetchFake, '?days=7')
    expect(res.status).toBe(200)

    const bodies = (fetchFake.mock.calls as unknown as [string, { body: string }][]).map(
      (call) => call[1].body,
    )
    expect(bodies).toHaveLength(4)
    expect(bodies.some((sql) => /COUNT\(\*\)/.test(sql))).toBe(false)

    const groups = bodies.find(
      (sql) => sql.includes("blob1 = 'group_created'") && !sql.includes('toStartOfInterval'),
    )
    expect(groups).toContain('blob3 AS competition_id')
    expect(groups).toContain('SUM(_sample_interval) AS groups')
    expect(groups).toContain("INTERVAL '7' DAY")

    const predictions = bodies.find(
      (sql) => sql.includes("blob1 = 'prediction_saved'") && !sql.includes('MIN(timestamp)'),
    )
    expect(predictions).toContain('blob6 AS competition_id')
    expect(predictions).toContain('SUM(_sample_interval) AS saves')
    expect(predictions).toContain('SUM(double1 * _sample_interval) AS predictions')
    expect(predictions).toContain("INTERVAL '7' DAY")

    // Série diária: dia UTC × competition_id, ponderada, na mesma janela, com teto.
    const daily = bodies.find((sql) => sql.includes('toStartOfInterval'))
    expect(daily).toContain("toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day")
    expect(daily).toContain("blob1 = 'group_created'")
    expect(daily).toContain('blob3 AS competition_id')
    expect(daily).toContain('SUM(_sample_interval) AS groups')
    expect(daily).toContain('GROUP BY day, competition_id')
    expect(daily).toContain("INTERVAL '7' DAY")
    expect(daily).toMatch(/LIMIT \d+$/)

    // Cobertura da dimensão não herda a janela: senão um período curto sem
    // eventos pareceria coleta ausente.
    const since = bodies.find((sql) => sql.includes('MIN(timestamp)'))
    expect(since).not.toContain('INTERVAL')
    expect(since).toContain("blob6 != ''")
    // Sem join na SQL API: nome e temporada vêm do D1.
    for (const sql of bodies) expect(sql).not.toMatch(/\bJOIN\b/i)
  })

  it('une criações e palpites por competição, resolve nome/temporada no D1 e ordena', async () => {
    const res = await getActivity(
      fetchBySql({
        groups: [
          { competition_id: COMP_A, groups: '4' },
          { competition_id: COMP_B, groups: '1' },
        ],
        predictions: [
          { competition_id: COMP_B, saves: '5', predictions: '120' },
          { competition_id: COMP_A, saves: '3', predictions: '30' },
        ],
        since: [{ first_at: '2026-10-20 12:00:00' }],
      }),
    )
    const body = (await res.json()) as ActivityBody

    expect(body.days).toBe(30)
    expect(body.predictionsDimensionSince).toBe('2026-10-20 12:00:00')
    expect(body.competitions).toEqual([
      {
        competition_id: COMP_A,
        name: 'Brasileirão Série A',
        season: '2026',
        groups_created: 4,
        prediction_saves: 3,
        predictions: 30,
      },
      {
        competition_id: COMP_B,
        name: 'Libertadores',
        season: '2026',
        groups_created: 1,
        prediction_saves: 5,
        predictions: 120,
      },
    ])
  })

  it('evento histórico sem a dimensão vira "sem liga"; id sem competição no D1 fica sem nome', async () => {
    const res = await getActivity(
      fetchBySql({
        groups: [{ competition_id: COMP_GONE, groups: '2' }],
        predictions: [
          { competition_id: '', saves: '9', predictions: '50' },
          { competition_id: COMP_A, saves: '1', predictions: '2' },
        ],
      }),
    )
    const body = (await res.json()) as ActivityBody

    expect(body.predictionsDimensionSince).toBeNull()
    expect(body.competitions).toEqual([
      {
        competition_id: COMP_GONE,
        name: null,
        season: null,
        groups_created: 2,
        prediction_saves: 0,
        predictions: 0,
      },
      {
        competition_id: '',
        name: null,
        season: null,
        groups_created: 0,
        prediction_saves: 9,
        predictions: 50,
      },
      {
        competition_id: COMP_A,
        name: 'Brasileirão Série A',
        season: '2026',
        groups_created: 0,
        prediction_saves: 1,
        predictions: 2,
      },
    ])
  })

  it('blob que não é UUID é descartado e somado em "sem liga", sem vazar o texto', async () => {
    const res = await getActivity(
      fetchBySql({
        predictions: [
          { competition_id: 'texto livre', saves: '1', predictions: '4' },
          { competition_id: '', saves: '2', predictions: '6' },
        ],
      }),
    )
    const body = (await res.json()) as ActivityBody

    expect(body.competitions).toEqual([
      {
        competition_id: '',
        name: null,
        season: null,
        groups_created: 0,
        prediction_saves: 3,
        predictions: 10,
      },
    ])
    expect(JSON.stringify(body)).not.toContain('texto livre')
  })

  it('série diária: datas e campeonatos distintos, ordenada por dia, dia normalizado para YYYY-MM-DD', async () => {
    const res = await getActivity(
      fetchBySql({
        groups: [
          { competition_id: COMP_A, groups: '5' },
          { competition_id: COMP_B, groups: '2' },
        ],
        // A SQL API entrega do dia mais recente para o mais antigo (ORDER BY day DESC).
        daily: [
          { day: '2026-10-28 00:00:00', competition_id: COMP_B, groups: '2' },
          { day: '2026-10-28 00:00:00', competition_id: COMP_A, groups: '1' },
          { day: '2026-10-26 00:00:00', competition_id: COMP_A, groups: '4' },
        ],
      }),
    )
    const body = (await res.json()) as ActivityBody

    expect(body.groupsDaily).toEqual([
      { day: '2026-10-26', competition_id: COMP_A, groups_created: 4 },
      { day: '2026-10-28', competition_id: COMP_A, groups_created: 1 },
      { day: '2026-10-28', competition_id: COMP_B, groups_created: 2 },
    ])
    expect(body.groupsDailyTruncated).toBe(false)
    // O total por campeonato continua vindo da consulta própria (compatibilidade).
    expect(body.competitions.map((c) => [c.competition_id, c.groups_created])).toEqual([
      [COMP_A, 5],
      [COMP_B, 2],
    ])
  })

  it('série diária com histórico sem dimensão: blob vazio e lixo viram "sem liga" e somam no mesmo dia', async () => {
    const res = await getActivity(
      fetchBySql({
        daily: [
          { day: '2026-10-20 00:00:00', competition_id: '', groups: '3' },
          { day: '2026-10-20 00:00:00', competition_id: 'texto livre', groups: '2' },
          { day: '2026-10-21 00:00:00', competition_id: COMP_A, groups: '1' },
        ],
      }),
    )
    const body = (await res.json()) as ActivityBody

    expect(body.groupsDaily).toEqual([
      { day: '2026-10-20', competition_id: '', groups_created: 5 },
      { day: '2026-10-21', competition_id: COMP_A, groups_created: 1 },
    ])
    expect(JSON.stringify(body)).not.toContain('texto livre')
  })

  it('série diária preserva a ponderação fracionária do sampling e descarta linha sem dia ou valor válido', async () => {
    const res = await getActivity(
      fetchBySql({
        daily: [
          { day: '2026-10-22 00:00:00', competition_id: COMP_A, groups: 12.5 },
          { day: 'ontem', competition_id: COMP_A, groups: '9' },
          { day: null, competition_id: COMP_A, groups: '9' },
          { day: '2026-10-23 00:00:00', competition_id: COMP_A, groups: 'NaN' },
        ],
      }),
    )
    const body = (await res.json()) as ActivityBody

    expect(body.groupsDaily).toEqual([
      { day: '2026-10-22', competition_id: COMP_A, groups_created: 12.5 },
    ])
  })

  it('id que só aparece na série diária ganha total e nome, sem ficar órfão na UI', async () => {
    const res = await getActivity(
      fetchBySql({
        groups: [],
        daily: [
          { day: '2026-10-22 00:00:00', competition_id: COMP_B, groups: '3' },
          { day: '2026-10-23 00:00:00', competition_id: COMP_B, groups: '4' },
        ],
      }),
    )
    const body = (await res.json()) as ActivityBody

    expect(body.competitions).toEqual([
      {
        competition_id: COMP_B,
        name: 'Libertadores',
        season: '2026',
        groups_created: 7,
        prediction_saves: 0,
        predictions: 0,
      },
    ])
  })

  it('série diária no teto da SQL API: sinaliza truncamento em vez de passar por completa', async () => {
    const daily = Array.from({ length: 5000 }, (_, i) => ({
      day: `2026-08-${String((i % 28) + 1).padStart(2, '0')} 00:00:00`,
      competition_id: COMP_A,
      groups: '1',
    }))
    const res = await getActivity(fetchBySql({ daily }))
    const body = (await res.json()) as ActivityBody
    expect(body.groupsDailyTruncated).toBe(true)

    const below = await getActivity(fetchBySql({ daily: daily.slice(0, 4999) }))
    expect(((await below.json()) as ActivityBody).groupsDailyTruncated).toBe(false)
  })

  it('o período chega à série diária: 7, 30 e 90 dias; inválido cai em 30', async () => {
    for (const [query, expected] of [
      ['?days=7', 7],
      ['?days=30', 30],
      ['?days=90', 90],
      ['?days=999', 90],
      ['?days=abc', 30],
    ] as const) {
      const fetchFake = fetchBySql({})
      const res = await getActivity(fetchFake, query)
      expect(((await res.json()) as ActivityBody).days).toBe(expected)
      const daily = (fetchFake.mock.calls as unknown as [string, { body: string }][])
        .map((call) => call[1].body)
        .find((sql) => sql.includes('toStartOfInterval'))
      expect(daily).toContain(`INTERVAL '${expected}' DAY`)
    }
  })

  it('sem eventos devolve lista vazia sem consultar o D1', async () => {
    const db = competitionsDb()
    const prepare = vi.spyOn(db, 'prepare')
    const res = await getActivity(fetchBySql({}), '', db)
    const body = (await res.json()) as ActivityBody

    expect(body.competitions).toEqual([])
    expect(body.groupsDaily).toEqual([])
    expect(body.groupsDailyTruncated).toBe(false)
    expect(body.predictionsDimensionSince).toBeNull()
    expect(prepare.mock.calls.some(([sql]) => sql.includes('FROM competitions'))).toBe(false)
  })

  it('só agregados: sem user_hash, group_id nem e-mail no payload, e sem logEvent', async () => {
    const ae = { writeDataPoint: vi.fn() }
    vi.stubGlobal(
      'fetch',
      fetchBySql({
        groups: [{ competition_id: COMP_A, groups: '1', blob4: 'deadbeefdeadbeef' }],
        daily: [
          {
            day: '2026-10-22 00:00:00',
            competition_id: COMP_A,
            groups: '1',
            blob4: 'deadbeefdeadbeef',
            blob2: 'g-1',
          },
        ],
        predictions: [
          {
            competition_id: COMP_A,
            saves: '1',
            predictions: '1',
            blob2: 'g-1',
          },
        ],
      }),
    )
    const res = await makeApp().request(
      '/metrics/competition-activity',
      { headers: await authHeaders(ADMIN) },
      makeEnv({
        DB: competitionsDb(),
        AE: ae as unknown as AnalyticsEngineDataset,
      }),
    )
    const text = JSON.stringify(await res.json())

    expect(text).not.toContain('deadbeef')
    expect(text).not.toContain('g-1')
    expect(text).not.toContain('@')
    expect(ae.writeDataPoint).not.toHaveBeenCalled()
  })
})

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
        overdue_no_score: 0,
        finished_unscored: 0,
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
        overdue_no_score: 0,
        finished_unscored: 0,
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
        overdue_no_score: 0,
        finished_unscored: 0,
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
        overdue_no_score: 0,
        finished_unscored: 0,
      },
    ])
    // Formato legado para o front ainda não atualizado: só quem tem grupo.
    expect(body.topCompetitions).toEqual([
      { competition: 'Brasileirão Série A', groups: 2 },
      { competition: 'Brasileirão Série A', groups: 1 },
      { competition: 'Liga Piloto', groups: 1 },
    ])
  })

  it('conta jogos atrasados sem placar e finished sem scored_at por temporada', async () => {
    const res = await makeApp().request(
      '/metrics/business',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ DB: createBusinessFixture(healthMatchesSql()) }),
    )

    const { competitions } = (await res.json()) as { competitions: CompetitionRow[] }
    const health = Object.fromEntries(
      competitions.map((c) => [
        c.id,
        { overdue: c.overdue_no_score, unscored: c.finished_unscored },
      ]),
    )
    expect(health).toEqual({
      // 5 atrasados: scheduled 3h01, live, parcial, offset -03:00 e milissegundos.
      // Ficam de fora: janela de 3h, futuro, adiado, 0x0 e offset na janela.
      // 2 finished sem scored_at; o pontuado e os do fixture-base não contam.
      'comp-br26': { overdue: 5, unscored: 2 },
      'comp-br25': { overdue: 1, unscored: 1 },
      // Só tem um jogo adiado e um finished já pontuado: zeros explícitos.
      'comp-pilot': { overdue: 0, unscored: 0 },
      // Sem nenhum jogo: continua na lista, zerada.
      'comp-empty': { overdue: 0, unscored: 0 },
    })
  })

  it('a saúde de resultados não altera grupos, membros nem ativos da temporada', async () => {
    const [withMatches, baseline] = await Promise.all(
      [healthMatchesSql(), ''].map(async (extra) => {
        const res = await makeApp().request(
          '/metrics/business',
          { headers: await authHeaders(ADMIN) },
          makeEnv({ DB: createBusinessFixture(extra) }),
        )
        const { competitions } = (await res.json()) as { competitions: CompetitionRow[] }
        return competitions.map((c) => [c.id, c.groups_current, c.members, c.active_groups_14d])
      }),
    )
    expect(withMatches).toEqual(baseline)
    expect(withMatches[0]).toEqual(['comp-br26', 2, 3, 1])
  })

  it('não expõe e-mails, ids de usuário, nomes de grupo, convites nem ids de jogo', async () => {
    const res = await makeApp().request(
      '/metrics/business',
      { headers: await authHeaders(ADMIN) },
      makeEnv({ DB: createBusinessFixture(healthMatchesSql()) }),
    )

    const raw = await res.text()
    for (const leaked of [
      '@example.com',
      'alice',
      'Bolão',
      'SECRET-',
      'g-br26-a',
      'm-br26',
      'h-late',
      'h-fin',
    ]) {
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

describe('GET /metrics/heatmap', () => {
  function fetchBySql(rows: { hourly?: unknown[]; firstSeen?: unknown[]; sampling?: unknown[] }) {
    return vi.fn(async (_url: string, init: { body: string }) => {
      const sql = init.body
      let data: unknown[] = []
      if (sql.includes('MIN(timestamp)')) data = rows.firstSeen ?? []
      else if (sql.includes('AVG(_sample_interval)')) data = rows.sampling ?? []
      else if (sql.includes('toStartOfInterval')) data = rows.hourly ?? []
      return { ok: true, json: async () => ({ data }) }
    })
  }

  type HeatmapBody = {
    days: number
    avgSampleInterval: number
    firstSeenAt: { prediction_saved: string | null; login_success: string | null }
    hourly: { hour: string; prediction_saves: number; predictions: number; logins: number }[]
  }

  async function getHeatmap(fetchFake: ReturnType<typeof fetchBySql>, query = '') {
    vi.stubGlobal('fetch', fetchFake)
    return makeApp().request(
      `/metrics/heatmap${query}`,
      { headers: await authHeaders(ADMIN) },
      makeEnv(),
    )
  }

  it('401 sem sessão, 403 para não-admin e 503 sem credenciais da SQL API', async () => {
    const app = makeApp()
    expect((await app.request('/metrics/heatmap', {}, makeEnv())).status).toBe(401)
    expect(
      (
        await app.request(
          '/metrics/heatmap',
          { headers: await authHeaders('outra@pessoa.com') },
          makeEnv(),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await app.request(
          '/metrics/heatmap',
          { headers: await authHeaders(ADMIN) },
          makeEnv({ CF_ACCOUNT_ID: undefined }),
        )
      ).status,
    ).toBe(503)
  })

  it('502 quando a SQL API falha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' })),
    )
    const res = await makeApp().request(
      '/metrics/heatmap',
      { headers: await authHeaders(ADMIN) },
      makeEnv(),
    )
    expect(res.status).toBe(502)
  })

  it('agrega por hora UTC, pondera pelo sampling e não sai da janela nem faz join', async () => {
    const fetchFake = fetchBySql({})
    const res = await getHeatmap(fetchFake, '?days=7')
    expect(res.status).toBe(200)

    const bodies = (fetchFake.mock.calls as unknown as [string, { body: string }][]).map(
      (call) => call[1].body,
    )
    expect(bodies).toHaveLength(3)
    expect(bodies.some((sql) => /COUNT\(\*\)/.test(sql))).toBe(false)
    for (const sql of bodies) {
      expect(sql).not.toMatch(/\bJOIN\b/i)
      expect(sql).toContain("blob1 IN ('prediction_saved', 'login_success')")
    }

    const hourly = bodies.find((sql) => sql.includes('toStartOfInterval'))
    expect(hourly).toContain("toStartOfInterval(timestamp, INTERVAL '1' HOUR) AS hour")
    expect(hourly).toContain('SUM(_sample_interval) AS events')
    expect(hourly).toContain('SUM(double1 * _sample_interval) AS predictions')
    expect(hourly).toContain('GROUP BY hour, event_type')
    expect(hourly).toContain("INTERVAL '7' DAY")
    expect(hourly).toMatch(/LIMIT \d+$/)

    // Cobertura não herda a janela: senão um período curto sem eventos pareceria coleta ausente.
    const first = bodies.find((sql) => sql.includes('MIN(timestamp)'))
    expect(first).not.toContain("INTERVAL '7' DAY")
    expect(first).toContain('GROUP BY event_type')

    const sampling = bodies.find((sql) => sql.includes('AVG(_sample_interval)'))
    expect(sampling).toContain("INTERVAL '7' DAY")
  })

  it('junta palpites e logins da mesma hora numa linha, em ordem cronológica, sem converter fuso', async () => {
    const res = await getHeatmap(
      fetchBySql({
        // A SQL API devolve em ordem decrescente (LIMIT pega as horas mais recentes).
        hourly: [
          {
            hour: '2026-10-29 14:00:00',
            event_type: 'prediction_saved',
            events: '3',
            predictions: '40',
          },
          {
            hour: '2026-10-29 14:00:00',
            event_type: 'login_success',
            events: '5',
            predictions: '0',
          },
          {
            hour: '2026-10-29 02:00:00',
            event_type: 'login_success',
            events: '2',
            predictions: '0',
          },
        ],
        firstSeen: [
          { event_type: 'prediction_saved', first_at: '2026-08-01 10:00:00' },
          { event_type: 'login_success', first_at: '2026-08-02 11:00:00' },
        ],
        sampling: [{ avg_sample_interval: '1' }],
      }),
      '?days=30',
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as HeatmapBody
    expect(body.days).toBe(30)
    expect(body.hourly).toEqual([
      { hour: '2026-10-29T02:00:00Z', prediction_saves: 0, predictions: 0, logins: 2 },
      { hour: '2026-10-29T14:00:00Z', prediction_saves: 3, predictions: 40, logins: 5 },
    ])
    expect(body.firstSeenAt).toEqual({
      prediction_saved: '2026-08-01 10:00:00',
      login_success: '2026-08-02 11:00:00',
    })
    expect(body.avgSampleInterval).toBe(1)
  })

  it('preserva contagem ponderada (estimativa) e expõe a média do sampling', async () => {
    const res = await getHeatmap(
      fetchBySql({
        hourly: [
          // _sample_interval = 10: 4 linhas viram 40 eventos; 120 palpites ponderados.
          {
            hour: '2026-10-29 20:00:00',
            event_type: 'prediction_saved',
            events: '40',
            predictions: '120',
          },
        ],
        sampling: [{ avg_sample_interval: '4.5' }],
      }),
    )
    const body = (await res.json()) as HeatmapBody
    expect(body.hourly[0]).toMatchObject({ prediction_saves: 40, predictions: 120 })
    expect(body.avgSampleInterval).toBe(4.5)
  })

  it('sem coleta: devolve listas vazias, firstSeenAt nulo e sampling 1, nunca zeros inventados', async () => {
    const res = await getHeatmap(fetchBySql({}))
    const body = (await res.json()) as HeatmapBody
    expect(body.hourly).toEqual([])
    expect(body.firstSeenAt).toEqual({ prediction_saved: null, login_success: null })
    expect(body.avgSampleInterval).toBe(1)
  })

  it('descarta hora inválida, ignora tipo inesperado e soma linhas repetidas da mesma hora', async () => {
    const res = await getHeatmap(
      fetchBySql({
        hourly: [
          { hour: 'lixo', event_type: 'login_success', events: '9', predictions: '0' },
          { hour: null, event_type: 'login_success', events: '9', predictions: '0' },
          {
            hour: '2026-13-45 99:00:00',
            event_type: 'login_success',
            events: '9',
            predictions: '0',
          },
          {
            hour: '2026-10-29 10:00:00',
            event_type: 'group_created',
            events: '7',
            predictions: '0',
          },
          {
            hour: '2026-10-29 10:00:00',
            event_type: 'login_success',
            events: '1',
            predictions: '0',
          },
          {
            hour: '2026-10-29T10:30:00Z',
            event_type: 'login_success',
            events: '2',
            predictions: '0',
          },
          {
            hour: '2026-10-29 11:00:00',
            event_type: 'login_success',
            events: 'NaN',
            predictions: '0',
          },
        ],
      }),
    )
    const body = (await res.json()) as HeatmapBody
    expect(body.hourly).toEqual([
      { hour: '2026-10-29T10:00:00Z', prediction_saves: 0, predictions: 0, logins: 3 },
    ])
  })

  it('média de sampling inválida ou abaixo de 1 cai em 1', async () => {
    const res = await getHeatmap(fetchBySql({ sampling: [{ avg_sample_interval: null }] }))
    expect(((await res.json()) as HeatmapBody).avgSampleInterval).toBe(1)
  })

  it('payload não carrega user_hash nem identificadores: só hora e contagens', async () => {
    const res = await getHeatmap(
      fetchBySql({
        hourly: [
          {
            hour: '2026-10-29 14:00:00',
            event_type: 'prediction_saved',
            events: '1',
            predictions: '2',
            blob4: 'abc123hash',
            user_hash: 'abc123hash',
          },
        ],
      }),
    )
    const text = await res.text()
    expect(text).not.toContain('abc123hash')
    expect(Object.keys((JSON.parse(text) as HeatmapBody).hourly[0]).sort()).toEqual([
      'hour',
      'logins',
      'prediction_saves',
      'predictions',
    ])
  })
})
