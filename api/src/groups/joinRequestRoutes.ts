/**
 * Rotas de pedido de entrada pelo link público do grupo.
 *
 * Montadas em `/groups`. O dono é o `sub` do JWT (`userId`), como nas demais
 * ações de admin do grupo (`owner_user_id !== userId` → 403).
 */
import type { Hono } from 'hono'
import type { Context } from 'hono'
import { hasPilotAccess } from '../auth/permissions'
import { requireAuth } from '../auth/middleware'
import { validateJson } from '../http/validateJson'
import { hashUserId, logEvent } from '../observability'
import {
  createJoinRequestSchema,
  type CreateJoinRequestBody,
  mapCreateJoinRequestError,
} from './writeSchemas'
import { readRecentSignupFlag } from '../observability/inviteFunnel'
import type { AppContext } from '../types'
import { getGroupMembership, isPilotGroupBlocked, memberDisplaySql } from './membership'
import { tryInsertGroupMember } from './joinMember'
import {
  generatePublicId,
  JOIN_REQUEST_ALREADY_MEMBER,
  JOIN_REQUEST_ALREADY_PENDING,
  JOIN_REQUEST_APPROVE_MEMBERSHIP_CAP,
  JOIN_REQUEST_COOLDOWN,
  JOIN_REQUEST_DAILY_LIMIT,
  JOIN_REQUEST_GROUP_FULL,
  JOIN_REQUEST_GROUP_PENDING_CAP,
  JOIN_REQUEST_INVALID_LINK,
  JOIN_REQUEST_OWNER_ONLY,
  JOIN_REQUEST_REFUSED,
  JOIN_REQUEST_REJECT_COOLDOWN_DAYS,
  JOIN_REQUESTS_DISABLED,
  JOIN_REQUESTS_LIST_LIMIT,
  JOIN_REQUESTS_PER_USER_PER_DAY,
  normalizePublicId,
} from './joinRequests'
import {
  JOIN_MEMBERSHIP_CAP_ERROR,
  MAX_ACTIVE_MEMBERSHIPS,
  ACTIVE_MEMBERSHIPS_COUNT_SQL,
} from './groupCaps'

type GroupsApp = Hono<AppContext>
type AppC = Context<AppContext>

async function requireOwner(
  c: AppC,
  groupId: string,
): Promise<{ userId: string; db: D1Database } | { error: Response }> {
  const userId = c.get('userId')
  const db = c.env.DB
  const group = await db
    .prepare('SELECT owner_user_id FROM groups WHERE id = ? AND deleted_at IS NULL')
    .bind(groupId)
    .first<{ owner_user_id: string }>()
  if (!group || (await isPilotGroupBlocked(c, db, groupId))) {
    return { error: c.json({ error: 'Grupo não encontrado' }, 404) }
  }
  if (group.owner_user_id !== userId) {
    return { error: c.json({ error: JOIN_REQUEST_OWNER_ONLY }, 403) }
  }
  return { userId, db }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

/** Volta o pedido a pending (falha após claim atômico). */
async function revertClaimToPending(db: D1Database, requestId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE group_join_requests
       SET status = 'pending', decided_at = NULL, decided_by = NULL
       WHERE id = ? AND status = 'approved'`,
    )
    .bind(requestId)
    .run()
}

/**
 * Desfaz o claim. Se outro pedido pendente do mesmo usuário já existir (índice
 * único parcial), marca o reclamado como `rejected` com `decided_by` NULL em
 * vez de deixar `approved` sem membro.
 */
async function revertClaimOrRejectOnConflict(
  db: D1Database,
  requestId: string,
): Promise<'pending' | 'rejected'> {
  try {
    await revertClaimToPending(db, requestId)
    return 'pending'
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    await db
      .prepare(
        `UPDATE group_join_requests
         SET status = 'rejected', decided_at = datetime('now'), decided_by = NULL
         WHERE id = ? AND status = 'approved'`,
      )
      .bind(requestId)
      .run()
    return 'rejected'
  }
}

/** Marca o pedido já claimado como rejected (ex.: banido após o claim). */
async function finalizeClaimAsRejected(
  db: D1Database,
  requestId: string,
  decidedBy: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE group_join_requests
       SET status = 'rejected', decided_at = datetime('now'), decided_by = ?
       WHERE id = ? AND status = 'approved'`,
    )
    .bind(decidedBy, requestId)
    .run()
}

