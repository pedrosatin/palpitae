import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { logRequestPerf } from '../observability'
import type { AppContext } from '../types'

const router = new Hono<AppContext>()

/**
 * GET /predictions?group_id=xxx[&match_id=xxx]
 *
 * Returns predictions of the authenticated user in a group.
 * Optionally scoped to a single match.
 *
 * The `locked` field indicates whether the prediction can still be edited
 * (derived from match.start_time at runtime — ADR-004).
 *
 * Response:
 * {
 *   predictions: [
 *     {
 *       id, match_id, predicted_home_score, predicted_away_score,
 *       points_awarded, locked, created_at, updated_at
 *     }
 *   ]
 * }
 */
router.get('/', requireAuth, async (c) => {
  const startedAt = Date.now()
  const userId = c.get('userId')
  const groupId = c.req.query('group_id')
  const matchId = c.req.query('match_id')

  if (!groupId) {
    return c.json({ error: 'group_id é obrigatório' }, 400)
  }

  const db = c.env.DB

  const membershipStartedAt = Date.now()
  const membership = await db
    .prepare(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`)
    .bind(groupId, userId)
    .first()
  const membershipMs = Date.now() - membershipStartedAt

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  const now = new Date().toISOString()

  let query = `
    SELECT
      p.id,
      p.match_id,
      p.predicted_home_score,
      p.predicted_away_score,
      p.points_awarded,
      p.created_at,
      p.updated_at,
      CASE WHEN m.start_time <= ? THEN 1 ELSE 0 END AS locked
    FROM predictions p
    JOIN matches m ON m.id = p.match_id
    WHERE p.user_id = ? AND p.group_id = ?
  `

  const params: (string | number)[] = [now, userId, groupId]

  if (matchId) {
    query += ` AND p.match_id = ?`
    params.push(matchId)
  }

  query += ` ORDER BY m.start_time ASC`

  const queryStartedAt = Date.now()
  const result = await db.prepare(query).bind(...params).all()
  const queryMs = Date.now() - queryStartedAt

  logRequestPerf('GET /predictions', {
    status: 200,
    totalMs: Date.now() - startedAt,
    dbMs: membershipMs + queryMs,
    rows: result.results.length,
    extra: {
      group_id: groupId,
      scoped_to_match: Boolean(matchId),
    },
  })

  return c.json({ predictions: result.results })
})

/**
 * GET /predictions/user?group_id=xxx&user_id=xxx
 *
 * Returns the predictions of a specific group member for all matches that have
 * already started (locked). These picks are always public once a match is locked,
 * so any group member can view them. This is used by the leaderboard modal so a
 * viewer can see exactly which scores a user predicted to arrive at their ranking.
 *
 * Response:
 * {
 *   predictions: [
 *     {
 *       match_id,
 *       predicted_home_score, predicted_away_score,
 *       points_awarded,
 *       match_status, match_start_time,
 *       home_score, away_score,
 *       round,
 *       home_team_name, home_team_short_name, home_team_logo,
 *       away_team_name, away_team_short_name, away_team_logo
 *     }
 *   ]
 * }
 */
router.get('/user', requireAuth, async (c) => {
  const startedAt = Date.now()
  const requesterId = c.get('userId')
  const groupId = c.req.query('group_id')
  const targetUserId = c.req.query('user_id')

  if (!groupId || !targetUserId) {
    return c.json({ error: 'group_id e user_id são obrigatórios' }, 400)
  }

  const db = c.env.DB

  // Requester must be a member of the group
  const membershipStartedAt = Date.now()
  const membership = await db
    .prepare(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`)
    .bind(groupId, requesterId)
    .first()
  const membershipMs = Date.now() - membershipStartedAt

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  const now = new Date().toISOString()

  // Only return predictions for matches that have already started (locked picks are public)
  const queryStartedAt = Date.now()
  const result = await db
    .prepare(
      `SELECT
         p.match_id,
         p.predicted_home_score,
         p.predicted_away_score,
         p.points_awarded,
         m.status AS match_status,
         m.start_time AS match_start_time,
         m.home_score,
         m.away_score,
         m.round,
         ht.name AS home_team_name,
         ht.short_name AS home_team_short_name,
         ht.logo_url AS home_team_logo,
         at.name AS away_team_name,
         at.short_name AS away_team_short_name,
         at.logo_url AS away_team_logo
       FROM predictions p
       JOIN matches m ON m.id = p.match_id
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE p.group_id = ? AND p.user_id = ? AND m.start_time <= ?
       ORDER BY m.start_time ASC`,
    )
    .bind(groupId, targetUserId, now)
    .all()
  const queryMs = Date.now() - queryStartedAt

  logRequestPerf('GET /predictions/user', {
    status: 200,
    totalMs: Date.now() - startedAt,
    dbMs: membershipMs + queryMs,
    rows: result.results.length,
    extra: { group_id: groupId, target_user_id: targetUserId },
  })

  return c.json({ predictions: result.results })
})

