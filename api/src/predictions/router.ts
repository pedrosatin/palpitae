import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
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
  const userId = c.get('userId')
  const groupId = c.req.query('group_id')
  const matchId = c.req.query('match_id')

  if (!groupId) {
    return c.json({ error: 'group_id é obrigatório' }, 400)
  }

  const db = c.env.DB

  const membership = await db
    .prepare(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`)
    .bind(groupId, userId)
    .first()

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

  const result = await db.prepare(query).bind(...params).all()
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
 * same match. Matches the requester hasn't predicted yet are simply omitted —
 * the frontend shows them as "hidden" until the user palpita.
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
  const userId = c.get('userId')
  const groupId = c.req.query('group_id')

  if (!groupId) {
    return c.json({ error: 'group_id é obrigatório' }, 400)
  }

  const db = c.env.DB

  const membership = await db
    .prepare(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`)
    .bind(groupId, userId)
    .first()

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  const now = new Date().toISOString()

  // Group roster (for stable column/row ordering on the frontend)
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

  // All members' predictions — but only for matches the requester has already
  // predicted (the anti-copy reveal rule).
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
         AND pr.match_id IN (
           SELECT match_id FROM predictions WHERE group_id = ? AND user_id = ?
         )
       ORDER BY m.start_time ASC, user_display ASC`,
    )
    .bind(now, groupId, groupId, userId)
    .all()

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

export { router as predictionsRouter }
