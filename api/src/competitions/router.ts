import { Hono } from 'hono'
import { parsePenaltyPhases } from '../matches/penalties'
import type { AppContext } from '../types'

const router = new Hono<AppContext>()

/**
 * GET /competitions
 *
 * Returns all available competitions.
 * Highly cached — this list changes rarely.
 *
 * Response:
 * {
 *   competitions: [
 *     { id, name, slug, season, status, has_penalty_phases }
 *   ]
 * }
 *
 * has_penalty_phases is derived server-side from penalty_phases (the (competition,
 * phase) gate). The frontend uses it to decide whether to show the points_penalty
 * field in CreateGroupModal — it never sees the raw phase list.
 */
router.get('/', async (c) => {
  const db = c.env.DB

  try {
    const result = await db
      .prepare(
        `SELECT id, name, slug, season, status, type, penalty_phases
         FROM competitions
         ORDER BY name ASC`,
      )
      .all<Record<string, unknown>>()

    const competitions = result.results.map(({ penalty_phases, ...rest }) => ({
      ...rest,
      has_penalty_phases: parsePenaltyPhases(penalty_phases as string | null).length > 0,
    }))

    // Cache for 1 hour; serve stale for up to 24h while revalidating
    c.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

    return c.json({ competitions })
  } catch (error) {
    console.error('Error fetching competitions:', error)
    return c.json({ error: 'Erro ao carregar competições' }, 500)
  }
})

export { router as competitionsRouter }
