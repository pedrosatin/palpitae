import { type Context, Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { isMatchLocked, lockedSql } from '../matches/locking'
import { matchGoesToPenalties, parsePenaltyPhases } from '../matches/penalties'
import { roundLabel } from '../matches/rounds'
import { hashUserId, logEvent, logRequestPerf } from '../observability'
import type { AppContext } from '../types'
import { getGroupMembershipTimed } from '../groups/membership'

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Parses the request JSON body. Returns `{ ok: true, body }` on success or
 * `{ ok: false, response }` when parsing fails so the caller can return early.
 */
async function parseJsonBody<T>(
  c: Context<AppContext>,
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
  try {
    const body = await c.req.json<T>()
    return { ok: true, body }
  } catch {
    return { ok: false, response: c.json({ error: 'Body JSON inválido' }, 400) }
  }
}

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

  const { membership, membershipMs } = await getGroupMembershipTimed(db, groupId, userId)

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
      p.predicted_penalty_winner,
      p.points_awarded,
      p.penalty_points,
      p.created_at,
      p.updated_at,
      CASE WHEN ${lockedSql()} THEN 1 ELSE 0 END AS locked
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
  const result = await db
    .prepare(query)
    .bind(...params)
    .all()
  const queryMs = Date.now() - queryStartedAt

  logRequestPerf(c.env.AE, 'GET /predictions', {
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
  const { membership, membershipMs } = await getGroupMembershipTimed(db, groupId, requesterId)

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  const now = new Date().toISOString()

  // Fetch all matches for the group's competition, left-joining predictions.
  // The join condition restricts predictions to LOCKED matches (anti-copy: picks
  // that can still be edited are not revealed even if the target user already
  // submitted them). Jogo adiado não conta como começado — ver locking.ts.
  const queryStartedAt = Date.now()
  const batchResults = await db.batch([
    db
      .prepare(
        `SELECT
           m.id AS match_id,
           p.predicted_home_score,
           p.predicted_away_score,
           p.predicted_penalty_winner,
           p.points_awarded,
           p.penalty_points,
           m.status AS match_status,
           m.start_time AS match_start_time,
           m.home_score,
           m.away_score,
           m.penalty_winner,
           m.home_penalty_goals,
           m.away_penalty_goals,
           m.round,
           m.group_name,
           ht.name AS home_team_name,
           ht.short_name AS home_team_short_name,
           ht.logo_url AS home_team_logo,
           at.name AS away_team_name,
           at.short_name AS away_team_short_name,
           at.logo_url AS away_team_logo
         FROM matches m
         JOIN groups g ON g.competition_id = m.competition_id AND g.id = ?
         JOIN teams ht ON ht.id = m.home_team_id
         JOIN teams at ON at.id = m.away_team_id
         LEFT JOIN predictions p
           ON p.match_id = m.id AND p.group_id = ? AND p.user_id = ? AND ${lockedSql()}
         ORDER BY CAST(m.round AS INTEGER) ASC, m.group_name ASC NULLS LAST, m.start_time ASC`,
      )
      .bind(groupId, groupId, targetUserId, now),
    db
      .prepare(
        `SELECT round FROM matches
         WHERE competition_id = (SELECT competition_id FROM groups WHERE id = ?)
         GROUP BY round
         HAVING MAX(start_time) > ?
         ORDER BY MAX(start_time) ASC
         LIMIT 1`,
      )
      .bind(groupId, now),
    db
      .prepare(
        `SELECT round FROM matches
         WHERE competition_id = (SELECT competition_id FROM groups WHERE id = ?)
         ORDER BY start_time DESC
         LIMIT 1`,
      )
      .bind(groupId),
  ])
  const queryMs = Date.now() - queryStartedAt

  const predictions = batchResults[0].results
  const activeRound = (batchResults[1].results as { round?: string }[])[0]?.round
  const lastRound = (batchResults[2].results as { round?: string }[])[0]?.round
  const defaultRound: string | null = activeRound ?? lastRound ?? null

  type RawPrediction = Record<string, unknown> & { round: string }
  const predictionsWithLabel = (predictions as RawPrediction[]).map((p) => ({
    ...p,
    round_label: roundLabel(p.round),
  }))

  logRequestPerf(c.env.AE, 'GET /predictions/user', {
    status: 200,
    totalMs: Date.now() - startedAt,
    dbMs: membershipMs + queryMs,
    rows: predictions.length,
    extra: { group_id: groupId, target_user_id: targetUserId },
  })

  return c.json({
    predictions: predictionsWithLabel,
    default_round: defaultRound,
  })
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

  const { membership, membershipMs } = await getGroupMembershipTimed(db, groupId, userId)

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  // Visibility mode is set at group creation and immutable (migration 0008).
  // 'public' shows everyone's picks in real time; 'hidden' applies the anti-copy rule.
  const groupConfig = await db
    .prepare(`SELECT predictions_visibility FROM groups WHERE id = ? AND deleted_at IS NULL`)
    .bind(groupId)
    .first<{ predictions_visibility: string }>()

  if (!groupConfig) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  const isPublic = groupConfig.predictions_visibility === 'public'

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
  //   • For past/locked matches (start_time <= now e não adiado): always revealed,
  //     even if the requester never predicted — they can no longer predict, so
  //     hiding others' picks would be pointless.
  // A condição de revelação é a MESMA do campo `locked` (locking.ts) de propósito:
  // se um jogo adiado revelasse os palpites alheios enquanto ainda aceita edição,
  // daria pra copiar.
  const predictionsStartedAt = Date.now()
  const predictionsResult = isPublic
    ? // Public group: every member's picks are visible in real time, no anti-copy filter.
      await db
        .prepare(
          `SELECT
             pr.match_id,
             pr.user_id,
             COALESCE(p.nickname, u.email) AS user_display,
             pr.predicted_home_score,
             pr.predicted_away_score,
             pr.predicted_penalty_winner,
             pr.points_awarded,
             pr.penalty_points,
             CASE WHEN ${lockedSql()} THEN 1 ELSE 0 END AS locked
           FROM predictions pr
           JOIN users u ON u.id = pr.user_id
           LEFT JOIN profiles p ON p.user_id = pr.user_id
           JOIN matches m ON m.id = pr.match_id
           WHERE pr.group_id = ?
           ORDER BY m.start_time ASC, user_display ASC`,
        )
        .bind(now, groupId)
        .all()
    : // Hidden group (default): a member's pick for a match is only revealed once the
      // requester has predicted that same match OR the match has already started.
      await db
        .prepare(
          `SELECT
             pr.match_id,
             pr.user_id,
             COALESCE(p.nickname, u.email) AS user_display,
             pr.predicted_home_score,
             pr.predicted_away_score,
             pr.predicted_penalty_winner,
             pr.points_awarded,
             pr.penalty_points,
             CASE WHEN ${lockedSql()} THEN 1 ELSE 0 END AS locked
           FROM predictions pr
           JOIN users u ON u.id = pr.user_id
           LEFT JOIN profiles p ON p.user_id = pr.user_id
           JOIN matches m ON m.id = pr.match_id
           WHERE pr.group_id = ?
             AND (
               ${lockedSql()}
               OR pr.match_id IN (
                 SELECT match_id FROM predictions WHERE group_id = ? AND user_id = ?
               )
             )
           ORDER BY m.start_time ASC, user_display ASC`,
        )
        .bind(now, groupId, now, groupId, userId)
        .all()
  const predictionsMs = Date.now() - predictionsStartedAt

  logRequestPerf(c.env.AE, 'GET /predictions/group', {
    status: 200,
    totalMs: Date.now() - startedAt,
    dbMs: membershipMs + membersMs + predictionsMs,
    rows: predictionsResult.results.length,
    extra: {
      group_id: groupId,
      members: membersResult.results.length,
      visibility: groupConfig.predictions_visibility,
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
 *   - Jogo adiado (`postponed = 1`) NÃO trava, mesmo com start_time no passado
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

  type PutBody = {
    group_id?: string
    match_id?: string
    predicted_home_score?: number
    predicted_away_score?: number
    predicted_penalty_winner?: 'home' | 'away' | null
  }
  const parsed = await parseJsonBody<PutBody>(c)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  const {
    group_id,
    match_id,
    predicted_home_score,
    predicted_away_score,
    predicted_penalty_winner,
  } = body

  if (
    !group_id ||
    !match_id ||
    predicted_home_score === undefined ||
    predicted_away_score === undefined
  ) {
    return c.json(
      {
        error: 'group_id, match_id, predicted_home_score e predicted_away_score são obrigatórios',
      },
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
  const { membership } = await getGroupMembershipTimed(db, group_id, userId)

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  // Verify match belongs to the group's competition. Also pull the penalty gate
  // (phase + competition.penalty_phases) so we can validate the shootout pick.
  const match = await db
    .prepare(
      `SELECT m.id, m.start_time, m.postponed, m.round, m.phase, c.penalty_phases
       FROM matches m
       JOIN groups g ON g.competition_id = m.competition_id
       JOIN competitions c ON c.id = m.competition_id
       WHERE m.id = ? AND g.id = ?`,
    )
    .bind(match_id, group_id)
    .first<{
      id: string
      start_time: string
      postponed: number
      round: string
      phase: string | null
      penalty_phases: string
    }>()

  if (!match) {
    return c.json({ error: 'Jogo não encontrado nesta competição' }, 404)
  }

  // LOCK CHECK — derived at runtime from match.start_time (ADR-004)
  const now = new Date().toISOString()
  if (isMatchLocked(match, now)) {
    return c.json({ error: 'Palpite bloqueado — o jogo já começou' }, 422)
  }

  // Penalty pick: required only for a draw in an eligible (competition, phase).
  // Otherwise it's nulled out — a decisive pick or a non-shootout phase carries
  // no penalty winner, so we never persist a stale one.
  const isDraw = predicted_home_score === predicted_away_score
  const eligible = matchGoesToPenalties(parsePenaltyPhases(match.penalty_phases), match.phase)
  let penaltyWinner: 'home' | 'away' | null = null
  if (isDraw && eligible) {
    if (predicted_penalty_winner !== 'home' && predicted_penalty_winner !== 'away') {
      return c.json(
        {
          error:
            'predicted_penalty_winner é obrigatório (home ou away) num palpite de empate decidido nos pênaltis',
        },
        400,
      )
    }
    penaltyWinner = predicted_penalty_winner
  }

  await db
    .prepare(
      `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, predicted_penalty_winner, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, group_id, match_id) DO UPDATE SET
         predicted_home_score     = excluded.predicted_home_score,
         predicted_away_score     = excluded.predicted_away_score,
         predicted_penalty_winner = excluded.predicted_penalty_winner,
         updated_at               = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      group_id,
      match_id,
      predicted_home_score,
      predicted_away_score,
      penaltyWinner,
      now,
      now,
    )
    .run()

  logEvent(c.env.AE, 'prediction_saved', {
    blobs: [group_id, match.round, await hashUserId(userId), 'single'],
    doubles: [1],
  })

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
type BulkPrediction = {
  match_id?: string
  predicted_home_score?: number
  predicted_away_score?: number
  predicted_penalty_winner?: 'home' | 'away' | null
}

type BulkBody = {
  group_id?: string
  predictions?: Array<BulkPrediction>
}

function validateBulkPutPayload(body: BulkBody): string | null {
  if (!body.group_id) {
    return 'group_id é obrigatório'
  }

  if (!Array.isArray(body.predictions) || body.predictions.length === 0) {
    return 'predictions deve ser uma lista não-vazia'
  }

  for (const p of body.predictions) {
    if (
      !p ||
      typeof p.match_id !== 'string' ||
      !Number.isInteger(p.predicted_home_score) ||
      (p.predicted_home_score as number) < 0 ||
      !Number.isInteger(p.predicted_away_score) ||
      (p.predicted_away_score as number) < 0
    ) {
      return 'Cada palpite precisa de match_id e placares inteiros não-negativos'
    }
  }

  return null
}

function buildBulkPutStatements(
  db: D1Database,
  userId: string,
  groupId: string,
  byMatch: Map<string, { home: number; away: number; penaltyWinner?: 'home' | 'away' | null }>,
  matchInfo: Map<
    string,
    {
      id: string
      start_time: string
      postponed: number
      phase: string | null
      penalty_phases: string
    }
  >,
  now: string,
) {
  const saved: string[] = []
  const locked: string[] = []
  const notFound: string[] = []
  const invalidPenalty: string[] = []
  const statements: D1PreparedStatement[] = []

  const insertStmt = db.prepare(
    `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, predicted_penalty_winner, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, group_id, match_id) DO UPDATE SET
       predicted_home_score     = excluded.predicted_home_score,
       predicted_away_score     = excluded.predicted_away_score,
       predicted_penalty_winner = excluded.predicted_penalty_winner,
       updated_at               = excluded.updated_at`,
  )

  for (const [matchId, matchData] of byMatch.entries()) {
    const info = matchInfo.get(matchId)
    if (!info) {
      notFound.push(matchId)
      continue
    }

    // LOCK CHECK — derived at runtime from match.start_time (ADR-004)
    if (isMatchLocked(info, now)) {
      locked.push(matchId)
      continue
    }

    const { home, away, penaltyWinner: rawPenaltyWinner } = matchData

    // Same penalty validation as PUT /: required for a draw in an eligible phase,
    // nulled out otherwise.
    const isDraw = home === away
    const eligible = matchGoesToPenalties(parsePenaltyPhases(info.penalty_phases), info.phase)
    let penaltyWinner: 'home' | 'away' | null = null

    if (isDraw && eligible) {
      if (rawPenaltyWinner !== 'home' && rawPenaltyWinner !== 'away') {
        invalidPenalty.push(matchId)
        continue
      }
      penaltyWinner = rawPenaltyWinner
    }

    statements.push(
      insertStmt.bind(
        crypto.randomUUID(),
        userId,
        groupId,
        matchId,
        home,
        away,
        penaltyWinner,
        now,
        now,
      ),
    )
    saved.push(matchId)
  }

  return { saved, locked, notFound, invalidPenalty, statements }
}

async function handleBulkPut(c: Context<AppContext>) {
  const userId = c.get('userId')

  const parsed = await parseJsonBody<BulkBody>(c)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  const validationError = validateBulkPutPayload(body)
  if (validationError) {
    return c.json({ error: validationError }, 400)
  }

  const { group_id, predictions } = body

  const db = c.env.DB

  // Verify user is a member of the group
  const { membership } = await getGroupMembershipTimed(db, group_id as string, userId)

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  // Dedupe by match_id (last value wins) so the IN-clause and batch stay 1:1
  const byMatch = new Map<
    string,
    { home: number; away: number; penaltyWinner?: 'home' | 'away' | null }
  >()
  for (const p of predictions!) {
    byMatch.set(p.match_id as string, {
      home: p.predicted_home_score as number,
      away: p.predicted_away_score as number,
      penaltyWinner: p.predicted_penalty_winner ?? null,
    })
  }
  const matchIds = Array.from(byMatch.keys())

  // Fetch all referenced matches that actually belong to the group's competition.
  // phase + competition.penalty_phases drive the per-match penalty gate.
  const placeholders = matchIds.map(() => '?').join(', ')
  const matchRows = await db
    .prepare(
      `SELECT m.id, m.start_time, m.postponed, m.phase, c.penalty_phases
       FROM matches m
       JOIN groups g ON g.competition_id = m.competition_id
       JOIN competitions c ON c.id = m.competition_id
       WHERE g.id = ? AND m.id IN (${placeholders})`,
    )
    .bind(group_id, ...matchIds)
    .all<{
      id: string
      start_time: string
      postponed: number
      phase: string | null
      penalty_phases: string
    }>()

  const matchInfo = new Map(matchRows.results.map((m) => [m.id, m]))
  const now = new Date().toISOString()

  const { saved, locked, notFound, invalidPenalty, statements } = buildBulkPutStatements(
    db,
    userId,
    group_id as string,
    byMatch,
    matchInfo,
    now,
  )

  // Reject the whole request when any eligible draw is missing its shootout winner
  // — same rule as the singular endpoint, so the client can't silently lose a pick.
  if (invalidPenalty.length > 0) {
    return c.json(
      {
        error:
          'predicted_penalty_winner é obrigatório (home ou away) para palpites de empate decididos nos pênaltis',
        invalid_penalty: invalidPenalty,
      },
      400,
    )
  }

  if (statements.length > 0) {
    await db.batch(statements)
    logEvent(c.env.AE, 'prediction_saved', {
      blobs: [group_id!, '', await hashUserId(userId), 'bulk'], // round vazio: múltiplas rodadas
      doubles: [saved.length],
    })
  }

  return c.json({ ok: true, saved, locked, not_found: notFound })
}

router.put('/bulk', requireAuth, handleBulkPut)

/**
 * POST /predictions/import
 *
 * Copies the authenticated user's predictions from one group to another group
 * of the same competition. Useful when a user belongs to multiple groups and
 * wants to reuse the same predictions.
 *
 * Only unlocked predictions (jogo ainda não começou, ou adiado) are copied. Already-locked
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
async function verifyGroupsForImport(
  db: D1Database,
  userId: string,
  sourceGroupId: string,
  targetGroupId: string,
) {
  // Verify user is a member of both groups
  const memberships = await db
    .prepare(`SELECT group_id FROM group_members WHERE group_id IN (?, ?) AND user_id = ?`)
    .bind(sourceGroupId, targetGroupId, userId)
    .all<{ group_id: string }>()

  const sourceMembership = memberships.results.find((m) => m.group_id === sourceGroupId)
  const targetMembership = memberships.results.find((m) => m.group_id === targetGroupId)

  if (!sourceMembership) {
    return { error: 'Acesso negado ao grupo de origem', status: 403 }
  }

  if (!targetMembership) {
    return { error: 'Acesso negado ao grupo de destino', status: 403 }
  }

  // Verify both groups belong to the same competition
  const [sourceGroup, targetGroup] = await Promise.all([
    db
      .prepare(`SELECT competition_id FROM groups WHERE id = ? AND deleted_at IS NULL`)
      .bind(sourceGroupId)
      .first<{ competition_id: string }>(),
    db
      .prepare(`SELECT competition_id FROM groups WHERE id = ? AND deleted_at IS NULL`)
      .bind(targetGroupId)
      .first<{ competition_id: string }>(),
  ])

  if (!sourceGroup || !targetGroup) {
    return { error: 'Grupo não encontrado', status: 404 }
  }

  if (sourceGroup.competition_id !== targetGroup.competition_id) {
    return { error: 'Os grupos pertencem a campeonatos diferentes', status: 422 }
  }

  return null
}

async function fetchPredictionsToImport(
  db: D1Database,
  userId: string,
  sourceGroupId: string,
  now: string,
) {
  // Fetch user's predictions from source group for unlocked matches only
  const sourcePredictions = await db
    .prepare(
      `SELECT p.match_id, p.predicted_home_score, p.predicted_away_score, p.predicted_penalty_winner
       FROM predictions p
       JOIN matches m ON m.id = p.match_id
       WHERE p.user_id = ? AND p.group_id = ? AND NOT ${lockedSql()}`,
    )
    .bind(userId, sourceGroupId, now)
    .all<{
      match_id: string
      predicted_home_score: number
      predicted_away_score: number
      predicted_penalty_winner: 'home' | 'away' | null
    }>()

  const toImport = sourcePredictions.results

  // Count total source predictions to report how many were locked-skipped
  const totalCount = await db
    .prepare(`SELECT COUNT(*) AS total FROM predictions WHERE user_id = ? AND group_id = ?`)
    .bind(userId, sourceGroupId)
    .first<{ total: number }>()

  const lockedSkipped = (totalCount?.total ?? 0) - toImport.length

  return { toImport, lockedSkipped }
}

async function handleImportPost(c: Context<AppContext>) {
  const userId = c.get('userId')

  type ImportBody = { source_group_id?: string; target_group_id?: string }
  const parsed = await parseJsonBody<ImportBody>(c)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  const { source_group_id, target_group_id } = body

  if (!source_group_id || !target_group_id) {
    return c.json({ error: 'source_group_id e target_group_id são obrigatórios' }, 400)
  }

  if (source_group_id === target_group_id) {
    return c.json({ error: 'source_group_id e target_group_id devem ser diferentes' }, 400)
  }

  const db = c.env.DB

  const validationError = await verifyGroupsForImport(db, userId, source_group_id, target_group_id)
  if (validationError) {
    return c.json({ error: validationError.error }, validationError.status as any)
  }

  const now = new Date().toISOString()
  const { toImport, lockedSkipped } = await fetchPredictionsToImport(
    db,
    userId,
    source_group_id,
    now,
  )

  if (toImport.length === 0) {
    return c.json({ ok: true, imported: 0, locked_skipped: lockedSkipped })
  }

  // Upsert all importable predictions in a single batch
  const importStmt = db.prepare(
    `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, predicted_penalty_winner, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, group_id, match_id) DO UPDATE SET
       predicted_home_score     = excluded.predicted_home_score,
       predicted_away_score     = excluded.predicted_away_score,
       predicted_penalty_winner = excluded.predicted_penalty_winner,
       updated_at               = excluded.updated_at`,
  )

  const importStatements = toImport.map((p) =>
    importStmt.bind(
      crypto.randomUUID(),
      userId,
      target_group_id,
      p.match_id,
      p.predicted_home_score,
      p.predicted_away_score,
      p.predicted_penalty_winner,
      now,
      now,
    ),
  )

  await db.batch(importStatements)

  logEvent(c.env.AE, 'prediction_saved', {
    blobs: [target_group_id, '', await hashUserId(userId), 'import'],
    doubles: [toImport.length],
  })

  return c.json({
    ok: true,
    imported: toImport.length,
    locked_skipped: lockedSkipped,
  })
}

router.post('/import', requireAuth, handleImportPost)

export { router as predictionsRouter }