/**
 * GET /predictions/group?group_id=xxx
 *
 * Returns the predictions of ALL members of a group — for the social/tracking
 * view ("Palpites do grupo").
 *
 * Visibility rule (anti-copy): a member's prediction for a given match is only
 * revealed once the requesting user has submitted their OWN prediction for that
 * same match OR the match has already started (start_time <= now). Locked/past
 * matches are always revealed — the user can no longer predict, so hiding picks
 * would serve no purpose. Future matches where the requester hasn't predicted
 * yet are simply omitted — the frontend shows them as "hidden".
 *
 * The `locked` field is derived from match.start_time at runtime (ADR-004).
 *
 * Response:
 * {
 *   self_user_id: string,
 *   members: [{ user_id, display }],
 *   predictions: [
 *     {
 *       match_id, user_id, user_display,
 *       predicted_home_score, predicted_away_score, points_awarded, locked
 *     }
 *   ]
 * }
 */
router.get('/group', requireAuth, async (c) => {
  const startedAt = Date.now()
  const userId = c.get('userId')
  const groupId = c.req.query('group_id')

  if (!groupId) {
    return c.json({ error: 'group_id é obrigatório' }, 400)
  }

  const db = c.env.DB

  const membershipStartedAt = Date.now()
  const membership = await db
    .prepare(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`)
    .bind(groupId, userId)
    .first()
  const membershipMs = Date.now() - membershipStartedAt

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  const now = new Date().toISOString()

  // Group roster (for stable column/row ordering on the frontend)
  const membersStartedAt = Date.now()
  const membersResult = await db
    .prepare(
      `SELECT u.id AS user_id, COALESCE(p.nickname, u.email) AS display
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE gm.group_id = ?
       ORDER BY display ASC`,
    )
    .bind(groupId)
    .all<{ user_id: string; display: string }>()
  const membersMs = Date.now() - membersStartedAt

  // All members' predictions — revealed according to the anti-copy rule:
  //   • For future/unlocked matches: only shown if the requester has already
  //     submitted their own prediction for that match.
  //   • For past/locked matches (start_time <= now): always revealed, even if
  //     the requester never predicted — they can no longer predict, so hiding
  //     others' picks would be pointless.
  const predictionsStartedAt = Date.now()
  const predictionsResult = await db
    .prepare(
      `SELECT
         pr.match_id,
         pr.user_id,
         COALESCE(p.nickname, u.email) AS user_display,
         pr.predicted_home_score,
         pr.predicted_away_score,
         pr.points_awarded,
         CASE WHEN m.start_time <= ? THEN 1 ELSE 0 END AS locked
       FROM predictions pr
       JOIN users u ON u.id = pr.user_id
       LEFT JOIN profiles p ON p.user_id = pr.user_id
       JOIN matches m ON m.id = pr.match_id
       WHERE pr.group_id = ?
         AND (
           m.start_time <= ?
           OR pr.match_id IN (
             SELECT match_id FROM predictions WHERE group_id = ? AND user_id = ?
           )
         )
       ORDER BY m.start_time ASC, user_display ASC`,
    )
    .bind(now, groupId, now, groupId, userId)
    .all()
  const predictionsMs = Date.now() - predictionsStartedAt

  logRequestPerf('GET /predictions/group', {
    status: 200,
    totalMs: Date.now() - startedAt,
    dbMs: membershipMs + membersMs + predictionsMs,
    rows: predictionsResult.results.length,
    extra: {
      group_id: groupId,
      members: membersResult.results.length,
    },
  })

  return c.json({
    self_user_id: userId,
    members: membersResult.results,
    predictions: predictionsResult.results,
  })
})

/**
 * PUT /predictions
 *
 * Create or update a prediction (upsert by user_id + group_id + match_id).
 *
 * Prediction locking rules (ADR-004):
 *   - Predictions can be submitted or edited freely BEFORE match.start_time
 *   - Once match.start_time is reached, predictions are LOCKED — no edits allowed
 *   - If a match is rescheduled, the lock/unlock follows the new start_time automatically
 *
 * Body: { group_id, match_id, predicted_home_score, predicted_away_score }
 *
 * Errors:
 *   400 — missing/invalid fields
 *   403 — user not in group
 *   404 — match not found in group's competition
 *   422 — prediction locked (match already started)
 */
router.put('/', requireAuth, async (c) => {
  const userId = c.get('userId')

  let body: {
    group_id?: string
    match_id?: string
    predicted_home_score?: number
    predicted_away_score?: number
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Body JSON inválido' }, 400)
  }

  const { group_id, match_id, predicted_home_score, predicted_away_score } = body

  if (!group_id || !match_id || predicted_home_score === undefined || predicted_away_score === undefined) {
    return c.json(
      { error: 'group_id, match_id, predicted_home_score e predicted_away_score são obrigatórios' },
      400,
    )
  }

  if (
    !Number.isInteger(predicted_home_score) ||
    predicted_home_score < 0 ||
    !Number.isInteger(predicted_away_score) ||
    predicted_away_score < 0
  ) {
    return c.json({ error: 'Placar deve ser um inteiro não-negativo' }, 400)
  }

  const db = c.env.DB

  // Verify user is a member of the group
  const membership = await db
    .prepare(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`)
    .bind(group_id, userId)
    .first()

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  // Verify match belongs to the group's competition
  const match = await db
    .prepare(
      `SELECT m.id, m.start_time
       FROM matches m
       JOIN groups g ON g.competition_id = m.competition_id
       WHERE m.id = ? AND g.id = ?`,
    )
    .bind(match_id, group_id)
    .first<{ id: string; start_time: string }>()

  if (!match) {
    return c.json({ error: 'Jogo não encontrado nesta competição' }, 404)
  }

  // LOCK CHECK — derived at runtime from match.start_time (ADR-004)
  const now = new Date().toISOString()
  if (now >= match.start_time) {
    return c.json({ error: 'Palpite bloqueado — o jogo já começou' }, 422)
  }

  await db
    .prepare(
      `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, group_id, match_id) DO UPDATE SET
         predicted_home_score = excluded.predicted_home_score,
         predicted_away_score = excluded.predicted_away_score,
         updated_at           = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      group_id,
      match_id,
      predicted_home_score,
      predicted_away_score,
      now,
      now,
    )
    .run()

  return c.json({ ok: true })
})

/**
 * PUT /predictions/bulk
 *
 * Create or update MANY predictions in one request (upsert by
 * user_id + group_id + match_id). Used by the "Salvar todos" action so the user
 * can submit every prediction of a round at once instead of one at a time.
 *
 * Each match is validated independently against the same rules as PUT /:
 *   - the match must belong to the group's competition
 *   - the prediction must not be locked (match.start_time not yet reached — ADR-004)
 * Matches that fail a check are skipped (not the whole request) and reported back
 * so the frontend can keep the rest. Valid upserts run in a single D1 batch.
 *
 * Body: { group_id, predictions: [{ match_id, predicted_home_score, predicted_away_score }] }
 *
 * Response: { ok: true, saved: string[], locked: string[], not_found: string[] }
 *
 * Errors:
 *   400 — missing/invalid fields
 *   403 — user not in group
 */
router.put('/bulk', requireAuth, async (c) => {
  const userId = c.get('userId')

  let body: {
    group_id?: string
    predictions?: Array<{
      match_id?: string
      predicted_home_score?: number
      predicted_away_score?: number
    }>
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Body JSON inválido' }, 400)
  }

  const { group_id, predictions } = body

  if (!group_id) {
    return c.json({ error: 'group_id é obrigatório' }, 400)
  }

  if (!Array.isArray(predictions) || predictions.length === 0) {
    return c.json({ error: 'predictions deve ser uma lista não-vazia' }, 400)
  }

  for (const p of predictions) {
    if (
      !p ||
      typeof p.match_id !== 'string' ||
      !Number.isInteger(p.predicted_home_score) ||
      (p.predicted_home_score as number) < 0 ||
      !Number.isInteger(p.predicted_away_score) ||
      (p.predicted_away_score as number) < 0
    ) {
      return c.json(
        { error: 'Cada palpite precisa de match_id e placares inteiros não-negativos' },
        400,
      )
    }
  }

  const db = c.env.DB

  // Verify user is a member of the group
  const membership = await db
    .prepare(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`)
    .bind(group_id, userId)
    .first()

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  // Dedupe by match_id (last value wins) so the IN-clause and batch stay 1:1
  const byMatch = new Map<string, { home: number; away: number }>()
  for (const p of predictions) {
    byMatch.set(p.match_id as string, {
      home: p.predicted_home_score as number,
      away: p.predicted_away_score as number,
    })
  }
  const matchIds = Array.from(byMatch.keys())

  // Fetch all referenced matches that actually belong to the group's competition
  const placeholders = matchIds.map(() => '?').join(', ')
  const matchRows = await db
    .prepare(
      `SELECT m.id, m.start_time
       FROM matches m
       JOIN groups g ON g.competition_id = m.competition_id
       WHERE g.id = ? AND m.id IN (${placeholders})`,
    )
    .bind(group_id, ...matchIds)
    .all<{ id: string; start_time: string }>()

  const startTimes = new Map(matchRows.results.map((m) => [m.id, m.start_time]))
  const now = new Date().toISOString()

  const saved: string[] = []
  const locked: string[] = []
  const notFound: string[] = []
  const statements: D1PreparedStatement[] = []

  for (const matchId of matchIds) {
    const startTime = startTimes.get(matchId)
    if (!startTime) {
      notFound.push(matchId)
      continue
    }
    // LOCK CHECK — derived at runtime from match.start_time (ADR-004)
    if (now >= startTime) {
      locked.push(matchId)
      continue
    }

    const { home, away } = byMatch.get(matchId)!
    statements.push(
      db
        .prepare(
          `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, group_id, match_id) DO UPDATE SET
             predicted_home_score = excluded.predicted_home_score,
             predicted_away_score = excluded.predicted_away_score,
             updated_at           = excluded.updated_at`,
        )
        .bind(crypto.randomUUID(), userId, group_id, matchId, home, away, now, now),
    )
    saved.push(matchId)
  }

  if (statements.length > 0) {
    await db.batch(statements)
  }

  return c.json({ ok: true, saved, locked, not_found: notFound })
})

