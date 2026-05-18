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

export { router as predictionsRouter }
