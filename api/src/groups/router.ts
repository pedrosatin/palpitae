import { Hono } from 'hono'
import { hasFeatureAccess } from '../auth/permissions'
import { requireAuth } from '../auth/middleware'
import { hashUserId, logEvent, logRequestPerf } from '../observability'
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
 *       is_admin: boolean
 *       created_at: string
 *       member_count: number
 *       user_position: number
 *       user_points: number
 *     }
 *   ],
 *   matched_invite_group_id: string | null
 * }
 */
router.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const startedAt = Date.now()
  const inviteCode = c.req.query('invite_code')?.trim().toUpperCase()

  const db = c.env.DB
  try {
    c.header('Cache-Control', 'private, max-age=30, stale-while-revalidate=300')

    const dbStartedAt = Date.now()
    const groups = await db
      .prepare(
        `
        SELECT 
          g.id,
          g.name,
          g.competition_id,
          g.owner_user_id AS admin_id,
          g.invite_code,
          g.created_at,
          (
            SELECT COUNT(*)
            FROM group_members gm2
            WHERE gm2.group_id = g.id
          ) AS member_count,
          COALESCE(l.total_points, 0) AS user_points,
          COALESCE(
            (
              SELECT COUNT(*) + 1
              FROM leaderboard l2
              WHERE l2.group_id = g.id
                AND l2.total_points > COALESCE(l.total_points, 0)
            ),
            1
          ) AS user_position
        FROM groups g
        INNER JOIN group_members gm ON g.id = gm.group_id AND gm.user_id = ?
        LEFT JOIN leaderboard l ON g.id = l.group_id AND l.user_id = ?
        WHERE g.deleted_at IS NULL
        GROUP BY g.id
        ORDER BY g.created_at DESC
        `
      )
      .bind(userId, userId)
      .all<{
        id: string
        name: string
        competition_id: string
        admin_id: string
        invite_code: string
        created_at: string
        member_count: number
        user_position: number
        user_points: number
      }>()

    const matchedInviteGroup = inviteCode
      ? groups.results.find((group) => group.invite_code === inviteCode) ?? null
      : null

    const dbMs = Date.now() - dbStartedAt
    const payload = {
      groups: groups.results.map((group) => ({
        id: group.id,
        name: group.name,
        competition_id: group.competition_id,
        is_admin: group.admin_id === userId,
        created_at: group.created_at,
        member_count: group.member_count,
        user_position: group.user_position,
        user_points: group.user_points,
      })),
      matched_invite_group_id: matchedInviteGroup?.id ?? null,
    }

    logRequestPerf('GET /groups', {
      status: 200,
      totalMs: Date.now() - startedAt,
      dbMs,
      rows: payload.groups.length,
    })

    return c.json(payload)
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

  const body = await c.req.json<{
    name?: string
    competition_id?: string
    points_exact?: number
    points_winner?: number
    predictions_visibility?: string
    penalty_picks_enabled?: boolean
  }>()

  const name = body.name?.trim()
  const competition_id = body.competition_id?.trim()

  if (!name || !competition_id) {
    return c.json({ error: 'Nome e competição são obrigatórios' }, 400)
  }

  if (name.length < 2 || name.length > 50) {
    return c.json({ error: 'Nome deve ter entre 2 e 50 caracteres' }, 400)
  }

  // Scoring rules & visibility — set at creation, immutable afterwards.
  const points_exact = body.points_exact ?? 3
  const points_winner = body.points_winner ?? 1
  const predictions_visibility = body.predictions_visibility ?? 'hidden'
  if (body.penalty_picks_enabled !== undefined && typeof body.penalty_picks_enabled !== 'boolean') {
    return c.json({ error: 'penalty_picks_enabled deve ser booleano' }, 400)
  }
  // Penalty picks default on. Forced off for 1X2 ("só vencedor") groups: with no
  // exact-score points there is no shootout bonus, so the toggle is meaningless.
  const penalty_picks_enabled = points_exact > 0 && (body.penalty_picks_enabled ?? true) ? 1 : 0

  if (
    !Number.isInteger(points_exact) ||
    points_exact < 0 ||
    points_exact > 10 ||
    !Number.isInteger(points_winner) ||
    points_winner < 0 ||
    points_winner > 10
  ) {
    return c.json({ error: 'Pontuação deve ser inteiro entre 0 e 10' }, 400)
  }
  // points_exact === 0 enables the "só vencedor" (1X2) mode and is always allowed.
  // Otherwise an exact hit must be worth at least as much as a plain winner hit.
  if (points_exact > 0 && points_exact < points_winner) {
    return c.json(
      { error: 'Pontos por placar exato deve ser maior ou igual a pontos por vencedor' },
      400,
    )
  }
  if (points_exact + points_winner === 0) {
    return c.json({ error: 'Pelo menos um tipo de pontuação deve ser maior que zero' }, 400)
  }
  if (!['hidden', 'public'].includes(predictions_visibility)) {
    return c.json({ error: 'Visibilidade inválida' }, 400)
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
          `INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code, points_exact, points_winner, predictions_visibility, penalty_picks_enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          groupId,
          name,
          competition_id,
          userId,
          invite_code,
          points_exact,
          points_winner,
          predictions_visibility,
          penalty_picks_enabled,
        ),
      db
        .prepare(
          `INSERT INTO group_members (id, group_id, user_id, role)
           VALUES (?, ?, ?, 'owner')`,
        )
        .bind(memberId, groupId, userId),
    ])

    logEvent(c.env.AE, 'group_created', {
      blobs: [groupId, competition_id, await hashUserId(userId), predictions_visibility],
      doubles: [points_exact, points_winner, penalty_picks_enabled],
    })

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
    .prepare('SELECT id, name, max_members FROM groups WHERE invite_code = ? AND deleted_at IS NULL')
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

  logEvent(c.env.AE, 'group_joined', {
    blobs: [group.id, await hashUserId(userId)],
  })

  return c.json({ group: { id: group.id, name: group.name } })
})

/**
 * GET /groups/:id
 *
 * Returns detail for a single group the authenticated user belongs to.
 * The invite_code is included — visible only to the owner in the UI.
 *
 * Response:
 * { group: { id, name, competition_id, competition_name, is_admin, invite_code, created_at, member_count, user_position, user_points } }
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
         g.points_exact,
         g.points_winner,
         g.predictions_visibility,
         g.penalty_picks_enabled,
         COUNT(DISTINCT gm.user_id) AS member_count,
         COALESCE(l.total_points, 0) AS user_points,
         COALESCE(l.exact_hits, 0) AS exact_hits
       FROM groups g
       INNER JOIN group_members gm ON g.id = gm.group_id
       LEFT JOIN competitions c ON g.competition_id = c.id
       LEFT JOIN leaderboard l ON g.id = l.group_id AND l.user_id = ?
       WHERE g.id = ? AND g.deleted_at IS NULL
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
      points_exact: number
      points_winner: number
      predictions_visibility: string
      penalty_picks_enabled: number
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
      id: group.id,
      name: group.name,
      competition_id: group.competition_id,
      competition_name: group.competition_name,
      is_admin: group.admin_id === userId,
      invite_code: group.invite_code,
      created_at: group.created_at,
      points_exact: group.points_exact,
      points_winner: group.points_winner,
      predictions_visibility: group.predictions_visibility,
      penalty_picks_enabled: group.penalty_picks_enabled === 1,
      member_count: group.member_count,
      user_points: group.user_points,
      exact_hits: group.exact_hits,
      user_position,
    },
  })
})

/**
 * PATCH /groups/:id
 *
 * Renames a group. Only the group owner (admin) may do this.
 *
 * Body: { name: string }
 * Response 200: { group: { id, name } }
 */
router.patch('/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')
  const db = c.env.DB

  const body = await c.req.json<{ name?: string; penalty_picks_enabled?: boolean }>()
  const name = body.name?.trim()

  if (!name) {
    return c.json({ error: 'Nome é obrigatório' }, 400)
  }

  if (name.length < 2 || name.length > 50) {
    return c.json({ error: 'Nome deve ter entre 2 e 50 caracteres' }, 400)
  }

  if (body.penalty_picks_enabled !== undefined && typeof body.penalty_picks_enabled !== 'boolean') {
    return c.json({ error: 'penalty_picks_enabled deve ser booleano' }, 400)
  }

  const group = await db
    .prepare('SELECT owner_user_id, points_exact FROM groups WHERE id = ? AND deleted_at IS NULL')
    .bind(groupId)
    .first<{ owner_user_id: string; points_exact: number }>()

  if (!group) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  if (group.owner_user_id !== userId) {
    return c.json({ error: 'Apenas o administrador pode editar o grupo' }, 403)
  }

  if (body.penalty_picks_enabled !== undefined) {
    const penaltyPicksEnabled = group.points_exact > 0 && body.penalty_picks_enabled ? 1 : 0
    await db
      .prepare('UPDATE groups SET name = ?, penalty_picks_enabled = ? WHERE id = ?')
      .bind(name, penaltyPicksEnabled, groupId)
      .run()
  } else {
    await db.prepare('UPDATE groups SET name = ? WHERE id = ?').bind(name, groupId).run()
  }

  logEvent(c.env.AE, 'group_renamed', {
    blobs: [groupId, await hashUserId(userId)],
  })

  return c.json({ group: { id: groupId, name } })
})

/**
 * DELETE /groups/:id
 *
 * Soft-deletes a group (sets deleted_at). Only the owner (admin) may do this.
 * The group is hidden from listings and detail views; its data is retained.
 */
router.delete('/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')
  const db = c.env.DB

  const group = await db
    .prepare('SELECT owner_user_id FROM groups WHERE id = ? AND deleted_at IS NULL')
    .bind(groupId)
    .first<{ owner_user_id: string }>()

  if (!group) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  if (group.owner_user_id !== userId) {
    return c.json({ error: 'Apenas o administrador pode excluir o grupo' }, 403)
  }

  await db
    .prepare(`UPDATE groups SET deleted_at = datetime('now') WHERE id = ?`)
    .bind(groupId)
    .run()

  logEvent(c.env.AE, 'group_deleted', {
    blobs: [groupId, await hashUserId(userId)],
  })

  return c.json({ success: true })
})

/**
 * GET /groups/:id/members
 *
 * Returns the ranked member list for a group.
 * Any member of the group can view this.
 *
 * Response:
 * { members: [{ user_id, display_name, avatar_url, role, joined_at, total_points, exact_hits }] }
 */
router.get('/:id/members', requireAuth, async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')
  const db = c.env.DB

  const membership = await db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(groupId, userId)
    .first<{ role: string }>()

  if (!membership) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  const members = await db
    .prepare(
      `SELECT
         gm.user_id,
         gm.role,
         gm.joined_at,
         COALESCE(p.nickname, u.email) AS display_name,
         p.avatar_url,
         COALESCE(l.total_points, 0) AS total_points,
         COALESCE(l.exact_hits, 0) AS exact_hits
       FROM group_members gm
       INNER JOIN users u ON gm.user_id = u.id
       LEFT JOIN profiles p ON gm.user_id = p.user_id
       LEFT JOIN leaderboard l ON gm.group_id = l.group_id AND gm.user_id = l.user_id
       WHERE gm.group_id = ?
       ORDER BY total_points DESC, exact_hits DESC, gm.joined_at ASC`,
    )
    .bind(groupId)
    .all<{
      user_id: string
      role: string
      joined_at: string
      display_name: string
      avatar_url: string | null
      total_points: number
      exact_hits: number
    }>()

  return c.json({ members: members.results })
})

/**
 * DELETE /groups/:id/members/:memberId
 *
 * Removes a member from the group.
 * The group admin (owner) can remove other members.
 * A non-owner member can remove themselves from the group.
 * The owner cannot remove themselves.
 */
router.delete('/:id/members/:memberId', requireAuth, async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')
  const targetUserId = c.req.param('memberId')
  const db = c.env.DB

  const group = await db
    .prepare('SELECT owner_user_id FROM groups WHERE id = ?')
    .bind(groupId)
    .first<{ owner_user_id: string }>()

  if (!group) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  if (targetUserId === userId) {
    if (group.owner_user_id === userId) {
      return c.json({ error: 'Você não pode remover a si mesmo do grupo' }, 400)
    }
  } else if (group.owner_user_id !== userId) {
    return c.json({ error: 'Apenas o administrador pode remover membros' }, 403)
  }

  const membership = await db
    .prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(groupId, targetUserId)
    .first<{ id: string }>()

  if (!membership) {
    return c.json({ error: 'Membro não encontrado no grupo' }, 404)
  }

  await db
    .prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(groupId, targetUserId)
    .run()

  logEvent(c.env.AE, 'member_removed', {
    // 'self' = saiu sozinho; 'admin' = removido pelo dono do grupo.
    blobs: [groupId, await hashUserId(targetUserId), targetUserId === userId ? 'self' : 'admin'],
  })

  return c.json({ success: true })
})

export { router as groupsRouter }
