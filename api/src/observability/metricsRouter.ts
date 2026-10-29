import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { radarRouter } from '../radar/router'
import type { AppContext } from '../types'
import { runAeSql } from './aeSql'

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

type AeRow = Record<string, unknown>

/** Dia UTC `YYYY-MM-DD` (também valida o `from`/`to` do arquivo frio). */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Teto de linhas (dia × campeonato) da série diária; ver `groupsDailyTruncated`. */
const GROUP_DAILY_LIMIT = 5000

/** UUID de competição; qualquer outra coisa em blob de competição é lixo legado. */
const COMPETITION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Id válido ou vazio ("sem liga"): nunca devolve texto livre de blob antigo. */
function competitionIdOrEmpty(raw: unknown): string {
  const id = String(raw ?? '')
  return COMPETITION_ID_RE.test(id) ? id : ''
}

/**
 * Origem de um `football_api_error` pela forma posicional (docs/observability.md):
 * endpoint → [sync_endpoint, msg]; descoberta → [fixture_discovery, comp, msg];
 * poller → [comp, round, msg].
 */
function footballApiErrorOrigin(
  blob2: string,
  blob3: string,
): {
  context: 'sync_endpoint' | 'fixture_discovery' | 'poller'
  competition_id: string
} {
  if (blob2 === 'sync_endpoint') return { context: 'sync_endpoint', competition_id: '' }
  if (blob2 === 'fixture_discovery') {
    return { context: 'fixture_discovery', competition_id: competitionIdOrEmpty(blob3) }
  }
  return { context: 'poller', competition_id: competitionIdOrEmpty(blob2) }
}

/**
 * Operação dos provedores (ESPN e football-data) a partir do Analytics Engine:
 * tentativas HTTP, erros de sync e fallback de resultados, por processo,
 * provedor e campeonato. Só agregados e UUIDs de competição.
 *
 * Contagens HTTP: `attempts` = SUM(_sample_interval * double2). double2 é o
 * peso do evento (1 para falha, 10 para sucesso amostrado a 10%), então erro
 * é contagem e sucesso é estimativa. `events` = SUM(_sample_interval) é o que
 * foi de fato registrado. `httpFirstSeenAt` (sem filtro de janela) separa
 * "nenhuma tentativa" de "instrumentação ainda não publicada".
 *
 * Posições: provider_http_attempt → blob2 provider, blob3 competition_id,
 * blob4 status, blob5 contexto, double1 duration_ms, double2 peso;
 * match_results_fallback → blob2 competition_id; sucesso: double1 atualizados,
 * double2 pulados; falha: blob3 = mensagem.
 */
