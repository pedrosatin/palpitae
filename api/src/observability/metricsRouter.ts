import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
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
    { method: 'POST', headers: { Authorization: `Bearer ${env.AE_SQL_TOKEN}` }, body: sql },
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
          `SELECT AVG(_sample_interval) AS avg_sample_interval ` +
            `FROM ${DATASET} WHERE ${since}`,
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
    })
  } catch (err) {
    console.error('[metrics] falha na SQL API:', err)
    return c.json({ error: 'Falha ao consultar o Analytics Engine' }, 502)
  }
})

/**
 * Arquivo frio — lista os NDJSON diários no R2 (events/YYYY/MM/DD.ndjson).
 * Serve pra auditar o cold path no dashboard: dia faltando = export falhou.
 *
 * Lista só o mês corrente e o anterior: cobre com folga a janela de 14 dias
 * do dashboard e nunca esbarra no limite de 1000 chaves do list() — listar
 * `events/` inteiro devolveria os dias mais ANTIGOS primeiro (ordem
 * lexicográfica) e, com anos de arquivo, os dias recentes cairiam fora.
 */
metricsRouter.get('/archive', async (c) => {
  const bucket = c.env.EVENTS
  if (!bucket) {
    return c.json({ error: 'Bucket R2 não configurado' }, 503)
  }

  const now = new Date()
  const monthPrefixes = [0, 1].map((back) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    return `events/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/`
  })

  const listed = await Promise.all(
    monthPrefixes.map((prefix) => bucket.list({ prefix, limit: 1000 })),
  )
  const files = listed
    .flatMap((l) => l.objects)
    .map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded }))

  return c.json({ files })
})
