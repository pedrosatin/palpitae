import { Hono } from 'hono'
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
 *     { id, name, slug, season, status }
 *   ]
 * }
 */
router.get('/', async (c) => {
  const db = c.env.DB

  try {
    const result = await db
      .prepare(
        `SELECT id, name, slug, season, status
         FROM competitions
         ORDER BY name ASC`,
      )
      .all()

    // Cache for 1 hour; serve stale for up to 24h while revalidating
    c.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

    return c.json({ competitions: result.results })
  } catch (error) {
    console.error('Error fetching competitions:', error)
    return c.json({ error: 'Erro ao carregar competições' }, 500)
  }
})

export { router as competitionsRouter }