metricsRouter.get('/ops', async (c) => {
  if (!c.env.CF_ACCOUNT_ID || !c.env.AE_SQL_TOKEN) {
    return c.json({ error: 'SQL API do Analytics Engine não configurada' }, 503)
  }

  const days = parseDays(c.req.query('days'))
  const since = `timestamp > NOW() - INTERVAL '${days}' DAY`
  const httpWeight = '(_sample_interval * double2)'
  const httpMeasures =
    `SUM(${httpWeight}) AS attempts, SUM(_sample_interval) AS events, ` +
    `SUM(double1 * ${httpWeight}) / SUM(${httpWeight}) AS avg_ms, MAX(double1) AS max_ms`

  try {
    const [
      httpByProvider,
      httpByCompetition,
      httpFirstSeen,
      apiErrors,
      fallbackRuns,
      fallbackFailures,
    ] = await Promise.all([
      runAeSql(
        c.env,
        `SELECT blob2 AS provider, blob5 AS context, blob4 AS status, ${httpMeasures} ` +
          `FROM ${DATASET} WHERE blob1 = 'provider_http_attempt' AND ${since} ` +
          `GROUP BY provider, context, status ORDER BY attempts DESC LIMIT 200`,
      ),
      runAeSql(
        c.env,
        `SELECT blob3 AS competition_id, blob2 AS provider, blob4 AS status, ${httpMeasures} ` +
          `FROM ${DATASET} WHERE blob1 = 'provider_http_attempt' AND ${since} ` +
          `GROUP BY competition_id, provider, status ORDER BY attempts DESC LIMIT 1000`,
      ),
      runAeSql(
        c.env,
        `SELECT MIN(timestamp) AS first_at FROM ${DATASET} WHERE blob1 = 'provider_http_attempt'`,
      ),
      runAeSql(
        c.env,
        `SELECT blob2, blob3, SUM(_sample_interval) AS count ` +
          `FROM ${DATASET} WHERE blob1 = 'football_api_error' AND ${since} ` +
          `GROUP BY blob2, blob3 ORDER BY count DESC LIMIT 500`,
      ),
      runAeSql(
        c.env,
        `SELECT blob2 AS competition_id, SUM(_sample_interval) AS runs, ` +
          `SUM(double1 * _sample_interval) AS updated, SUM(double2 * _sample_interval) AS skipped ` +
          `FROM ${DATASET} WHERE blob1 = 'match_results_fallback' AND blob3 = '' AND ${since} ` +
          `GROUP BY competition_id ORDER BY runs DESC LIMIT 500`,
      ),
      runAeSql(
        c.env,
        `SELECT blob2 AS competition_id, SUM(_sample_interval) AS failures ` +
          `FROM ${DATASET} WHERE blob1 = 'match_results_fallback' AND blob3 != '' AND ${since} ` +
          `GROUP BY competition_id ORDER BY failures DESC LIMIT 500`,
      ),
    ])

    const sumBy = (rows: AeRow[], key: (r: AeRow) => string, value: string) => {
      const out = new Map<string, number>()
      for (const r of rows) out.set(key(r), (out.get(key(r)) ?? 0) + Number(r[value] ?? 0))
      return out
    }
    const errorsByOrigin = new Map<
      string,
      { context: string; competition_id: string; count: number }
    >()
    for (const r of apiErrors) {
      const origin = footballApiErrorOrigin(String(r.blob2 ?? ''), String(r.blob3 ?? ''))
      const key = `${origin.context}|${origin.competition_id}`
      const entry = errorsByOrigin.get(key) ?? { ...origin, count: 0 }
      entry.count += Number(r.count ?? 0)
      errorsByOrigin.set(key, entry)
    }

    const failuresByComp = sumBy(
      fallbackFailures,
      (r) => competitionIdOrEmpty(r.competition_id),
      'failures',
    )
    const fallbackByComp = new Map<
      string,
      { competition_id: string; runs: number; updated: number; skipped: number; failures: number }
    >()
    const fallbackEntry = (id: string) => {
      const entry = fallbackByComp.get(id) ?? {
        competition_id: id,
        runs: 0,
        updated: 0,
        skipped: 0,
        failures: 0,
      }
      fallbackByComp.set(id, entry)
      return entry
    }
    for (const r of fallbackRuns) {
      const entry = fallbackEntry(competitionIdOrEmpty(r.competition_id))
      entry.runs += Number(r.runs ?? 0)
      entry.updated += Number(r.updated ?? 0)
      entry.skipped += Number(r.skipped ?? 0)
    }
    for (const [id, failures] of failuresByComp) fallbackEntry(id).failures += failures

    const mapHttp = (r: AeRow) => ({
      provider: String(r.provider ?? ''),
      status: String(r.status ?? ''),
      attempts: Number(r.attempts ?? 0),
      events: Number(r.events ?? 0),
      avg_ms: Number(r.avg_ms ?? 0),
      max_ms: Number(r.max_ms ?? 0),
    })

    return c.json({
      days,
      httpFirstSeenAt: (httpFirstSeen[0]?.first_at as string | null | undefined) ?? null,
      httpByProvider: httpByProvider.map((r) => ({
        ...mapHttp(r),
        context: String(r.context ?? ''),
      })),
      httpByCompetition: httpByCompetition.map((r) => ({
        ...mapHttp(r),
        competition_id: competitionIdOrEmpty(r.competition_id),
      })),
      apiErrors: [...errorsByOrigin.values()].sort((a, b) => b.count - a.count),
      fallback: [...fallbackByComp.values()].sort(
        (a, b) => b.failures - a.failures || b.runs - a.runs,
      ),
    })
  } catch (err) {
    console.error('[metrics] falha na SQL API (ops):', err)
    return c.json({ error: 'Falha ao consultar o Analytics Engine' }, 502)
  }
})