/**
 * POST /predictions/import
 *
 * Copies the authenticated user's predictions from one group to another group
 * of the same competition. Useful when a user belongs to multiple groups and
 * wants to reuse the same predictions.
 *
 * Only unlocked predictions (match.start_time > now) are copied. Already-locked
 * matches are silently skipped and reported in `locked_skipped`. Existing
 * predictions in the target group are overwritten.
 *
 * Body: { source_group_id, target_group_id }
 *
 * Response: { ok: true, imported: number, locked_skipped: number }
 *
 * Errors:
 *   400 — missing/invalid fields
 *   403 — user not in one of the groups
 *   404 — group not found
 *   422 — groups belong to different competitions
 */
router.post('/import', requireAuth, async (c) => {
  const userId = c.get('userId')

  let body: { source_group_id?: string; target_group_id?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Body JSON inválido' }, 400)
  }

  const { source_group_id, target_group_id } = body

  if (!source_group_id || !target_group_id) {
    return c.json(
      { error: 'source_group_id e target_group_id são obrigatórios' },
      400,
    )
  }

  if (source_group_id === target_group_id) {
    return c.json(
      { error: 'source_group_id e target_group_id devem ser diferentes' },
      400,
    )
  }

  const db = c.env.DB

  // Verify user is a member of both groups
  const [sourceMembership, targetMembership] = await Promise.all([
    db
      .prepare(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`)
      .bind(source_group_id, userId)
      .first(),
    db
      .prepare(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`)
      .bind(target_group_id, userId)
      .first(),
  ])

  if (!sourceMembership) {
    return c.json({ error: 'Acesso negado ao grupo de origem' }, 403)
  }

  if (!targetMembership) {
    return c.json({ error: 'Acesso negado ao grupo de destino' }, 403)
  }

  // Verify both groups belong to the same competition
  const [sourceGroup, targetGroup] = await Promise.all([
    db
      .prepare(`SELECT competition_id FROM groups WHERE id = ?`)
      .bind(source_group_id)
      .first<{ competition_id: string }>(),
    db
      .prepare(`SELECT competition_id FROM groups WHERE id = ?`)
      .bind(target_group_id)
      .first<{ competition_id: string }>(),
  ])

  if (!sourceGroup || !targetGroup) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  if (sourceGroup.competition_id !== targetGroup.competition_id) {
    return c.json(
      { error: 'Os grupos pertencem a campeonatos diferentes' },
      422,
    )
  }

  const now = new Date().toISOString()

  // Fetch user's predictions from source group for unlocked matches only
  const sourcePredictions = await db
    .prepare(
      `SELECT p.match_id, p.predicted_home_score, p.predicted_away_score
       FROM predictions p
       JOIN matches m ON m.id = p.match_id
       WHERE p.user_id = ? AND p.group_id = ? AND m.start_time > ?`,
    )
    .bind(userId, source_group_id, now)
    .all<{
      match_id: string
      predicted_home_score: number
      predicted_away_score: number
    }>()

  const toImport = sourcePredictions.results

  // Count total source predictions to report how many were locked-skipped
  const totalCount = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM predictions WHERE user_id = ? AND group_id = ?`,
    )
    .bind(userId, source_group_id)
    .first<{ total: number }>()

  const lockedSkipped = (totalCount?.total ?? 0) - toImport.length

  if (toImport.length === 0) {
    return c.json({ ok: true, imported: 0, locked_skipped: lockedSkipped })
  }

  // Upsert all importable predictions in a single batch
  const importStatements = toImport.map((p) =>
    db
      .prepare(
        `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, group_id, match_id) DO UPDATE SET
           predicted_home_score = excluded.predicted_home_score,
           predicted_away_score = excluded.predicted_away_score,
           updated_at           = excluded.updated_at`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        target_group_id,
        p.match_id,
        p.predicted_home_score,
        p.predicted_away_score,
        now,
        now,
      ),
  )

  await db.batch(importStatements)

  return c.json({ ok: true, imported: toImport.length, locked_skipped: lockedSkipped })
})

export { router as predictionsRouter }
