import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import { fetchCurrentLeagues, fetchMatchCountByLeague, type ProviderLeague } from './apiFootball'
import { findEntry, RADAR_COUNTRIES } from './articles'
import { fetchPageviews } from './wikipedia'

const PROVIDER = 'api-football'

/**
 * Dias de pageviews recoletados a cada execução. Não basta pegar "ontem": a
 * Wikimedia consolida com 1-2 dias de atraso, então a janela reprocessa os dias
 * que ainda estavam vazios. O upsert por (radar_id, day) torna isso idempotente.
 */
const PAGEVIEW_WINDOW_DAYS = 8

/** Requisições simultâneas à Wikimedia — educado com uma API pública e grátis. */
const PAGEVIEW_CONCURRENCY = 4

/** "YYYY-MM-DD" de `date` deslocado em `offsetDays` (UTC). */
function isoDay(date: Date, offsetDays = 0): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offsetDays),
  )
  return d.toISOString().slice(0, 10)
}

/** Id determinístico — reexecutar o cron atualiza a linha, nunca duplica. */
function radarId(externalId: string, season: string): string {
  return `${PROVIDER}:${externalId}:${season}`
}

/**
 * Uma liga interessa ao radar se está num país do recorte OU se foi mapeada
 * explicitamente na curadoria (uma competição de fora da lista de países pode
 * ter sido incluída de propósito).
 */
function isRelevant(league: ProviderLeague): boolean {
  return RADAR_COUNTRIES.has(league.country) || findEntry(league.country, league.name) !== undefined
}

/** Executa `tasks` com um teto de concorrência, ignorando as que falharem. */
async function runLimited(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  const queue = [...tasks]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      await task()
    }
  })
  await Promise.all(workers)
}

/**
 * Radar de competições — snapshot diário do que está acontecendo no futebol e
 * de quanto o público brasileiro se interessa por cada torneio. Insumo do
 * dashboard admin `/admin/oportunidades`, que responde "vale a pena incorporar
 * esta competição ao Palpitae?" (ex.: Libertadores, que o provider do produto
 * nem cobre).
 *
 * Não toca em nada do produto: escreve só em `competition_radar*`. Se falhar,
 * o snapshot do dia anterior continua valendo e a dashboard segue de pé.
 *
 * Custo por execução: 2 chamadas à API-Football (de 100/dia no plano grátis) e
 * ~1 chamada à Wikimedia por competição mapeada (API pública, sem quota).
 */
export async function syncRadar(
  db: D1Database,
  apiKey: string,
  ae?: AnalyticsEngineDataset,
  now: Date = new Date(),
): Promise<void> {
  const startedAt = Date.now()

  if (!apiKey) {
    console.warn('[radar] API_FOOTBALL_KEY ausente — sync ignorado.')
    logEvent(ae, 'radar_sync_run', { blobs: ['misconfig'], doubles: [0, 0, 0, 0] })
    return
  }

  let leagues: ProviderLeague[]
  let matchCounts: Map<string, number>
  const today = isoDay(now)

  try {
    // Sequencial de propósito: se o catálogo falhar (quota, chave inválida),
    // a segunda chamada seria desperdício de quota.
    leagues = (await fetchCurrentLeagues(apiKey)).filter(isRelevant)
    matchCounts = await fetchMatchCountByLeague(apiKey, today)
  } catch (err) {
    logError(ae, 'radar_sync_error', '[radar] Falha ao consultar a API-Football:', err, {
      blobs: ['api-football'],
    })
    logEvent(ae, 'radar_sync_run', {
      blobs: ['error'],
      doubles: [0, 0, 0, Date.now() - startedAt],
    })
    return
  }

  // `is_current` é reconstruído a cada execução: uma temporada que saiu do
  // catálogo tem que parar de aparecer como "acontecendo agora".
  const statements = [
    db.prepare(`UPDATE competition_radar SET is_current = 0 WHERE provider = ?`).bind(PROVIDER),
  ]

  for (const league of leagues) {
    const entry = findEntry(league.country, league.name)
    statements.push(
      db
        .prepare(
          `INSERT INTO competition_radar
             (id, sport, provider, external_id, name, country, type, logo_url,
              season, starts_on, ends_on, is_current, wiki_article)
           VALUES (?, 'football', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT (provider, external_id, season) DO UPDATE SET
             name = excluded.name,
             country = excluded.country,
             type = excluded.type,
             logo_url = excluded.logo_url,
             starts_on = excluded.starts_on,
             ends_on = excluded.ends_on,
             is_current = 1,
             wiki_article = excluded.wiki_article,
             last_seen_at = datetime('now')`,
        )
        .bind(
          radarId(league.externalId, league.season),
          PROVIDER,
          league.externalId,
          league.name,
          league.country,
          league.type,
          league.logoUrl,
          league.season,
          league.startsOn,
          league.endsOn,
          entry?.article ?? null,
        ),
      db
        .prepare(
          `INSERT INTO competition_radar_daily (radar_id, day, matches_today)
           VALUES (?, ?, ?)
           ON CONFLICT (radar_id, day) DO UPDATE SET matches_today = excluded.matches_today`,
        )
        .bind(
          radarId(league.externalId, league.season),
          today,
          matchCounts.get(league.externalId) ?? 0,
        ),
    )
  }

  await db.batch(statements)

  // Interesse do público — só para as competições com artigo curado.
  const from = isoDay(now, -PAGEVIEW_WINDOW_DAYS)
  const mapped = leagues.filter((l) => findEntry(l.country, l.name))
  const pageviewStatements: D1PreparedStatement[] = []
  let pageviewErrors = 0

  await runLimited(
    mapped.map((league) => async () => {
      const article = findEntry(league.country, league.name)?.article
      if (!article) return
      try {
        const byDay = await fetchPageviews(article, from, today)
        for (const [day, views] of byDay) {
          pageviewStatements.push(
            db
              .prepare(
                `INSERT INTO competition_radar_daily (radar_id, day, pageviews)
                 VALUES (?, ?, ?)
                 ON CONFLICT (radar_id, day) DO UPDATE SET pageviews = excluded.pageviews`,
              )
              .bind(radarId(league.externalId, league.season), day, views),
          )
        }
      } catch (err) {
        // Artigo com título errado não pode derrubar o resto do snapshot.
        pageviewErrors++
        logError(ae, 'radar_sync_error', `[radar] Pageviews falhou para "${article}":`, err, {
          blobs: ['wikipedia', article],
        })
      }
    }),
    PAGEVIEW_CONCURRENCY,
  )

  if (pageviewStatements.length > 0) {
    const batches = []
    for (let i = 0; i < pageviewStatements.length; i += 100) {
      const chunk = pageviewStatements.slice(i, i + 100)
      batches.push(db.batch(chunk))
    }
    await Promise.all(batches)
  }

  logEvent(ae, 'radar_sync_run', {
    blobs: [pageviewErrors > 0 ? 'partial' : 'ok'],
    // competições, mapeadas, linhas de pageviews, duração
    doubles: [leagues.length, mapped.length, pageviewStatements.length, Date.now() - startedAt],
  })

  console.info(
    '[perf]',
    JSON.stringify({
      route: 'cron syncRadar',
      leagues: leagues.length,
      mapped: mapped.length,
      pageview_rows: pageviewStatements.length,
      total_ms: Date.now() - startedAt,
    }),
  )
}