/**
 * Criações de grupo e atividade de palpites por campeonato no período, a
 * partir do Analytics Engine. Endpoint próprio (como `/ops`) para que uma
 * falha aqui não derrube a página e para o front novo conviver com uma API
 * ainda sem a rota.
 *
 * Posições: group_created → blob3 competition_id; prediction_saved → blob6
 * competition_id (só em eventos gravados depois do deploy do enriquecimento),
 * double1 = nº de palpites do evento. Evento antigo sem a dimensão chega com
 * blob6 vazio e vira a linha "sem liga" (`competition_id: ''`); não há backfill.
 *
 * Contagens ponderadas pelo sampling: eventos = SUM(_sample_interval),
 * palpites = SUM(double1 * _sample_interval). A SQL API não faz join com o D1:
 * o Worker resolve nome e temporada dos ids que vieram do AE. Id sem linha em
 * `competitions` sai com `name` e `season` nulos. `predictionsDimensionSince`
 * (sem filtro de janela) é o primeiro evento com a dimensão, para o painel
 * distinguir "sem palpites" de "dimensão ainda não coletada".
 *
 * `groupsDaily` é a série de criações de grupo por dia (UTC, `YYYY-MM-DD`) ×
 * competition_id, com o mesmo SUM(_sample_interval). Só existem linhas de dias
 * com criação: o preenchimento dos dias zerados é do cliente. A consulta tem
 * teto de GROUP_DAILY_LIMIT linhas (ordem do dia mais recente para o mais
 * antigo); se bater no teto, `groupsDailyTruncated` é true e o painel avisa em
 * vez de mostrar uma série cortada como completa. O payload não carrega nome
 * de grupo, código de convite nem user_hash: só ids de campeonato (UUID
 * validado), dia e contagem; nome e temporada saem de `competitions`.
 */
