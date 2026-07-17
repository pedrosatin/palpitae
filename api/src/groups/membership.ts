/**
 * Group-membership lookup shared by the groups and predictions routers.
 * Returns the membership row or null when the user is not a member — the
 * caller decides the status code (groups 404s, predictions 403s).
 */
export async function getGroupMembership(
  db: D1Database,
  groupId: string,
  userId: string,
): Promise<{ role: string } | null> {
  return db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(groupId, userId)
    .first<{ role: string }>()
}

/**
 * Same lookup plus the query duration, for callers that feed the
 * membership time into `logRequestPerf`.
 */
export async function getGroupMembershipTimed(
  db: D1Database,
  groupId: string,
  userId: string,
): Promise<{ membership: { role: string } | null; membershipMs: number }> {
  const startedAt = Date.now()
  const membership = await getGroupMembership(db, groupId, userId)
  return { membership, membershipMs: Date.now() - startedAt }
}
