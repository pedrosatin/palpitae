import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import type { AppContext } from '../types'

const router = new Hono<AppContext>()

/**
 * GET /groups
 * 
 * Returns all groups the authenticated user is a member of,
 * including member count, user's position, and accumulated points.
 *
 * Response:
 * {
 *   groups: [
 *     {
 *       id: string
 *       name: string
 *       competition_id: string
 *       admin_id: string
 *       created_at: string
 *       member_count: number
 *       user_position: number
 *       user_points: number
 *     }
 *   ]
 * }
 */
router.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')

  const db = c.env.DB
  try {
    // Fetch groups where user is a member
    const groups = await db
      .prepare(
        `
        SELECT 
          g.id,
          g.name,
          g.competition_id,
          g.owner_user_id AS admin_id,
          g.created_at,
          COUNT(DISTINCT gm.user_id) AS member_count,
          COALESCE(l.total_points, 0) AS user_points
        FROM groups g
        INNER JOIN group_members gm ON g.id = gm.group_id
        LEFT JOIN leaderboard l ON g.id = l.group_id AND l.user_id = ?
        WHERE gm.user_id = ?
        GROUP BY g.id
        ORDER BY g.created_at DESC
        `
      )
      .bind(userId, userId)
      .all()

    // For each group, get the user's position in the leaderboard
    const groupsWithPositions = await Promise.all(
      groups.results.map(async (group: any) => {
        // Get user's position
        const positionResult = await db
          .prepare(
            `
            SELECT COUNT(*) as position
            FROM leaderboard
            WHERE group_id = ? AND total_points > (
              SELECT total_points FROM leaderboard WHERE group_id = ? AND user_id = ?
            )
            `
          )
          .bind(group.id, group.id, userId)
          .first<{ position: number }>()

        const position = ((positionResult?.position as number) || 0) + 1

        return {
          id: group.id,
          name: group.name,
          competition_id: group.competition_id,
          admin_id: group.admin_id,
          created_at: group.created_at,
          member_count: group.member_count,
          user_position: position,
          user_points: group.user_points,
        }
      })
    )

    return c.json({ groups: groupsWithPositions })
  } catch (error) {
    console.error('Error fetching groups:', error)
    return c.json({ error: 'Erro ao carregar grupos' }, 500)
  }
})

export { router as groupsRouter }
