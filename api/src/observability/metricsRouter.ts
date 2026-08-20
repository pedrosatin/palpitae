import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { radarRouter } from '../radar/router'
import type { AppContext, Env } from '../types'

/**
 * Métricas para o dashboard admin — proxy autenticado da SQL API do Analytics
 * Engine + listagem do arquivo frio (R2). Ver `docs/observability.md`.
 *
 * Por que um proxy: a SQL API exige um token de CONTA Cloudflare
 * (Account Analytics:Read), que nunca pode ir pro cliente. O token fica em
 * secret do Worker; o navegador autentica com o cookie de sessão normal.
 *
 * Acesso: só o admin (e-mail em ADMIN_EMAIL, secret). Sem ADMIN_EMAIL
 * configurado, tudo responde 403 — fechado por padrão.
 *
 * São endpoints de LEITURA — sem logEvent, conforme a regra de instrumentação.
 */

const DATASET = 'palpitae_events'

const MAX_DAYS = 90 // janela de retenção do Analytics Engine (~3 meses)

/** Executa uma query na SQL API do Analytics Engine e devolve as linhas. */
async function runAeSql(env: Env, sql: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AE_SQL_TOKEN}` },
      body: sql,
    },
  )
  if (!res.ok) {
    throw new Error(`AE SQL respondeu ${res.status}: ${await res.text()}`)
  }
  const payload = (await res.json()) as { data?: Record<string, unknown>[] }
  return payload.data ?? []
}

/** Janela em dias vinda da query string, saneada (1..MAX_DAYS; default 30). */
function parseDays(raw: string | undefined): number {
  const n = Number(raw ?? '30')
  if (!Number.isInteger(n) || n < 1) return 30
  return Math.min(n, MAX_DAYS)
}

export const metricsRouter = new Hono<AppContext>()

metricsRouter.use('*', requireAuth)

metricsRouter.use('*', async (c, next) => {
  // Comparação case-insensitive: o casing do e-mail no ID token do Google
  // não é garantido, e um mismatch aqui trancaria o admin pra fora.
  const admin = c.env.ADMIN_EMAIL?.toLowerCase()
  if (!admin || c.get('userEmail')?.toLowerCase() !== admin) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await next()
})

// Radar de competições (/metrics/radar) — inteligência de produto, mesmo gate
// de admin. Ver api/src/radar/router.ts.
metricsRouter.route('/radar', radarRouter)

/**
 * Visão geral do período: totais por tipo, série diária, saúde do poller, KPIs
 * de negócio, cache hit rate, quota da API Football e erros recentes. Sempre
 * agregando com SUM(_sample_interval) — sob sampling, cada linha representa N
 * linhas reais (docs/observability.md). Medidas (doubles) idem: o valor da
 * linha vale por N linhas, então soma é SUM(doubleX * _sample_interval).
 *
 * Posições dos blobs por evento: tabela "Esquema posicional" em
 * docs/observability.md (fonte de verdade). Usadas aqui:
 *   prediction_saved → blob4 = user_hash, double1 = count
 *   poller_run       → blob2 = status, double3 = api_calls, double4 = duration_ms
 *   matches_cache    → blob2 = result (hit/miss)
 *   login_failure    → blob2 = reason
 */
metricsRouter.get('/overview', async (c) => {
  if (!c.env.CF_ACCOUNT_ID || !c.env.AE_SQL_TOKEN) {
    return c.json({ error: 'SQL API do Analytics Engine não configurada' }, 503)
  }

  const days = parseDays(c.req.query('days'))
  const since = `timestamp > NOW() - INTERVAL '${days}' DAY`

  try {
    const [
      totals,
      daily,
      poller,
      predictions,
      cache,
      loginFailures,
      apiCallsDaily,
      recentErrors,
      sampling,
      whales,
      lastRuns,
      emailHealth,
      latency,
      predictionsDaily,
    ] = await Promise.all([
      runAeSql(
        c.env,
        `SELECT blob1 AS event_type, SUM(_sample_interval) AS count ` +
          `FROM ${DATASET} WHERE ${since} ` +
          `GROUP BY event_type ORDER BY count DESC`,
      ),
      runAeSql(
        c.env,
        `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, ` +
          `blob1 AS event_type, SUM(_sample_interval) AS count ` +
          `FROM ${DATASET} WHERE ${since} ` +
          `GROUP BY day, event_type ORDER BY day ASC`,
      ),
      runAeSql(
        c.env,
        `SELECT blob2 AS status, SUM(_sample_interval) AS runs, ` +
          `AVG(double4) AS avg_duration_ms, MAX(double4) AS max_duration_ms ` +
          `FROM ${DATASET} WHERE blob1 = 'poller_run' AND ${since} ` +
          `GROUP BY status`,
      ),
      // KPIs de palpite: usuários distintos que palpitaram + nº de palpites.
      // double1 = count (bulk/import salvam vários palpites num evento só).
      runAeSql(
        c.env,
        `SELECT COUNT(DISTINCT blob4) AS active_users, ` +
          `SUM(double1 * _sample_interval) AS total ` +
          `FROM ${DATASET} WHERE blob1 = 'prediction_saved' AND ${since}`,
      ),
      runAeSql(
        c.env,
        `SELECT blob2 AS result, SUM(_sample_interval) AS count ` +
          `FROM ${DATASET} WHERE blob1 = 'matches_cache' AND ${since} ` +
          `GROUP BY result`,
      ),
      runAeSql(
        c.env,
        `SELECT blob2 AS reason, SUM(_sample_interval) AS count ` +
          `FROM ${DATASET} WHERE blob1 = 'login_failure' AND ${since} ` +
          `GROUP BY reason ORDER BY count DESC`,
      ),
      // Quota da API Football: chamadas/dia feitas pelo poller.
      runAeSql(
        c.env,
        `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, ` +
          `SUM(double3 * _sample_interval) AS api_calls ` +
          `FROM ${DATASET} WHERE blob1 = 'poller_run' AND ${since} ` +
          `GROUP BY day ORDER BY day ASC`,
      ),
      // Últimos erros crus pra inspeção — blobs posicionais variam por tipo,
      // o front mostra como detalhe genérico.
      runAeSql(
        c.env,
        `SELECT timestamp, blob1 AS event_type, blob2, blob3, blob4 ` +
          `FROM ${DATASET} ` +
          `WHERE blob1 IN ('football_api_error', 'oauth_error', 'login_failure') AND ${since} ` +
          `ORDER BY timestamp DESC LIMIT 20`,
      ),
      // Vigia do sampling: média > 1 significa que o AE está amostrando —
      // os números do dashboard viram estimativa e o volume merece atenção.
      runAeSql(
        c.env,
        `SELECT AVG(_sample_interval) AS avg_sample_interval ` + `FROM ${DATASET} WHERE ${since}`,
      ),
      // Concentração de palpites por usuário (whales) — hash pseudonimizado,
      // o front mostra só a distribuição (% do total), nunca o hash.
      runAeSql(
        c.env,
        `SELECT blob4 AS user_hash, SUM(double1 * _sample_interval) AS predictions ` +
          `FROM ${DATASET} WHERE blob1 = 'prediction_saved' AND ${since} ` +
          `GROUP BY user_hash ORDER BY predictions DESC LIMIT 10`,
      ),
      // Pulso dos crons: última execução de cada um. Cron parado = MAX antigo
      // (ou linha ausente se ficou fora da janela inteira).
      runAeSql(
        c.env,
        `SELECT blob1 AS event_type, MAX(timestamp) AS last_run ` +
          `FROM ${DATASET} ` +
          `WHERE blob1 IN ('poller_run', 'fixture_discovery_run', 'cron_round_reminder') ` +
          `AND ${since} GROUP BY event_type`,
      ),
      // Saúde do e-mail de lembrete: totais do cron_round_reminder no período.
      runAeSql(
        c.env,
        `SELECT SUM(double1 * _sample_interval) AS rounds, ` +
          `SUM(double2 * _sample_interval) AS sent, ` +
          `SUM(double3 * _sample_interval) AS failed ` +
          `FROM ${DATASET} WHERE blob1 = 'cron_round_reminder' AND ${since}`,
      ),
      // Latência por rota (request_perf): blob2 = rota, double1 = total_ms.
      // Média ponderada pelo sampling (SUM(ms*interval)/SUM(interval)); MAX é o
      // pior caso observado. Rota mais chamada primeiro.
      runAeSql(
        c.env,
        `SELECT blob2 AS route, SUM(_sample_interval) AS requests, ` +
          `SUM(double1 * _sample_interval) / SUM(_sample_interval) AS avg_ms, ` +
          `MAX(double1) AS max_ms, ` +
          `SUM(double2 * _sample_interval) / SUM(_sample_interval) AS avg_db_ms ` +
          `FROM ${DATASET} WHERE blob1 = 'request_perf' AND ${since} ` +
          `GROUP BY route ORDER BY requests DESC`,
      ),
      // DAU: usuários distintos que palpitaram por dia (prediction_saved,
      // blob4 = user_hash). Sob sampling o DISTINCT é piso — mesma ressalva dos
      // whales. É o sinal de engajamento central do produto (app de palpite).
      runAeSql(
        c.env,
        `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, ` +
          `COUNT(DISTINCT blob4) AS users ` +
          `FROM ${DATASET} WHERE blob1 = 'prediction_saved' AND ${since} ` +
          `GROUP BY day ORDER BY day ASC`,
      ),
    ])

    return c.json({
      days,
      totals,
      daily,
      poller,
      predictions: predictions[0] ?? { active_users: 0, total: 0 },
      cache,
      loginFailures,
      apiCallsDaily,
      recentErrors,
      sampling: sampling[0] ?? { avg_sample_interval: 1 },
      whales,
      lastRuns,
      emailHealth: emailHealth[0] ?? { rounds: 0, sent: 0, failed: 0 },
      latency,
      predictionsDaily,
    })
  } catch (err) {
    console.error('[metrics] falha na SQL API:', err)
    return c.json({ error: 'Falha ao consultar o Analytics Engine' }, 502)
  }
})

/**
 * KPIs de negócio a partir do D1 (estado real, não amostrado) — complementa o
 * /overview (Analytics Engine, eventos). "Ativos" aqui é lifetime (toda a
 * base), não a janela de `days`; só contagens "criados no período" respeitam
 * `days`. Ignora grupos soft-deleted (deleted_at) nas contagens de grupo.
 */
metricsRouter.get('/business', async (c) => {
  const days = parseDays(c.req.query('days'))
  const db = c.env.DB

  const [
    usersInGroup,
    usersWhoPredicted,
    usersTotal,
    usersCreated,
    groupsCreated,
    groupMembership,
    topCompetitions,
  ] = await Promise.all([
    db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM group_members`).first(),
    db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM predictions`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM users`).first(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM users WHERE created_at > datetime('now', ?)`,
      )
      .bind(`-${days} days`)
      .first(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM groups WHERE deleted_at IS NULL AND created_at > datetime('now', ?)`,
      )
      .bind(`-${days} days`)
      .first(),
    // Quantos grupos cada usuário integra — distribuição (média + mediana aprox via percentil).
    db
      .prepare(
        `SELECT gm.user_id AS user_id, COUNT(*) AS groups ` +
          `FROM group_members gm ` +
          `JOIN groups g ON g.id = gm.group_id AND g.deleted_at IS NULL ` +
          `GROUP BY gm.user_id`,
      )
      .all(),
    // Campeonatos com mais grupos ativos.
    db
      .prepare(
        `SELECT c.name AS competition, COUNT(*) AS groups ` +
          `FROM groups g JOIN competitions c ON c.id = g.competition_id ` +
          `WHERE g.deleted_at IS NULL ` +
          `GROUP BY c.id ORDER BY groups DESC LIMIT 10`,
      )
      .all(),
  ])

  const groupCounts = (groupMembership.results as { user_id: string; groups: number }[])
    .map((r) => r.groups)
    .sort((a, b) => a - b)
  const avgGroupsPerUser =
    groupCounts.length > 0 ? groupCounts.reduce((s, n) => s + n, 0) / groupCounts.length : 0
  const medianGroupsPerUser =
    groupCounts.length > 0 ? groupCounts[Math.floor(groupCounts.length / 2)] : 0

  return c.json({
    days,
    usersTotal: (usersTotal as { n: number } | null)?.n ?? 0,
    usersInGroup: (usersInGroup as { n: number } | null)?.n ?? 0,
    usersWhoPredicted: (usersWhoPredicted as { n: number } | null)?.n ?? 0,
    usersCreatedInPeriod: (usersCreated as { n: number } | null)?.n ?? 0,
    groupsCreatedInPeriod: (groupsCreated as { n: number } | null)?.n ?? 0,
    avgGroupsPerUser,
    medianGroupsPerUser,
    topCompetitions: topCompetitions.results,
  })
})

