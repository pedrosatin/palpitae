import type { D1Database } from '@cloudflare/workers-types'
import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { logEvent, logRequestPerf } from '../observability'
import type { AppContext } from '../types'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

const router = new Hono<AppContext>()

/**
 * Picks a Cache-Control header for a /matches response based on what it
 * actually contains:
 *   - all matches finished → 24h (terminal, scores never change)
 *   - any match live       → 30s (scores update during the game)
 *   - otherwise            → 60s (scheduled matches flip to live at kickoff;
 *                                 a short TTL keeps that transition fresh)
 * An empty list also gets the short TTL so it repopulates quickly.
 */
function matchesCacheControl(matches: { status: string }[]): string {
  if (matches.length > 0 && matches.every((m) => m.status === 'finished')) {
    return 'public, max-age=86400'
  }
  if (matches.some((m) => m.status === 'live')) {
    return 'public, max-age=30'
  }
  return 'public, max-age=60'
}

/**
 * GET /matches?competition_id=xxx[&round=xxx][&status=scheduled|live|finished]
 *
 * Returns matches for a competition with team info.
 * Optional filters: round (e.g. "1"), status.
 *
 * Response:
 * {
 *   matches: [
 *     {
 *       id, start_time, status, home_score, away_score, phase, round,
 *       home_team_id, home_team_name, home_team_short_name, home_team_logo,
 *       away_team_id, away_team_name, away_team_short_name, away_team_logo
 *     }
 *   ]
 * }
 */
router.get('/', async (c) => {
  const startedAt = Date.now()
  const competitionId = c.req.query('competition_id')
  const round = c.req.query('round')
  const status = c.req.query('status')

  if (!competitionId) {
    return c.json({ error: 'competition_id é obrigatório' }, 400)
  }

  const validStatuses = ['scheduled', 'live', 'finished']
  if (status && !validStatuses.includes(status)) {
    return c.json({ error: `status inválido. Use: ${validStatuses.join(', ')}` }, 400)
  }

  const db = c.env.DB

  // Edge cache (Cache API) — shared across users within the same Cloudflare
  // colo, at no extra cost. Best-effort: per-colo and may be evicted. A hit
  // returns without touching D1, so it saves rows read. `caches` is undefined
  // outside the Workers runtime (e.g. node tests), hence the guard.
  // `caches.default` is a Cloudflare extension; cast past the lib.dom
  // CacheStorage type, which only knows the standard open()/match() surface.
  const cache =
    typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : undefined
  const cacheKey = new Request(c.req.url)
  if (cache) {
    const cached = await cache.match(cacheKey)
    if (cached) {
      logEvent(c.env.AE, 'matches_cache', { blobs: ['hit', competitionId] })
      return cached
    }
  }

  let query = `
    SELECT
      m.id,
      m.start_time,
      m.status,
      m.home_score,
      m.away_score,
      m.phase,
      m.round,
      m.group_name,
      ht.id         AS home_team_id,
      ht.name       AS home_team_name,
      ht.short_name AS home_team_short_name,
      ht.logo_url   AS home_team_logo,
      at.id         AS away_team_id,
      at.name       AS away_team_name,
      at.short_name AS away_team_short_name,
      at.logo_url   AS away_team_logo
    FROM matches m
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    WHERE m.competition_id = ?
  `

  const params: (string | number)[] = [competitionId]

  if (round) {
    query += ` AND m.round = ?`
    params.push(round)
  }

  if (status) {
    query += ` AND m.status = ?`
    params.push(status)
  }

  query += ` ORDER BY m.group_name ASC NULLS LAST, m.start_time ASC`

  // default_round only makes sense for the unfiltered full list. With ?round or
  // ?status active the response is a subset, so a global default_round would be
  // unrelated to the matches actually returned — we skip computing/returning it.
  const hasFilters = Boolean(round) || Boolean(status)

  try {
    const dbStartedAt = Date.now()

    let result: { results: { status: string }[] }
    let defaultRound: string | null = null

    if (hasFilters) {
      result = await db.prepare(query).bind(...(params as string[])).all<{ status: string }>()
    } else {
      const nowIso = new Date().toISOString()
      // One D1 round-trip for the full list plus the two queries that pick the
      // default round: the first round still open (earliest with a match in the
      // future), falling back to the most recent match chronologically. The
      // fallback is its own query rather than result.results.at(-1) because the
      // main list is ordered by group_name first — knockout matches (NULL group)
      // sort last and would otherwise hijack the fallback.
      const batchResults = await db.batch([
        db.prepare(query).bind(...(params as string[])),
        db
          .prepare(
            `SELECT round FROM matches
             WHERE competition_id = ?
             GROUP BY round
             HAVING MAX(start_time) > ?
             ORDER BY MAX(start_time) ASC
             LIMIT 1`,
          )
          .bind(competitionId, nowIso),
        db
          .prepare(
            `SELECT round FROM matches
             WHERE competition_id = ?
             ORDER BY start_time DESC
             LIMIT 1`,
          )
          .bind(competitionId),
      ])

      result = batchResults[0] as { results: { status: string }[] }
      const activeRound = (batchResults[1].results as { round?: string }[])[0]?.round
      const lastRound = (batchResults[2].results as { round?: string }[])[0]?.round
      defaultRound = activeRound ?? lastRound ?? null
    }

    const dbMs = Date.now() - dbStartedAt

    // Cache strategy is derived from the RESPONSE CONTENTS, not the query param:
    // a list is only safe to cache long-term when every match is 'finished' (a
    // terminal state). Any list with a live/not-yet-finished match uses a short
    // TTL, so a match that goes live → finished doesn't keep serving its stale
    // "ao vivo" snapshot for the whole window.
    //
    // The same Cache-Control drives two layers: the browser cache (per user)
    // and the edge Cache API below (shared per colo). Note: a Worker-generated
    // response is NOT edge-cached automatically by Cache-Control — only the
    // explicit caches.default.put() does that. The Worker still runs on every
    // request, but a cache hit (above) skips the D1 query.
    const response = c.json({
      matches: result.results,
      ...(hasFilters ? {} : { default_round: defaultRound }),
    })
    response.headers.set('Cache-Control', matchesCacheControl(result.results))

    if (cache) {
      // clone(): a response body can only be consumed once — the cache keeps
      // its own copy while we still return the original to the caller.
      c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
    }

    // Background result sync: fire-and-forget after response is sent.
    // Checks for matches that started >3h ago but aren't finished in our DB.
    // At most 1 API call per competition per trigger — naturally self-cooling
    // because once a match is 'finished' + scored_at is set, it never triggers again.
    const apiKey = c.env.FOOTBALL_API_KEY
    if (apiKey) {
      c.executionCtx.waitUntil(maybeSyncResults(competitionId, db, apiKey))
    }

    logEvent(c.env.AE, 'matches_cache', { blobs: ['miss', competitionId] })

    logRequestPerf('GET /matches', {
      status: 200,
      totalMs: Date.now() - startedAt,
      dbMs,
      rows: result.results.length,
      extra: {
        competition_id: competitionId,
        has_round_filter: Boolean(round),
        status_filter: status ?? 'all',
        scheduled_result_sync: Boolean(apiKey),
      },
    })

    return response
  } catch (error) {
    console.error('Erro ao buscar jogos:', error)
    return c.json({ error: 'Erro ao carregar jogos' }, 500)
  }
})

