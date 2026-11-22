/**
 * Inserção de membro no grupo, compartilhada entre entrada por convite e
 * aprovação de pedido. O INSERT confere limite, banimento, grupo ativo e teto
 * de participações na mesma escrita.
 */
import {
  ACTIVE_MEMBERSHIPS_COUNT_SQL,
  JOIN_MEMBERSHIP_CAP_ERROR,
  MAX_ACTIVE_MEMBERSHIPS,
} from './groupCaps'
import { JOIN_REQUEST_ALREADY_MEMBER, JOIN_REQUEST_GROUP_FULL } from './joinRequests'

export type JoinInsertResult =
  | { ok: true; memberId: string }
  | { ok: false; error: string; status: 403 | 404 | 409 }

/**
 * Tenta inserir o usuário como membro. `inviteCode` só é exigido na entrada por
 * convite (reconfirma o código atual). Na aprovação por pedido, passe `null`.
 */
export async function tryInsertGroupMember(
  db: D1Database,
  group: { id: string; max_members: number },
  userId: string,
  inviteCode: string | null,
): Promise<JoinInsertResult> {
  const memberId = crypto.randomUUID()
  const inviteClause =
    inviteCode === null
      ? 'AND EXISTS (SELECT 1 FROM groups WHERE id = ? AND deleted_at IS NULL)'
      : 'AND EXISTS (SELECT 1 FROM groups WHERE id = ? AND invite_code = ? AND deleted_at IS NULL)'
  const binds =
    inviteCode === null
      ? [
          memberId,
          group.id,
          userId,
          group.id,
          group.max_members,
          group.id,
          userId,
          group.id,
          userId,
          MAX_ACTIVE_MEMBERSHIPS,
        ]
      : [
          memberId,
          group.id,
          userId,
          group.id,
          group.max_members,
          group.id,
          userId,
          group.id,
          inviteCode,
          userId,
          MAX_ACTIVE_MEMBERSHIPS,
        ]

  const inserted = await db
    .prepare(
      `INSERT INTO group_members (id, group_id, user_id, role)
       SELECT ?, ?, ?, 'member'
        WHERE (SELECT COUNT(*) FROM group_members WHERE group_id = ?) < ?
          AND NOT EXISTS (SELECT 1 FROM group_bans WHERE group_id = ? AND user_id = ?)
          ${inviteClause}
          AND ${ACTIVE_MEMBERSHIPS_COUNT_SQL} < ?
       ON CONFLICT DO NOTHING`,
    )
    .bind(...binds)
    .run()

  if (inserted.meta.changes) return { ok: true, memberId }

  if (inviteCode !== null) {
    const currentGroup = await db
      .prepare('SELECT id FROM groups WHERE id = ? AND invite_code = ? AND deleted_at IS NULL')
      .bind(group.id, inviteCode)
      .first()
    if (!currentGroup) return { ok: false, error: 'Código de convite inválido', status: 404 }
  } else {
    const currentGroup = await db
      .prepare('SELECT id FROM groups WHERE id = ? AND deleted_at IS NULL')
      .bind(group.id)
      .first()
    if (!currentGroup) return { ok: false, error: 'Grupo não encontrado', status: 404 }
  }

  const banned = await db
    .prepare('SELECT user_id FROM group_bans WHERE group_id = ? AND user_id = ?')
    .bind(group.id, userId)
    .first()
  if (banned) return { ok: false, error: 'Acesso revogado pelo administrador', status: 403 }

  const member = await db
    .prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(group.id, userId)
    .first()
  if (member) return { ok: false, error: JOIN_REQUEST_ALREADY_MEMBER, status: 409 }

  const memberships = await db
    .prepare(`SELECT ${ACTIVE_MEMBERSHIPS_COUNT_SQL} AS n`)
    .bind(userId)
    .first<{ n: number }>()
  if ((memberships?.n ?? 0) >= MAX_ACTIVE_MEMBERSHIPS) {
    return { ok: false, error: JOIN_MEMBERSHIP_CAP_ERROR, status: 409 }
  }

  return { ok: false, error: JOIN_REQUEST_GROUP_FULL, status: 409 }
}