/**
 * GET /groups/join-requests/me?public_id=
 *
 * Diz se o usuário autenticado já é membro (e o id do grupo) ou tem pedido
 * pendente. Usado pela página `/grupo/:publicId` para trocar o CTA.
 */
async function getMyJoinRequestStatus(c: AppC) {
  const publicId = normalizePublicId(c.req.query('public_id'))
  if (!publicId) return c.json({ error: JOIN_REQUEST_INVALID_LINK }, 404)

  const userId = c.get('userId')
  const db = c.env.DB
  const group = await db
    .prepare(
      `SELECT g.id FROM groups g
       LEFT JOIN competitions c ON g.competition_id = c.id
       WHERE g.public_id = ? AND g.deleted_at IS NULL`,
    )
    .bind(publicId)
    .first<{ id: string }>()
  if (!group || (await isPilotGroupBlocked(c, db, group.id))) {
    return c.json({ error: JOIN_REQUEST_REFUSED }, 404)
  }

  const member = await db
    .prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(group.id, userId)
    .first()
  if (member) {
    return c.json({ status: 'member', group_id: group.id })
  }

  const pending = await db
    .prepare(
      `SELECT id FROM group_join_requests
       WHERE group_id = ? AND user_id = ? AND status = 'pending'`,
    )
    .bind(group.id, userId)
    .first()
  if (pending) {
    return c.json({ status: 'pending' })
  }

  return c.json({ status: 'none' })
}

/**
 * POST /groups/join-requests
 *
 * Cria um pedido de entrada pelo `public_id` do grupo. Exige conta.
 * Body: { public_id: string }
 */
async function createJoinRequest(
  c: Context<AppContext, string, { in: { json: CreateJoinRequestBody }; out: { json: CreateJoinRequestBody } }>,
) {
  const userId = c.get('userId')
  const body = c.req.valid('json')

  const publicId = normalizePublicId(body.public_id)
  if (!publicId) return c.json({ error: JOIN_REQUEST_INVALID_LINK }, 404)

  const db = c.env.DB
  const group = await db
    .prepare(
      `SELECT g.id, g.name, g.max_members, g.join_requests_enabled,
              c.visibility AS competition_visibility
       FROM groups g
       LEFT JOIN competitions c ON g.competition_id = c.id
       WHERE g.public_id = ? AND g.deleted_at IS NULL`,
    )
    .bind(publicId)
    .first<{
      id: string
      name: string
      max_members: number
      join_requests_enabled: number
      competition_visibility?: string | null
    }>()

  if (
    !group ||
    (group.competition_visibility === 'pilot' && !hasPilotAccess(c.get('userIdentity'), c.env))
  ) {
    return c.json({ error: JOIN_REQUEST_REFUSED }, 404)
  }

  if (!group.join_requests_enabled) {
    return c.json({ error: JOIN_REQUESTS_DISABLED }, 403)
  }

  const banned = await db
    .prepare('SELECT user_id FROM group_bans WHERE group_id = ? AND user_id = ?')
    .bind(group.id, userId)
    .first()
  if (banned) return c.json({ error: JOIN_REQUEST_REFUSED }, 403)

  const member = await db
    .prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(group.id, userId)
    .first()
  if (member) {
    return c.json({ error: JOIN_REQUEST_ALREADY_MEMBER, group_id: group.id }, 409)
  }

  const pending = await db
    .prepare(
      `SELECT id FROM group_join_requests
       WHERE group_id = ? AND user_id = ? AND status = 'pending'`,
    )
    .bind(group.id, userId)
    .first()
  if (pending) return c.json({ error: JOIN_REQUEST_ALREADY_PENDING }, 409)

  const recentReject = await db
    .prepare(
      `SELECT id FROM group_join_requests
       WHERE group_id = ? AND user_id = ? AND status = 'rejected'
         AND decided_at > datetime('now', ?)
       ORDER BY decided_at DESC LIMIT 1`,
    )
    .bind(group.id, userId, `-${JOIN_REQUEST_REJECT_COOLDOWN_DAYS} days`)
    .first()
  if (recentReject) return c.json({ error: JOIN_REQUEST_COOLDOWN }, 429)

  const todayCount = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM group_join_requests
       WHERE user_id = ? AND created_at >= datetime('now', 'start of day')`,
    )
    .bind(userId)
    .first<{ n: number }>()
  if ((todayCount?.n ?? 0) >= JOIN_REQUESTS_PER_USER_PER_DAY) {
    return c.json({ error: JOIN_REQUEST_DAILY_LIMIT }, 429)
  }

  const memberCount = await db
    .prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?')
    .bind(group.id)
    .first<{ n: number }>()
  if ((memberCount?.n ?? 0) >= group.max_members) {
    return c.json({ error: JOIN_REQUEST_GROUP_FULL }, 409)
  }

  const pendingCount = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM group_join_requests
       WHERE group_id = ? AND status = 'pending'`,
    )
    .bind(group.id)
    .first<{ n: number }>()
  if ((pendingCount?.n ?? 0) >= group.max_members) {
    return c.json({ error: JOIN_REQUEST_GROUP_PENDING_CAP }, 429)
  }

  const memberships = await db
    .prepare(`SELECT ${ACTIVE_MEMBERSHIPS_COUNT_SQL} AS n`)
    .bind(userId)
    .first<{ n: number }>()
  if ((memberships?.n ?? 0) >= MAX_ACTIVE_MEMBERSHIPS) {
    return c.json({ error: JOIN_MEMBERSHIP_CAP_ERROR }, 409)
  }

  const requestId = crypto.randomUUID()
  try {
    await db
      .prepare(
        `INSERT INTO group_join_requests (id, group_id, user_id, status)
         VALUES (?, ?, ?, 'pending')`,
      )
      .bind(requestId, group.id, userId)
      .run()
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ error: JOIN_REQUEST_ALREADY_PENDING }, 409)
    }
    throw error
  }

  logEvent(c.env.AE, 'join_request', {
    blobs: [group.id, await hashUserId(userId)],
  })

  return c.json({ request: { id: requestId, group_id: group.id, status: 'pending' } }, 201)
}

