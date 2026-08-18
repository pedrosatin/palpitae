import { Hono } from 'hono'
import type { AppContext } from '../types'
import { findEntry } from './articles'

/**
 * Radar de competições para o dashboard admin (`/admin/oportunidades`) —
 * responde "qual campeonato vale a pena incorporar ao Palpitae?" cruzando três
 * sinais:
 *
 *   oferta    → o que está em andamento agora (API-Football, snapshot diário)
 *   interesse → pageviews da pt.wikipedia (proxy de audiência brasileira)
 *   demanda   → grupos já criados no Palpitae para aquela competição (D1)
 *
 * Lê só o D1: as APIs externas são consultadas pelo cron (`radar/sync.ts`).
 * Montado dentro do metricsRouter, então herda `requireAuth` + gate de
 * ADMIN_EMAIL. Endpoint de leitura — sem logEvent, conforme a regra.
 */

const MAX_DAYS = 90
const TREND_WINDOW = 7

type RadarRow = {
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

type DailyRow = {
  radar_id: string
  day: string
  matches_today: number
  pageviews: number | null
}

/** Status da temporada em relação a hoje, derivado da janela do provider. */
function seasonStatus(startsOn: string | null, endsOn: string | null, today: string): string {
  if (startsOn && today < startsOn) return 'upcoming'
  if (endsOn && today > endsOn) return 'finished'
  return 'ongoing'
}

/** Média inteira de uma lista, ou null se não houver amostra. */
function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, n) => sum + n, 0) / values.length)
}

/**
 * Variação percentual entre a média dos últimos `TREND_WINDOW` dias e a dos
 * `TREND_WINDOW` anteriores. Null quando falta um dos lados — competição recém
 * mapeada não tem base de comparação, e inventar 0% esconderia isso.
 */
function trend(series: { day: string; pageviews: number | null }[]): number | null {
  const withData = series.filter((p) => p.pageviews !== null)
  if (withData.length < TREND_WINDOW * 2) return null

  const recent = average(withData.slice(-TREND_WINDOW).map((p) => p.pageviews as number))
  const previous = average(
    withData.slice(-TREND_WINDOW * 2, -TREND_WINDOW).map((p) => p.pageviews as number),
  )
  if (recent === null || previous === null || previous === 0) return null
  return Math.round(((recent - previous) / previous) * 100)
}

export const radarRouter = new Hono<AppContext>()

radarRouter.get('/', async (c) => {
  const raw = Number(c.req.query('days') ?? '30')
  const days = Number.isInteger(raw) && raw >= 1 ? Math.min(raw, MAX_DAYS) : 30
  const db = c.env.DB
  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

  const [competitions, daily, internalGroups, lastSync] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, country, type, logo_url, season, starts_on, ends_on, wiki_article
           FROM competition_radar
          WHERE is_current = 1
          ORDER BY name`,
      )
      .all<RadarRow>(),
    db
      .prepare(
        `SELECT radar_id, day, matches_today, pageviews
           FROM competition_radar_daily d
           JOIN competition_radar r ON r.id = d.radar_id
          WHERE r.is_current = 1 AND d.day >= ?
          ORDER BY d.day ASC`,
      )
      .bind(since)
      .all<DailyRow>(),
    // Demanda interna: grupos ativos por competição já suportada.
    db
      .prepare(
        `SELECT c.slug AS slug, COUNT(*) AS groups
           FROM groups g JOIN competitions c ON c.id = g.competition_id
          WHERE g.deleted_at IS NULL
          GROUP BY c.slug`,
      )
      .all<{ slug: string; groups: number }>(),
    // Frescor do snapshot: radar velho = cron parado, e a dashboard precisa
    // dizer isso em vez de mostrar números defasados como se fossem de hoje.
    db.prepare(`SELECT MAX(last_seen_at) AS last_sync FROM competition_radar`).first<{
      last_sync: string | null
    }>(),
  ])

  const seriesByRadar = new Map<string, DailyRow[]>()
  for (const row of daily.results) {
    const list = seriesByRadar.get(row.radar_id) ?? []
    list.push(row)
    seriesByRadar.set(row.radar_id, list)
  }

  const groupsBySlug = internalGroups.results

  const items = competitions.results.map((comp) => {
    const series = seriesByRadar.get(comp.id) ?? []
    const pageviews = series.filter((p) => p.pageviews !== null).map((p) => p.pageviews as number)

    // Suportado = existe competição no Palpitae cujo slug casa com o prefixo
    // curado (o slug carrega o ano, ex. `...-serie-a-2026`).
    const entry = findEntry(comp.country ?? '', comp.name)
    const supportedSlugs = entry?.palpitaeSlug
      ? groupsBySlug.filter((g) => g.slug.startsWith(entry.palpitaeSlug as string))
      : []

    return {
      id: comp.id,
      name: comp.name,
      country: comp.country,
      type: comp.type,
      logoUrl: comp.logo_url,
      season: comp.season,
      startsOn: comp.starts_on,
      endsOn: comp.ends_on,
      status: seasonStatus(comp.starts_on, comp.ends_on, today),
      wikiArticle: comp.wiki_article,
      matchesInPeriod: series.reduce((sum, p) => sum + (p.matches_today ?? 0), 0),
      matchesToday: series.find((p) => p.day === today)?.matches_today ?? 0,
      pageviewsAvg: average(pageviews),
      pageviewsTrend: trend(series.map((p) => ({ day: p.day, pageviews: p.pageviews }))),
      pageviewsSeries: series.map((p) => ({ day: p.day, views: p.pageviews })),
      supported: supportedSlugs.length > 0,
      internalGroups: supportedSlugs.reduce((sum, g) => sum + Number(g.groups), 0),
    }
  })

  // Maior interesse primeiro; sem sinal de interesse vai pro fim (é justamente
  // a fila de "mapear artigo da Wikipédia").
  items.sort((a, b) => (b.pageviewsAvg ?? -1) - (a.pageviewsAvg ?? -1))

  return c.json({ days, lastSync: lastSync?.last_sync ?? null, items })
})