metricsRouter.get('/competition-activity', async (c) => {
  if (!c.env.CF_ACCOUNT_ID || !c.env.AE_SQL_TOKEN) {
    return c.json({ error: 'SQL API do Analytics Engine não configurada' }, 503)
  }

  const days = parseDays(c.req.query('days'))
  const since = `timestamp > NOW() - INTERVAL '${days}' DAY`

  try {
    const [groupsCreated, predictionsSaved, dimensionSince, groupsDailyRows] = await Promise.all([
      runAeSql(
        c.env,
        `SELECT blob3 AS competition_id, SUM(_sample_interval) AS groups ` +
          `FROM ${DATASET} WHERE blob1 = 'group_created' AND ${since} ` +
          `GROUP BY competition_id ORDER BY groups DESC LIMIT 500`,
      ),
      runAeSql(
        c.env,
        `SELECT blob6 AS competition_id, SUM(_sample_interval) AS saves, ` +
          `SUM(double1 * _sample_interval) AS predictions ` +
          `FROM ${DATASET} WHERE blob1 = 'prediction_saved' AND ${since} ` +
          `GROUP BY competition_id ORDER BY predictions DESC LIMIT 500`,
      ),
      runAeSql(
        c.env,
        `SELECT MIN(timestamp) AS first_at FROM ${DATASET} ` +
          `WHERE blob1 = 'prediction_saved' AND blob6 != ''`,
      ),
      runAeSql(
        c.env,
        `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, ` +
          `blob3 AS competition_id, SUM(_sample_interval) AS groups ` +
          `FROM ${DATASET} WHERE blob1 = 'group_created' AND ${since} ` +
          `GROUP BY day, competition_id ORDER BY day DESC LIMIT ${GROUP_DAILY_LIMIT}`,
      ),
    ])

    // Dia × campeonato: normaliza o dia, descarta linha sem dia válido e soma
    // ids inválidos em "sem liga" (a mesma chave pode repetir após o saneamento).
    const dailyByKey = new Map<
      string,
      { day: string; competition_id: string; groups_created: number }
    >()
    for (const r of groupsDailyRows) {
      const day = String(r.day ?? '').slice(0, 10)
      const groups = Number(r.groups ?? 0)
      if (!DAY_RE.test(day) || !Number.isFinite(groups)) continue
      const competition_id = competitionIdOrEmpty(r.competition_id)
      const key = `${day}\u0000${competition_id}`
      const row = dailyByKey.get(key) ?? { day, competition_id, groups_created: 0 }
      row.groups_created += groups
      dailyByKey.set(key, row)
    }
    const groupsDaily = [...dailyByKey.values()].sort(
      (a, b) => a.day.localeCompare(b.day) || a.competition_id.localeCompare(b.competition_id),
    )

    const byCompetition = new Map<
      string,
      {
        competition_id: string
        groups_created: number
        prediction_saves: number
        predictions: number
      }
    >()
    const entry = (id: string) => {
      const row = byCompetition.get(id) ?? {
        competition_id: id,
        groups_created: 0,
        prediction_saves: 0,
        predictions: 0,
      }
      byCompetition.set(id, row)
      return row
    }
    for (const r of groupsCreated) {
      entry(competitionIdOrEmpty(r.competition_id)).groups_created += Number(r.groups ?? 0)
    }
    for (const r of predictionsSaved) {
      const row = entry(competitionIdOrEmpty(r.competition_id))
      row.prediction_saves += Number(r.saves ?? 0)
      row.predictions += Number(r.predictions ?? 0)
    }

    // Id que só aparece na série diária (evento entre as consultas paralelas)
    // entra no total com o que a própria série soma, para a UI sempre achar o nome.
    for (const d of groupsDaily) {
      if (!byCompetition.has(d.competition_id))
        entry(d.competition_id).groups_created += d.groups_created
    }

    const ids = [...byCompetition.keys()].filter((id) => id !== '')
    const known = new Map<string, { name: string; season: string | null }>()
    if (ids.length > 0) {
      const found = await c.env.DB.prepare(
        `SELECT id, name, season FROM competitions WHERE id IN (SELECT value FROM json_each(?))`,
      )
        .bind(JSON.stringify(ids))
        .all<{ id: string; name: string; season: string | null }>()
      for (const r of found.results) known.set(r.id, { name: r.name, season: r.season })
    }

    const competitions = [...byCompetition.values()]
      .map((row) => ({
        ...row,
        name: known.get(row.competition_id)?.name ?? null,
        season: known.get(row.competition_id)?.season ?? null,
      }))
      .sort(
        (a, b) =>
          b.groups_created - a.groups_created ||
          b.predictions - a.predictions ||
          a.competition_id.localeCompare(b.competition_id),
      )

    return c.json({
      days,
      predictionsDimensionSince: (dimensionSince[0]?.first_at as string | null | undefined) ?? null,
      competitions,
      groupsDaily,
      groupsDailyTruncated: groupsDailyRows.length >= GROUP_DAILY_LIMIT,
    })
  } catch (err) {
    console.error('[metrics] falha ao montar atividade por campeonato:', err)
    return c.json({ error: 'Falha ao consultar a atividade por campeonato' }, 502)
  }
})

/** Janela de "grupo ativo" no snapshot por campeonato (palpite recente). */
const ACTIVE_GROUP_DAYS = 14

/** Tolerância após o kickoff antes de um jogo sem placar contar como atrasado. */
const OVERDUE_RESULT_HOURS = 3