/**
 * GET /groups/:id/join-requests
 *
 * Lista pedidos pendentes. Só o dono (checagem de `sub`/`userId`).
 */
async function listJoinRequests(c: AppC) {
  const groupId = c.req.param('id')!
  const gate = await requireOwner(c, groupId)
  if ('error' in gate) return gate.error
  const { db } = gate

  const rows = await db
    .prepare(
      `SELECT r.id, r.user_id, r.created_at,
              ${memberDisplaySql('u', 'p')} AS display_name,
              p.avatar_url AS avatar_url
       FROM group_join_requests r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN profiles p ON p.user_id = r.user_id
       WHERE r.group_id = ? AND r.status = 'pending'
       ORDER BY r.created_at ASC
       LIMIT ${JOIN_REQUESTS_LIST_LIMIT}`,
    )
    .bind(groupId)
    .all<{
      id: string
      user_id: string
      created_at: string
      display_name: string
      avatar_url: string | null
    }>()

  return c.json({
    requests: rows.results.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      created_at: row.created_at,
    })),
  })
}

/**
 * POST /groups/:id/join-requests/:requestId/approve
 *
 * Aprova o pedido de forma atômica: claim do pending → insert do membro.
 * Se o insert falhar (grupo cheio), o pedido volta a pending com 409.
 * Banido: pedido fica rejected com 403. Dispara `group_joined` com
 * `entry_method = request` só quando o membro entra de fato. Quem já era
 * membro (ou entrou por convite na corrida) mantém o pedido `approved` sem
 * novo `group_joined`.
 */
