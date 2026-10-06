import type { D1Database } from '@cloudflare/workers-types'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { requireAuth } from '../auth/middleware'
import { logError, logEvent, logRequestPerf } from '../observability'
import type { AppContext } from '../types'
import { matchGoesToPenalties, parsePenaltyPhases } from './penalties'
import { roundLabel } from './rounds'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

const router = new Hono<AppContext>()

/**
 * Picks a Cache-Control header for a /matches response based on what it
 * actually contains:
 *   - all matches finished → 24h (terminal, scores never change)
 *   - otherwise            → 60s
 * An empty list also gets the short TTL so it repopulates quickly.
 */
function matchesCacheControl(matches: { status: string }[]): string {
  if (matches.length > 0 && matches.every((m) => m.status === 'finished')) {
    return 'public, max-age=86400'
  }
  return 'public, max-age=60'
}

// ---------------------------------------------------------------------------
// GET /matches handler
// ---------------------------------------------------------------------------

function buildMatchesQuery(competitionId: string, round?: string, status?: string) {
  let query = `
    SELECT
      m.id,
      m.start_time,
      m.status,
      m.postponed,
      m.locked_at,
      m.home_score,
      m.away_score,
      m.phase,
      m.round,
      m.group_name,
      m.duration,
      m.penalty_winner,
      m.home_penalty_goals,
      m.away_penalty_goals,
      c.penalty_phases,
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
    JOIN competitions c ON c.id = m.competition_id
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

  return { query, params }
}

async function fetchMatches(
  db: D1Database,
  competitionId: string,
  round?: string,
  status?: string,
) {
  const { query, params } = buildMatchesQuery(competitionId, round, status)

  // default_round only makes sense for the unfiltered full list. With ?round or
  // ?status active the response is a subset, so a global default_round would be
  // unrelated to the matches actually returned — we skip computing/returning it.
  const hasFilters = Boolean(round) || Boolean(status)

  let results: { status: string }[]
  let defaultRound: string | null = null

  if (hasFilters) {
    const result = await db
      .prepare(query)
      .bind(...(params as string[]))
      .all<{ status: string }>()
    results = result.results
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

    results = batchResults[0].results as { status: string }[]
    const activeRound = (batchResults[1].results as { round?: string }[])[0]?.round
    const lastRound = (batchResults[2].results as { round?: string }[])[0]?.round
    defaultRound = activeRound ?? lastRound ?? null
  }

  return { results, defaultRound, hasFilters }
}

function mapMatchesResponse(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => {
    const { penalty_phases, ...rest } = row
    return {
      ...rest,
      // Rótulo de exibição derivado no back (fonte única) — o front só exibe.
      round_label: roundLabel((rest.round as string | null) ?? ''),
      decides_on_penalties: matchGoesToPenalties(
        parsePenaltyPhases(penalty_phases as string | null),
        (rest.phase as string | null) ?? null,
      ),
    }
  })
}

/**
 * GET /matches?competition_id=xxx[&round=xxx][&status=scheduled|finished]
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
async function handleGetMatches(c: Context<AppContext>) {
  const startedAt = Date.now()
  const competitionId = c.req.query('competition_id')
  const round = c.req.query('round')
  const status = c.req.query('status')

  if (!competitionId) {
    return c.json({ error: 'competition_id é obrigatório' }, 400)
  }

  const validStatuses = ['scheduled', 'finished']
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
  const cacheUrl = new URL(c.req.url)
  cacheUrl.search = ''
  cacheUrl.searchParams.set('competition_id', competitionId)
  if (round) cacheUrl.searchParams.set('round', round)
  if (status) cacheUrl.searchParams.set('status', status)
  const cacheKey = new Request(cacheUrl)
  if (cache) {
    const cached = await cache.match(cacheKey)
    if (cached) {
      logEvent(c.env.AE, 'matches_cache', { blobs: ['hit', competitionId] })
      return cached
    }
  }

  try {
    const dbStartedAt = Date.now()
    const { results, defaultRound, hasFilters } = await fetchMatches(
      db,
      competitionId,
      round,
      status,
    )
    const dbMs = Date.now() - dbStartedAt

    // Cache strategy is derived from the RESPONSE CONTENTS, not the query param:
    // a list is only safe to cache long-term when every match is 'finished' (a
    // terminal state). Any list with a not-yet-finished match uses a short
    // TTL so the transition to finished doesn't serve a stale snapshot.
    //
    // The same Cache-Control drives two layers: the browser cache (per user)
    // and the edge Cache API below (shared per colo). Note: a Worker-generated
    // response is NOT edge-cached automatically by Cache-Control — only the
    // explicit caches.default.put() does that. The Worker still runs on every
    // request, but a cache hit (above) skips the D1 query.
    // Derive decides_on_penalties per match from the competition's penalty_phases
    // gate (parsed in TS — no SQL json_each) and strip the raw gate from the
    // payload. The frontend stays dumb: it only reads the boolean to decide
    // whether to show the penalty-winner pick.
    const matchesOut = mapMatchesResponse(results as Array<Record<string, unknown>>)

    const response = c.json({
      matches: matchesOut,
      ...(hasFilters ? {} : { default_round: defaultRound }),
    })
    response.headers.set('Cache-Control', matchesCacheControl(results))

    // Só cacheia listas não-vazias. Isso (a) evita servir um snapshot vazio de uma
    // competição que ainda vai ser sincronizada e (b) fecha o abuso: um competition_id
    // inexistente sempre retorna vazio → nunca entra no edge cache → nunca vira um HIT,
    // então o blob de `matches_cache` no hit só carrega competição real (cardinalidade
    // limitada). O Cache-Control (browser) continua valendo p/ a resposta vazia.
    if (cache && results.length > 0) {
      // clone(): a response body can only be consumed once — the cache keeps
      // its own copy while we still return the original to the caller.
      c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
    }

    // Cap dimension cardinality: only real competitions (response had games)
    // get their id; random junk competition_id from anon flooding all collapse
    // into one 'unknown' bucket.
    const cacheCompetition = results.length > 0 ? competitionId : 'unknown'
    logEvent(c.env.AE, 'matches_cache', { blobs: ['miss', cacheCompetition] })

    logRequestPerf(c.env.AE, 'GET /matches', {
      status: 200,
      totalMs: Date.now() - startedAt,
      dbMs,
      rows: results.length,
      extra: {
        competition_id: competitionId,
        has_round_filter: Boolean(round),
        status_filter: status ?? 'all',
      },
    })

    return response
  } catch (error) {
    console.error('Erro ao buscar jogos:', error)
    return c.json({ error: 'Erro ao carregar jogos' }, 500)
  }
}

router.get('/', requireAuth, handleGetMatches)

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
  // Ferramenta manual de seed/backfill — só o admin. A atualização normal de
  // partidas roda pelos cron triggers (discoverFixtures / pollActiveMatches).
  // Comparação case-insensitive: o casing do e-mail no ID token do Google não
  // é garantido, e um mismatch aqui trancaria o admin pra fora. Sem ADMIN_EMAIL
  // configurado, responde 403 — fechado por padrão.
  const admin = c.env.ADMIN_EMAIL?.toLowerCase()
  if (!admin || c.get('userEmail')?.toLowerCase() !== admin) {
    return c.json({ error: 'Você não tem permissão para sincronizar partidas' }, 403)
  }

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
    const result = await syncFixtures({
      competitionCode: competition,
      season,
      matchday,
      apiKey,
      db: c.env.DB,
    })
    await scoreUnprocessedMatches(result.competitionId, c.env.DB)
    return c.json({ ok: true, synced: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logError(c.env.AE, 'football_api_error', 'Erro no sync:', error, {
      blobs: ['sync_endpoint'],
    })
    return c.json({ error: `Erro ao sincronizar: ${message}` }, 500)
  }
})

export { router as matchesRouter }