/**
 * KPIs de negócio a partir do D1 (estado real, não amostrado) — complementa o
 * /overview (Analytics Engine, eventos). "Ativos" aqui é lifetime (toda a
 * base), não a janela de `days`; só contagens "criados no período" respeitam
 * `days`. Ignora grupos soft-deleted (deleted_at) em todas as contagens que
 * passam por grupo, inclusive usuários em grupo e usuários que palpitaram.
 *
 * `competitions` é o snapshot por temporada: TODAS as linhas de competitions,
 * inclusive as sem grupo (contagens zeradas). Cada métrica vem de uma
 * subquery agregada por competition_id antes do LEFT JOIN — juntar grupos,
 * membros e palpites numa query só multiplicaria as contagens.
 *   groups_current    → grupos não excluídos
 *   members           → usuários distintos nesses grupos
 *   active_groups_14d → grupos com palpite salvo/editado (updated_at) nos
 *                       últimos ACTIVE_GROUP_DAYS dias, relógio UTC do D1
 *   overdue_no_score  → jogos scheduled/live, não adiados, sem placar completo
 *                       (home_score ou away_score nulo) e com início há mais de
 *                       OVERDUE_RESULT_HOURS horas: buraco de feed
 *   finished_unscored → jogos finished com scored_at nulo: backlog de pontuação
 *                       (inclui finished sem placar, que o scoring não alcança)
 *                       Os dois contam só jogos, nunca ids nem times.
 *
 * `topCompetitions` continua no payload para o front antigo (deploys de API e
 * web não são atômicos); o front novo usa `competitions`.
 */