async function approveJoinRequest(c: AppC) {
  const groupId = c.req.param('id')!
  const requestId = c.req.param('requestId')!
  const gate = await requireOwner(c, groupId)
  if ('error' in gate) return gate.error
  const { userId, db } = gate

  const group = await db
    .prepare('SELECT id, name, max_members FROM groups WHERE id = ? AND deleted_at IS NULL')
    .bind(groupId)
    .first<{ id: string; name: string; max_members: number }>()
  if (!group) return c.json({ error: 'Grupo não encontrado' }, 404)

  // Claim atômico: só um decide (approve × reject ou double approve).
  const claimed = await db
    .prepare(
      `UPDATE group_join_requests
       SET status = 'approved', decided_at = datetime('now'), decided_by = ?
       WHERE id = ? AND group_id = ? AND status = 'pending'
       RETURNING user_id`,
    )
    .bind(userId, requestId, groupId)
    .first<{ user_id: string }>()

  if (!claimed) {
    return c.json({ error: 'Pedido não encontrado' }, 404)
  }

  const requesterId = claimed.user_id

  const banned = await db
    .prepare('SELECT user_id FROM group_bans WHERE group_id = ? AND user_id = ?')
    .bind(groupId, requesterId)
    .first()
  if (banned) {
    await finalizeClaimAsRejected(db, requestId, userId)
    return c.json({ error: JOIN_REQUEST_REFUSED }, 403)
  }

  const existing = await getGroupMembership(db, groupId, requesterId)
  if (existing) {
    return c.json({ group: { id: group.id, name: group.name } })
  }

  try {
    const inserted = await tryInsertGroupMember(db, group, requesterId, null)
    if (!inserted.ok) {
      return respondApproveInsertFailure(c, db, group, requestId, userId, inserted)
    }

    logEvent(c.env.AE, 'group_joined', {
      blobs: [
        group.id,
        await hashUserId(requesterId),
        'request',
        await readRecentSignupFlag(db, inserted.memberId),
      ],
    })

    return c.json({ group: { id: group.id, name: group.name } })
  } catch {
    const outcome = await revertClaimOrRejectOnConflict(db, requestId)
    if (outcome === 'rejected') {
      return c.json(
        { error: 'Não foi possível concluir a aprovação. Tente de novo.' },
        409,
      )
    }
    return c.json({ error: 'Não foi possível concluir a aprovação. Tente de novo.' }, 500)
  }
}

async function respondApproveInsertFailure(
  c: AppC,
  db: D1Database,
  group: { id: string; name: string },
  requestId: string,
  ownerId: string,
  inserted: { ok: false; error: string; status: number },
) {
  if (inserted.status === 403) {
    await finalizeClaimAsRejected(db, requestId, ownerId)
    return c.json({ error: JOIN_REQUEST_REFUSED }, 403)
  }
  // Corrida: entrou por convite entre a checagem e o insert.
  if (inserted.error === JOIN_REQUEST_ALREADY_MEMBER) {
    return c.json({ group: { id: group.id, name: group.name } })
  }
  if (inserted.error === JOIN_MEMBERSHIP_CAP_ERROR) {
    await revertClaimOrRejectOnConflict(db, requestId)
    return c.json({ error: JOIN_REQUEST_APPROVE_MEMBERSHIP_CAP }, 409)
  }
  // Grupo cheio (ou grupo sumiu): pedido volta a pending.
  await revertClaimOrRejectOnConflict(db, requestId)
  return c.json(
    { error: inserted.status === 404 ? 'Grupo não encontrado' : inserted.error },
    inserted.status === 404 ? 404 : 409,
  )
}

/**
 * POST /groups/:id/join-requests/:requestId/reject
 *
 * Recusa o pedido. Não bane: o usuário pode pedir de novo após o cooldown.
 */
async function rejectJoinRequest(c: AppC) {
  const groupId = c.req.param('id')!
  const requestId = c.req.param('requestId')!
  const gate = await requireOwner(c, groupId)
  if ('error' in gate) return gate.error
  const { userId, db } = gate

  const updated = await db
    .prepare(
      `UPDATE group_join_requests
       SET status = 'rejected', decided_at = datetime('now'), decided_by = ?
       WHERE id = ? AND group_id = ? AND status = 'pending'`,
    )
    .bind(userId, requestId, groupId)
    .run()

  if (!updated.meta.changes) {
    return c.json({ error: 'Pedido não encontrado' }, 404)
  }

  return c.json({ success: true })
}

export function registerJoinRequestRoutes(router: GroupsApp): void {
  router.get('/join-requests/me', requireAuth, getMyJoinRequestStatus)
  router.post(
    '/join-requests',
    requireAuth,
    validateJson(createJoinRequestSchema, mapCreateJoinRequestError),
    createJoinRequest,
  )
  router.get('/:id/join-requests', requireAuth, listJoinRequests)
  router.post('/:id/join-requests/:requestId/approve', requireAuth, approveJoinRequest)
  router.post('/:id/join-requests/:requestId/reject', requireAuth, rejectJoinRequest)
}

/** Usado na criação de grupo: garante public_id único. */
export { generatePublicId }