async function maybeSyncResults(competitionId: string, db: D1Database, apiKey: string): Promise<void> {
  const startedAt = Date.now()
  try {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()

    const localMatches = await db
      .prepare(`SELECT COUNT(*) AS count FROM matches WHERE competition_id = ?`)
      .bind(competitionId)
      .first<{ count: number }>()

    const needsInitialSync = (localMatches?.count ?? 0) === 0

    const pending = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM matches
         WHERE competition_id = ? AND start_time <= ? AND status != 'finished'`,
      )
      .bind(competitionId, threeHoursAgo)
      .first<{ count: number }>()

    const needsSync = (pending?.count ?? 0) > 0

    // Also check for finished matches not yet scored (e.g. from a previous sync)
    const unscoredCheck = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM matches
         WHERE competition_id = ? AND status = 'finished' AND scored_at IS NULL
           AND home_score IS NOT NULL AND away_score IS NOT NULL`,
      )
      .bind(competitionId)
      .first<{ count: number }>()

    const needsScoring = (unscoredCheck?.count ?? 0) > 0

    if (!needsInitialSync && !needsSync && !needsScoring) return

    if (needsInitialSync || needsSync) {
      const competition = await db
        .prepare(`SELECT external_id, provider, season FROM competitions WHERE id = ?`)
        .bind(competitionId)
        .first<{ external_id: string; provider: string; season: string }>()

      if (!competition || competition.provider !== 'football-data') return

      await syncFixtures({
        competitionCode: competition.external_id,
        season: Number(competition.season),
        apiKey,
        db,
      })
    }

    await scoreUnprocessedMatches(competitionId, db)

    console.info(
      '[perf]',
      JSON.stringify({
        route: 'waitUntil maybeSyncResults',
        competition_id: competitionId,
        total_ms: Date.now() - startedAt,
        initial_sync: needsInitialSync,
        result_sync: needsSync,
        scoring: needsScoring,
      }),
    )
  } catch (err) {
    console.error('Background result sync falhou:', err)
  }
}

/**
 * POST /matches/sync
 *
 * Syncs fixtures from football-data.org into D1.
 * Upserts competition, teams, and matches — safe to call multiple times.
 *
 * Body: { competition: string, season: number, matchday?: number }
 *
 * Example for Copa do Mundo 2026 - matchday 1:
 *   { "competition": "WC", "season": 2026, "matchday": 1 }
 *
 * Example for all fixtures in a competition:
 *   { "competition": "WC", "season": 2026 }
 *
 * Requires authentication.
 */
router.post('/sync', requireAuth, async (c) => {
  let body: { competition?: string; season?: number; matchday?: number }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Body JSON inválido' }, 400)
  }

  const { competition, season, matchday } = body

  if (!competition || !season) {
    return c.json({ error: 'competition e season são obrigatórios' }, 400)
  }

  if (typeof season !== 'number') {
    return c.json({ error: 'season deve ser um número' }, 400)
  }

  const apiKey = c.env.FOOTBALL_API_KEY
  if (!apiKey) {
    return c.json({ error: 'FOOTBALL_API_KEY não configurada no servidor' }, 500)
  }

  try {
    const result = await syncFixtures({ competitionCode: competition, season, matchday, apiKey, db: c.env.DB })
    return c.json({ ok: true, synced: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('Erro no sync:', error)
    return c.json({ error: `Erro ao sincronizar: ${message}` }, 500)
  }
})

export { router as matchesRouter }