metricsRouter.get('/business', async (c) => {
  const days = parseDays(c.req.query('days'))
  const db = c.env.DB

  const [rollupCounts, groupMembership, competitions] = await Promise.all([
    db
      .prepare(
        `SELECT
          (SELECT COUNT(DISTINCT gm.user_id) FROM group_members gm
            JOIN groups g ON g.id = gm.group_id AND g.deleted_at IS NULL) AS usersInGroup,
          (SELECT COUNT(DISTINCT p.user_id) FROM predictions p
            JOIN groups g ON g.id = p.group_id AND g.deleted_at IS NULL) AS usersWhoPredicted,
          (SELECT COUNT(*) FROM users) AS usersTotal,
          (SELECT COUNT(*) FROM users WHERE created_at > datetime('now', ?)) AS usersCreated,
          (SELECT COUNT(*) FROM groups WHERE deleted_at IS NULL AND created_at > datetime('now', ?)) AS groupsCreated`,
      )
      .bind(`-${days} days`, `-${days} days`)
      .first<{
        usersInGroup: number
        usersWhoPredicted: number
        usersTotal: number
        usersCreated: number
        groupsCreated: number
      }>(),
    // Quantos grupos cada usuário integra — distribuição (média + mediana aprox via percentil).
    db
      .prepare(
        `SELECT gm.user_id AS user_id, COUNT(*) AS groups ` +
          `FROM group_members gm ` +
          `JOIN groups g ON g.id = gm.group_id AND g.deleted_at IS NULL ` +
          `GROUP BY gm.user_id`,
      )
      .all(),
    // Snapshot por temporada. datetime(p.updated_at) normaliza o ISO com "Z"
    // gravado pelo app para o formato do datetime('now') antes de comparar;
    // datetime(m.start_time) faz o mesmo (aceita "Z", milissegundos e offset).
    db
      .prepare(
        `SELECT c.id AS id, c.name AS name, c.slug AS slug, c.season AS season, ` +
          `c.provider AS provider, c.visibility AS visibility, c.status AS status, ` +
          `COALESCE(gc.groups_current, 0) AS groups_current, ` +
          `COALESCE(mc.members, 0) AS members, ` +
          `COALESCE(ac.active_groups_14d, 0) AS active_groups_14d, ` +
          `COALESCE(mh.overdue_no_score, 0) AS overdue_no_score, ` +
          `COALESCE(mh.finished_unscored, 0) AS finished_unscored ` +
          `FROM competitions c ` +
          `LEFT JOIN (SELECT competition_id, COUNT(*) AS groups_current FROM groups ` +
          `WHERE deleted_at IS NULL GROUP BY competition_id) gc ON gc.competition_id = c.id ` +
          `LEFT JOIN (SELECT g.competition_id AS competition_id, COUNT(DISTINCT gm.user_id) AS members ` +
          `FROM group_members gm JOIN groups g ON g.id = gm.group_id AND g.deleted_at IS NULL ` +
          `GROUP BY g.competition_id) mc ON mc.competition_id = c.id ` +
          `LEFT JOIN (SELECT g.competition_id AS competition_id, COUNT(DISTINCT p.group_id) AS active_groups_14d ` +
          `FROM predictions p JOIN groups g ON g.id = p.group_id AND g.deleted_at IS NULL ` +
          `WHERE datetime(p.updated_at) > datetime('now', ?) ` +
          `GROUP BY g.competition_id) ac ON ac.competition_id = c.id ` +
          `LEFT JOIN (SELECT competition_id, ` +
          `SUM(CASE WHEN status IN ('scheduled', 'live') AND postponed = 0 ` +
          `AND (home_score IS NULL OR away_score IS NULL) ` +
          `AND datetime(start_time) <= datetime('now', ?) THEN 1 ELSE 0 END) AS overdue_no_score, ` +
          `SUM(CASE WHEN status = 'finished' AND scored_at IS NULL THEN 1 ELSE 0 END) AS finished_unscored ` +
          `FROM matches GROUP BY competition_id) mh ON mh.competition_id = c.id ` +
          `ORDER BY groups_current DESC, c.name ASC, c.season ASC, c.id ASC`,
      )
      .bind(`-${ACTIVE_GROUP_DAYS} days`, `-${OVERDUE_RESULT_HOURS} hours`)
      .all<{
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
      }>(),
  ])

  const groupCounts = (groupMembership.results as { user_id: string; groups: number }[])
    .map((r) => r.groups)
    .sort((a, b) => a - b)
  const avgGroupsPerUser =
    groupCounts.length > 0 ? groupCounts.reduce((s, n) => s + n, 0) / groupCounts.length : 0
  const medianGroupsPerUser =
    groupCounts.length > 0 ? groupCounts[Math.floor(groupCounts.length / 2)] : 0

  const competitionRows = competitions.results
  // Formato legado: só campeonatos com grupo, top 10 (já vem ordenado por grupos).
  const topCompetitions = competitionRows
    .filter((r) => r.groups_current > 0)
    .slice(0, 10)
    .map((r) => ({ competition: r.name, groups: r.groups_current }))

  return c.json({
    days,
    usersTotal: rollupCounts?.usersTotal ?? 0,
    usersInGroup: rollupCounts?.usersInGroup ?? 0,
    usersWhoPredicted: rollupCounts?.usersWhoPredicted ?? 0,
    usersCreatedInPeriod: rollupCounts?.usersCreated ?? 0,
    groupsCreatedInPeriod: rollupCounts?.groupsCreated ?? 0,
    avgGroupsPerUser,
    medianGroupsPerUser,
    activeGroupDays: ACTIVE_GROUP_DAYS,
    competitions: competitionRows,
    topCompetitions,
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
    if (!obj) return { day, obj: null, body: null }
    const body = await obj.text()
    return { day, obj, body }
  })

  const results = await Promise.all(fetchPromises)

  for (const { day, obj, body } of results) {
    if (!obj || body === null) continue
    filesRead++

    let dayTotal = 0

    let lastIndex = 0
    let nextIndex = body.indexOf('\n')
    while (nextIndex !== -1) {
      const line = body.substring(lastIndex, nextIndex)
      lastIndex = nextIndex + 1
      nextIndex = body.indexOf('\n', lastIndex)
      if (line.trim() !== '') {
        const row = JSON.parse(line) as Record<string, unknown>
        const weight = Number(row._sample_interval ?? 1)
        const type = String(row.blob1 ?? 'unknown')
        byType.set(type, (byType.get(type) ?? 0) + weight)
        dayTotal += weight
      }
    }
    const lastLine = body.substring(lastIndex)
    if (lastLine.trim() !== '') {
      const row = JSON.parse(lastLine) as Record<string, unknown>
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
