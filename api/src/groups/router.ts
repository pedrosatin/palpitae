import { Hono } from 'hono'
import { hasFeatureAccess } from '../auth/permissions'
import { requireAuth } from '../auth/middleware'
import type { AppContext } from '../types'

const router = new Hono<AppContext>()

/**
 * Generates a readable invite code in the format XXXX-XXXX (uppercase alphanumeric).
 */
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous chars (I, O, 0, 1)
  const array = new Uint8Array(8)
  crypto.getRandomValues(array)
  const raw = Array.from(array)
    .map((b) => chars[b % chars.length])
    .join('')
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

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

/**
 * POST /groups
 *
 * Creates a new group. The authenticated user becomes the owner.
 *
 * Body: { name: string, competition_id: string }
 *
 * Response 201:
 * { group: { id, name, competition_id, invite_code } }
 */
router.post('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const userEmail = c.get('userEmail')

  if (!hasFeatureAccess(userEmail, 'create_group')) {
    return c.json({ error: 'Você não tem permissão para criar grupos' }, 403)
  }

  const body = await c.req.json<{ name?: string; competition_id?: string }>()

  const name = body.name?.trim()
  const competition_id = body.competition_id?.trim()

  if (!name || !competition_id) {
    return c.json({ error: 'Nome e competição são obrigatórios' }, 400)
  }

  if (name.length < 2 || name.length > 50) {
    return c.json({ error: 'Nome deve ter entre 2 e 50 caracteres' }, 400)
  }

  const db = c.env.DB

  // Validate competition exists
  const competition = await db
    .prepare('SELECT id FROM competitions WHERE id = ?')
    .bind(competition_id)
    .first()

  if (!competition) {
    return c.json({ error: 'Competição não encontrada' }, 404)
  }

  // Generate a unique invite code (retry up to 5 times on collision)
  let invite_code: string = ''
  for (let i = 0; i < 5; i++) {
    const candidate = generateInviteCode()
    const existing = await db
      .prepare('SELECT id FROM groups WHERE invite_code = ?')
      .bind(candidate)
      .first()
    if (!existing) {
      invite_code = candidate
      break
    }
  }

  if (!invite_code) {
    return c.json({ error: 'Erro interno ao gerar convite' }, 500)
  }

  const groupId = crypto.randomUUID()
  const memberId = crypto.randomUUID()

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(groupId, name, competition_id, userId, invite_code),
      db
        .prepare(
          `INSERT INTO group_members (id, group_id, user_id, role)
           VALUES (?, ?, ?, 'owner')`,
        )
        .bind(memberId, groupId, userId),
    ])

    return c.json({ group: { id: groupId, name, competition_id, invite_code } }, 201)
  } catch (error) {
    console.error('Error creating group:', error)
    return c.json({ error: 'Erro ao criar grupo' }, 500)
  }
})

/**
 * POST /groups/join
 *
 * Joins an existing group via invite code.
 *
 * Body: { invite_code: string }
 *
 * Response 200:
 * { group: { id, name } }
 */
router.post('/join', requireAuth, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{ invite_code?: string }>()

  const invite_code = body.invite_code?.trim().toUpperCase()

  if (!invite_code) {
    return c.json({ error: 'Código de convite é obrigatório' }, 400)
  }

  const db = c.env.DB

  const group = await db
    .prepare('SELECT id, name, max_members FROM groups WHERE invite_code = ?')
    .bind(invite_code)
    .first<{ id: string; name: string; max_members: number }>()

  if (!group) {
    return c.json({ error: 'Código de convite inválido' }, 404)
  }

  // Already a member?
  const existing = await db
    .prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(group.id, userId)
    .first()

  if (existing) {
    return c.json({ error: 'Você já é membro deste grupo' }, 409)
  }

  // Check member cap
  const countResult = await db
    .prepare('SELECT COUNT(*) as count FROM group_members WHERE group_id = ?')
    .bind(group.id)
    .first<{ count: number }>()

  if ((countResult?.count ?? 0) >= group.max_members) {
    return c.json({ error: 'Este grupo atingiu o limite de membros' }, 409)
  }

  const memberId = crypto.randomUUID()
  await db
    .prepare(`INSERT INTO group_members (id, group_id, user_id, role) VALUES (?, ?, ?, 'member')`)
    .bind(memberId, group.id, userId)
    .run()

  return c.json({ group: { id: group.id, name: group.name } })
})

/**
 * GET /groups/:id
 *
 * Returns detail for a single group the authenticated user belongs to.
 * The invite_code is included — visible only to the owner in the UI.
 *
 * Response:
 * { group: { id, name, competition_id, competition_name, admin_id, invite_code, created_at, member_count, user_position, user_points } }
 */
router.get('/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')
  const db = c.env.DB

  // Must be a member
  const membership = await db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(groupId, userId)
    .first<{ role: string }>()

  if (!membership) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  const group = await db
    .prepare(
      `SELECT
         g.id,
         g.name,
         g.competition_id,
         c.name AS competition_name,
         g.owner_user_id AS admin_id,
         g.invite_code,
         g.created_at,
         COUNT(DISTINCT gm.user_id) AS member_count,
         COALESCE(l.total_points, 0) AS user_points,
         COALESCE(l.exact_hits, 0) AS exact_hits
       FROM groups g
       INNER JOIN group_members gm ON g.id = gm.group_id
       LEFT JOIN competitions c ON g.competition_id = c.id
       LEFT JOIN leaderboard l ON g.id = l.group_id AND l.user_id = ?
       WHERE g.id = ?
       GROUP BY g.id`,
    )
    .bind(userId, groupId)
    .first<{
      id: string
      name: string
      competition_id: string
      competition_name: string | null
      admin_id: string
      invite_code: string
      created_at: string
      member_count: number
      user_points: number
      exact_hits: number
    }>()

  if (!group) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  // Calculate position
  const positionResult = await db
    .prepare(
      `SELECT COUNT(*) as position
       FROM leaderboard
       WHERE group_id = ? AND total_points > (
         SELECT COALESCE(total_points, 0) FROM leaderboard WHERE group_id = ? AND user_id = ?
       )`,
    )
    .bind(groupId, groupId, userId)
    .first<{ position: number }>()

  const user_position = ((positionResult?.position as number) ?? 0) + 1

  return c.json({
    group: {
      ...group,
      user_position,
    },
  })
})

export { router as groupsRouter }
