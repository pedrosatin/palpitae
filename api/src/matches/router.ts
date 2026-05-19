import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import type { AppContext } from '../types'
import { syncFixtures } from './sync'

const router = new Hono<AppContext>()

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

  let query = `
    SELECT
      m.id,
      m.start_time,
      m.status,
      m.home_score,
      m.away_score,
      m.phase,
      m.round,
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

  query += ` ORDER BY m.start_time ASC`

  // Cache strategy based on status:
  //   live     → 30s (scores change frequently)
  //   finished → 24h (scores never change)
  //   default  → 1h, serve stale for 24h while revalidating
  // Cloudflare CDN absorbs identical requests at the edge — the Worker isn't
  // even invoked when a cached response exists, so D1 is never queried.
  if (status === 'live') {
    c.header('Cache-Control', 'public, max-age=30')
  } else if (status === 'finished') {
    c.header('Cache-Control', 'public, max-age=86400')
  } else {
    c.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
  }

  try {
    const result = await db.prepare(query).bind(...params).all()

    // Auto-sync: if no matches found, try fetching from football-data.org
    if (result.results.length === 0) {
      const apiKey = c.env.FOOTBALL_API_KEY
      if (apiKey) {
        const competition = await db
          .prepare(`SELECT external_id, provider, season FROM competitions WHERE id = ?`)
          .bind(competitionId)
          .first<{ external_id: string | null; provider: string | null; season: string | null }>()

        if (competition?.external_id && competition.provider === 'football-data' && competition.season) {
          try {
            await syncFixtures({
              competitionCode: competition.external_id,
              season: Number(competition.season),
              apiKey,
              db,
            })

            // Re-query after sync
            const synced = await db.prepare(query).bind(...params).all()
            return c.json({ matches: synced.results })
          } catch (syncError) {
            console.error('Auto-sync falhou, retornando vazio:', syncError)
          }
        }
      }
    }

    return c.json({ matches: result.results })
  } catch (error) {
    console.error('Erro ao buscar jogos:', error)
    return c.json({ error: 'Erro ao carregar jogos' }, 500)
  }
})

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
