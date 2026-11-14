import type { Context } from 'hono'
import { hasPilotAccess } from '../auth/permissions'
import type { AppContext } from '../types'

/**
 * Group-membership lookup shared by the groups and predictions routers.
 * Returns the membership row or null when the user is not a member — the
 * caller decides the status code (groups 404s, predictions 403s).
 */
export async function getGroupMembership(
  db: D1Database,
  groupId: string,
  userId: string,
): Promise<{ role: string; predictions_import_completed: number } | null> {
  return db
    .prepare(`SELECT role, predictions_import_completed FROM group_members WHERE group_id = ? AND user_id = ?
      AND EXISTS (SELECT 1 FROM groups WHERE id = group_id AND deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM group_bans b WHERE b.group_id = group_members.group_id AND b.user_id = group_members.user_id)`)
    .bind(groupId, userId)
    .first<{ role: string; predictions_import_completed: number }>()
}

/**
 * Same lookup plus the query duration, for callers that feed the
 * membership time into `logRequestPerf`.
 */
export async function getGroupMembershipTimed(
  db: D1Database,
  groupId: string,
  userId: string,
): Promise<{
  membership: { role: string; predictions_import_completed: number } | null
  membershipMs: number
}> {
  const startedAt = Date.now()
  const membership = await getGroupMembership(db, groupId, userId)
  return { membership, membershipMs: Date.now() - startedAt }
}

/**
 * Grupo de competição piloto fechado para quem não tem acesso piloto. Grupo
 * inexistente ou apagado devolve false, e o chamador decide o status da resposta.
 */
export async function isPilotGroupBlocked(
  c: Context<AppContext>,
  db: D1Database,
  groupId: string,
): Promise<boolean> {
  if (hasPilotAccess(c.get('userIdentity'), c.env)) return false
  const row = await db
    .prepare(
      `SELECT c.visibility
       FROM groups g
       LEFT JOIN competitions c ON g.competition_id = c.id
       WHERE g.id = ? AND g.deleted_at IS NULL`,
    )
    .bind(groupId)
    .first<{ visibility?: string | null }>()
  return row?.visibility === 'pilot'
}

/**
 * Nome exibido do participante: apelido, nome da conta ou e-mail mascarado
 * (2 letras + `***@domínio`). `user` e `profile` são os aliases de `users` e
 * `profiles` na consulta de fora.
 */
export function memberDisplaySql(user = 'u', profile = 'p'): string {
  return `COALESCE(${profile}.nickname, ${user}.user_name, CASE WHEN INSTR(${user}.email, '@') > 0 THEN SUBSTR(${user}.email, 1, 2) || '***@' || SUBSTR(${user}.email, INSTR(${user}.email, '@') + 1) ELSE 'Palpiteiro' END)`
}