/**
 * Arquivo frio — lista os NDJSON diários no R2 (events/YYYY/MM/DD.ndjson).
 * Serve pra auditar o cold path (dia faltando = export falhou) e pra série
 * histórica do dashboard: `events` vem do customMetadata gravado pelo export
 * (contagem real, SUM(_sample_interval)) — `null` em arquivo antigo que o
 * backfill de metadata ainda não alcançou.
 *
 * Lista `events/` inteiro paginando por cursor: ~365 chaves/ano, poucas
 * páginas de 1000 — é o que permite enxergar além da janela de ~3 meses do
 * Analytics Engine.
 */
metricsRouter.get('/archive', async (c) => {
  const bucket = c.env.EVENTS
  if (!bucket) {
    return c.json({ error: 'Bucket R2 não configurado' }, 503)
  }

  const files: {
    key: string
    size: number
    uploaded: Date
    events: number | null
  }[] = []
  let cursor: string | undefined
  do {
    // customMetadata vem por padrão no list() (compatibility_date ≥ 2022-08-04
    // — a opção `include` nem existe mais no runtime atual).
    const listed = await bucket.list({ prefix: 'events/', limit: 1000, cursor })
    for (const o of listed.objects) {
      const raw = o.customMetadata?.events
      files.push({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded,
        events: raw !== undefined ? Number(raw) : null,
      })
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)

  return c.json({ files })
})

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_QUERY_SPAN_DAYS = 92

/** Lista de dias YYYY-MM-DD de `from` a `to` (inclusive), UTC. */
function daysInRange(from: string, to: string): string[] {
  const days: string[] = []
  const cur = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return days
}

/**
 * Análise do arquivo frio — agrega os NDJSON de um intervalo lendo o CORPO dos
 * arquivos (não só a metadata do /archive). É o que permite dissecar dados além
 * da janela de ~3 meses do Analytics Engine: breakdown por tipo de evento e por
 * dia. Cada linha vale `_sample_interval` eventos reais (sampling).
 *
 * `from`/`to` em YYYY-MM-DD (UTC, inclusivo). Span limitado a
 * MAX_QUERY_SPAN_DAYS pra não estourar CPU/memória do Worker — o dashboard
 * consulta um mês por vez.
 */
metricsRouter.get('/archive/query', async (c) => {
  const bucket = c.env.EVENTS
  if (!bucket) {
    return c.json({ error: 'Bucket R2 não configurado' }, 503)
  }

  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to || !DAY_RE.test(from) || !DAY_RE.test(to) || from > to) {
    return c.json({ error: 'Parâmetros from/to inválidos (YYYY-MM-DD, from ≤ to)' }, 400)
  }

  const days = daysInRange(from, to)
  if (days.length > MAX_QUERY_SPAN_DAYS) {
    return c.json({ error: `Intervalo máximo é ${MAX_QUERY_SPAN_DAYS} dias` }, 400)
  }

  const byType = new Map<string, number>()
  const byDay: { day: string; count: number }[] = []
  let filesRead = 0

  const fetchPromises = days.map(async (day) => {
    const key = `events/${day.replaceAll('-', '/')}.ndjson`
    const obj = await bucket.get(key)
    return { day, obj }
  })

  const results = await Promise.all(fetchPromises)

  for (const { day, obj } of results) {
    if (!obj) continue
    filesRead++

    const body = await obj.text()
    let dayTotal = 0
    for (const line of body.split('\n')) {
      if (line.trim() === '') continue
      const row = JSON.parse(line) as Record<string, unknown>
      const weight = Number(row._sample_interval ?? 1)
      const type = String(row.blob1 ?? 'unknown')
      byType.set(type, (byType.get(type) ?? 0) + weight)
      dayTotal += weight
    }
    byDay.push({ day, count: dayTotal })
  }

  const totalEvents = byDay.reduce((sum, d) => sum + d.count, 0)
  const byTypeSorted = [...byType.entries()]
    .map(([event_type, count]) => ({ event_type, count }))
    .sort((a, b) => b.count - a.count)

  return c.json({ from, to, filesRead, totalEvents, byType: byTypeSorted, byDay })
})
