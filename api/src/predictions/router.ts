import { type Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { requireAuth } from '../auth/middleware'
import { hasPilotAccess } from '../auth/permissions'
import { isMatchLocked, lockedSql } from '../matches/locking'
import { matchGoesToPenalties, parsePenaltyPhases } from '../matches/penalties'
import { roundLabel } from '../matches/rounds'
import { resolveSingleMatchClassified, resolveTwoLegClassified } from '../matches/scoring'
import { hashUserId, logEvent, logRequestPerf } from '../observability'
import type { AppContext } from '../types'
import { getGroupMembership, getGroupMembershipTimed } from '../groups/membership'

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

async function isPilotGroupBlocked(
  c: Context<AppContext>,
  db: D1Database,
  groupId: string,
): Promise<boolean> {
  if (hasPilotAccess(c.get('userEmail'), c.env)) return false
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

type MatchKnockoutMeta = {
  id: string
  phase: string | null
  leg?: 1 | 2 | null
  home_team_id?: string
  away_team_id?: string
  penalty_phases?: string | null
}

type Leg1ScorePair = {
  homeScore: number
  awayScore: number
}

function computePredictedClassifiedForRow(
  meta: MatchKnockoutMeta,
  predictedHome: number | null | undefined,
  predictedAway: number | null | undefined,
  predictedPenaltyWinner: 'home' | 'away' | null | undefined,
  leg1Score: Leg1ScorePair | null,
): 'home' | 'away' | null {
  if (
    predictedHome === null ||
    predictedHome === undefined ||
    predictedAway === null ||
    predictedAway === undefined
  ) {
    return null
  }
  const eligible = matchGoesToPenalties(parsePenaltyPhases(meta.penalty_phases ?? null), meta.phase)
  if (!eligible || meta.leg === 1) return null

  const penWinner = predictedPenaltyWinner ?? null
  if (meta.leg === 2) {
    if (!leg1Score) return null
    return resolveTwoLegClassified(leg1Score, {
      homeScore: predictedHome,
      awayScore: predictedAway,
      penaltyWinner: penWinner,
    })
  }

  return resolveSingleMatchClassified(predictedHome, predictedAway, penWinner)
}

async function fetchSingleUserLeg1Map(
  db: D1Database,
  groupId: string,
  userId: string,
  rows: Array<Record<string, unknown>>,
): Promise<Map<string, Leg1ScorePair>> {
  const leg1Map = new Map<string, Leg1ScorePair>()
  const hasLeg2 = rows.some((r) => r.leg === 2 && r.predicted_home_score !== null && r.predicted_home_score !== undefined)
  if (!hasLeg2) return leg1Map

  for (const r of rows) {
    if (
      r.leg === 1 &&
      r.phase &&
      r.home_team_id &&
      r.away_team_id &&
      typeof r.predicted_home_score === 'number' &&
      typeof r.predicted_away_score === 'number'
    ) {
      leg1Map.set(`${r.phase}:${r.home_team_id}:${r.away_team_id}`, {
        homeScore: r.predicted_home_score,
        awayScore: r.predicted_away_score,
      })
    }
  }

  const missingLeg1 = rows.some(
    (r) =>
      r.leg === 2 &&
      r.phase &&
      r.home_team_id &&
      r.away_team_id &&
      !leg1Map.has(`${r.phase}:${r.away_team_id}:${r.home_team_id}`),
  )
  if (!missingLeg1) return leg1Map

  const leg1Rows = await db
    .prepare(
      `SELECT m.phase, m.home_team_id, m.away_team_id, p.predicted_home_score, p.predicted_away_score
       FROM predictions p
       JOIN matches m ON m.id = p.match_id
       WHERE p.group_id = ? AND p.user_id = ? AND m.leg = 1`,
    )
    .bind(groupId, userId)
    .all<{
      phase: string | null
      home_team_id: string
      away_team_id: string
      predicted_home_score: number
      predicted_away_score: number
    }>()

  for (const r of leg1Rows.results) {
    if (!r.phase) continue
    leg1Map.set(`${r.phase}:${r.home_team_id}:${r.away_team_id}`, {
      homeScore: r.predicted_home_score,
      awayScore: r.predicted_away_score,
    })
  }

  return leg1Map
}

function attachPredictedClassifiedToRows(
  rows: Array<Record<string, unknown>>,
  resolveLeg1: (row: Record<string, unknown>) => Leg1ScorePair | null,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const {
      leg,
      phase,
      home_team_id,
      away_team_id,
      penalty_phases,
      ...rest
    } = row
    const meta: MatchKnockoutMeta = {
      id: (row.match_id as string) ?? '',
      phase: (phase as string | null) ?? null,
      leg: (leg as 1 | 2 | null) ?? null,
      home_team_id: home_team_id as string | undefined,
      away_team_id: away_team_id as string | undefined,
      penalty_phases: (penalty_phases as string | null) ?? null,
    }
    const predictedClassified = computePredictedClassifiedForRow(
      meta,
      row.predicted_home_score as number | null | undefined,
      row.predicted_away_score as number | null | undefined,
      row.predicted_penalty_winner as 'home' | 'away' | null | undefined,
      resolveLeg1(row),
    )
    return {
      ...rest,
      classified_points:
        row.predicted_home_score === null || row.predicted_home_score === undefined
          ? (row.classified_points ?? null)
          : (row.classified_points ?? 0),
      predicted_classified: predictedClassified,
    }
  })
}

const router = new Hono<AppContext>()

/**
 * GET /predictions?group_id=xxx[&match_id=xxx]
 *
 * Returns predictions of the authenticated user in a group.
 * Optionally scoped to a single match.
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

  if (await isPilotGroupBlocked(c, db, groupId)) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

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
      p.classified_points,
      p.created_at,
      p.updated_at,
      m.phase,
      m.leg,
      m.home_team_id,
      m.away_team_id,
      c.penalty_phases,
      CASE WHEN ${lockedSql()} THEN 1 ELSE 0 END AS locked
    FROM predictions p
    JOIN matches m ON m.id = p.match_id
    JOIN competitions c ON c.id = m.competition_id
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
    .all<Record<string, unknown>>()
  const leg1Map = await fetchSingleUserLeg1Map(db, groupId, userId, result.results)
  const queryMs = Date.now() - queryStartedAt

  const predictionsOut = attachPredictedClassifiedToRows(result.results, (r) =>
    r.phase && r.home_team_id && r.away_team_id
      ? (leg1Map.get(`${r.phase}:${r.away_team_id}:${r.home_team_id}`) ?? null)
      : null,
  )

  logRequestPerf(c.env.AE, 'GET /predictions', {
    status: 200,
    totalMs: Date.now() - startedAt,
    dbMs: membershipMs + queryMs,
    rows: predictionsOut.length,
    extra: {
      group_id: groupId,
      scoped_to_match: Boolean(matchId),
    },
  })

  return c.json({ predictions: predictionsOut })
})

/**
 * GET /predictions/user?group_id=xxx&user_id=xxx
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

  if (await isPilotGroupBlocked(c, db, groupId)) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  const { membership, membershipMs } = await getGroupMembershipTimed(db, groupId, requesterId)

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  const now = new Date().toISOString()

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
           p.classified_points,
           m.status AS match_status,
           m.start_time AS match_start_time,
           m.home_score,
           m.away_score,
           m.penalty_winner,
           m.home_penalty_goals,
           m.away_penalty_goals,
           m.round,
           m.group_name,
           m.phase,
           m.leg,
           m.home_team_id,
           m.away_team_id,
           c.penalty_phases,
           ht.name AS home_team_name,
           ht.short_name AS home_team_short_name,
           ht.logo_url AS home_team_logo,
           at.name AS away_team_name,
           at.short_name AS away_team_short_name,
           at.logo_url AS away_team_logo
         FROM matches m
         JOIN groups g ON g.competition_id = m.competition_id AND g.id = ?
         JOIN competitions c ON c.id = m.competition_id
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
  const predictions = batchResults[0].results as Array<Record<string, unknown>>
  const leg1Map = await fetchSingleUserLeg1Map(db, groupId, targetUserId, predictions)
  const queryMs = Date.now() - queryStartedAt

  const activeRound = (batchResults[1].results as { round?: string }[])[0]?.round
  const lastRound = (batchResults[2].results as { round?: string }[])[0]?.round
  const defaultRound: string | null = activeRound ?? lastRound ?? null

  const enriched = attachPredictedClassifiedToRows(predictions, (r) =>
    r.phase && r.home_team_id && r.away_team_id
      ? (leg1Map.get(`${r.phase}:${r.away_team_id}:${r.home_team_id}`) ?? null)
      : null,
  )

  type RawPrediction = Record<string, unknown> & { round: string }
  const predictionsWithLabel = (enriched as RawPrediction[]).map((p) => ({
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
 */
router.get('/group', requireAuth, async (c) => {
  const startedAt = Date.now()
  const userId = c.get('userId')
  const groupId = c.req.query('group_id')

  if (!groupId) {
    return c.json({ error: 'group_id é obrigatório' }, 400)
  }

  const db = c.env.DB

  if (await isPilotGroupBlocked(c, db, groupId)) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  const { membership, membershipMs } = await getGroupMembershipTimed(db, groupId, userId)

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  const groupConfig = await db
    .prepare(`SELECT predictions_visibility FROM groups WHERE id = ? AND deleted_at IS NULL`)
    .bind(groupId)
    .first<{ predictions_visibility: string }>()

  if (!groupConfig) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  const isPublic = groupConfig.predictions_visibility === 'public'
  const now = new Date().toISOString()

  const membersStartedAt = Date.now()
  const membersResult = await db
    .prepare(
      `SELECT u.id AS user_id, COALESCE(p.nickname, u.user_name, CASE WHEN INSTR(u.email, '@') > 0 THEN SUBSTR(u.email, 1, 2) || '***@' || SUBSTR(u.email, INSTR(u.email, '@') + 1) ELSE 'Palpiteiro' END) AS display
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE gm.group_id = ?
       ORDER BY display ASC`,
    )
    .bind(groupId)
    .all<{ user_id: string; display: string }>()
  const membersMs = Date.now() - membersStartedAt

  const predictionsStartedAt = Date.now()
  const predictionsResult = isPublic
    ? await db
        .prepare(
          `SELECT
             pr.match_id,
             pr.user_id,
             COALESCE(p.nickname, u.user_name, CASE WHEN INSTR(u.email, '@') > 0 THEN SUBSTR(u.email, 1, 2) || '***@' || SUBSTR(u.email, INSTR(u.email, '@') + 1) ELSE 'Palpiteiro' END) AS user_display,
             pr.predicted_home_score,
             pr.predicted_away_score,
             pr.predicted_penalty_winner,
             pr.points_awarded,
             pr.penalty_points,
             pr.classified_points,
             m.phase,
             m.leg,
             m.home_team_id,
             m.away_team_id,
             c.penalty_phases,
             CASE WHEN ${lockedSql()} THEN 1 ELSE 0 END AS locked
           FROM predictions pr
           JOIN group_members gm ON gm.group_id = pr.group_id AND gm.user_id = pr.user_id
           JOIN users u ON u.id = pr.user_id
           LEFT JOIN profiles p ON p.user_id = pr.user_id
           JOIN matches m ON m.id = pr.match_id
           JOIN competitions c ON c.id = m.competition_id
           WHERE pr.group_id = ?
           ORDER BY m.start_time ASC, user_display ASC`,
        )
        .bind(now, groupId)
        .all<Record<string, unknown>>()
    : await db
        .prepare(
          `SELECT
             pr.match_id,
             pr.user_id,
             COALESCE(p.nickname, u.user_name, CASE WHEN INSTR(u.email, '@') > 0 THEN SUBSTR(u.email, 1, 2) || '***@' || SUBSTR(u.email, INSTR(u.email, '@') + 1) ELSE 'Palpiteiro' END) AS user_display,
             pr.predicted_home_score,
             pr.predicted_away_score,
             pr.predicted_penalty_winner,
             pr.points_awarded,
             pr.penalty_points,
             pr.classified_points,
             m.phase,
             m.leg,
             m.home_team_id,
             m.away_team_id,
             c.penalty_phases,
             CASE WHEN ${lockedSql()} THEN 1 ELSE 0 END AS locked
           FROM predictions pr
           JOIN group_members gm ON gm.group_id = pr.group_id AND gm.user_id = pr.user_id
           JOIN users u ON u.id = pr.user_id
           LEFT JOIN profiles p ON p.user_id = pr.user_id
           JOIN matches m ON m.id = pr.match_id
           JOIN competitions c ON c.id = m.competition_id
           WHERE pr.group_id = ?
             AND (
               ${lockedSql()}
               OR pr.user_id = ?
             )
           ORDER BY m.start_time ASC, user_display ASC`,
        )
        .bind(now, groupId, now, userId)
        .all<Record<string, unknown>>()
  const predictionsMs = Date.now() - predictionsStartedAt

  const leg1GroupMap = new Map<string, Leg1ScorePair>()
  for (const r of predictionsResult.results) {
    if (
      r.leg === 1 &&
      r.phase &&
      r.home_team_id &&
      r.away_team_id &&
      typeof r.predicted_home_score === 'number' &&
      typeof r.predicted_away_score === 'number'
    ) {
      leg1GroupMap.set(`${r.user_id}:${r.phase}:${r.home_team_id}:${r.away_team_id}`, {
        homeScore: r.predicted_home_score,
        awayScore: r.predicted_away_score,
      })
    }
  }

  const predictionsOut = attachPredictedClassifiedToRows(predictionsResult.results, (r) =>
    r.user_id && r.phase && r.home_team_id && r.away_team_id
      ? (leg1GroupMap.get(`${r.user_id}:${r.phase}:${r.away_team_id}:${r.home_team_id}`) ?? null)
      : null,
  )

  logRequestPerf(c.env.AE, 'GET /predictions/group', {
    status: 200,
    totalMs: Date.now() - startedAt,
    dbMs: membershipMs + membersMs + predictionsMs,
    rows: predictionsOut.length,
    extra: {
      group_id: groupId,
      members: membersResult.results.length,
      visibility: groupConfig.predictions_visibility,
    },
  })

  return c.json({
    self_user_id: userId,
    members: membersResult.results,
    predictions: predictionsOut,
  })
})

function resolveValidatedPenaltyWinner(
  eligible: boolean,
  homeScore: number,
  awayScore: number,
  rawPenaltyWinner: unknown,
  leg: 1 | 2 | null | undefined,
  leg1Score: Leg1ScorePair | null,
): { ok: true; value: 'home' | 'away' | null } | { ok: false } {
  if (
    rawPenaltyWinner !== undefined &&
    rawPenaltyWinner !== null &&
    rawPenaltyWinner !== 'home' &&
    rawPenaltyWinner !== 'away'
  ) {
    return { ok: false }
  }

  if (!eligible) {
    return { ok: true, value: null }
  }

  const validPick: 'home' | 'away' | null =
    rawPenaltyWinner === 'home' || rawPenaltyWinner === 'away' ? rawPenaltyWinner : null

  if (leg === 2 && leg1Score) {
    const isAggregateTie = homeScore + leg1Score.awayScore === awayScore + leg1Score.homeScore
    if (isAggregateTie && !validPick) return { ok: false }
    return { ok: true, value: validPick }
  }

  const isDraw = homeScore === awayScore
  if (isDraw && !validPick) return { ok: false }
  if (leg === 2 && validPick) return { ok: true, value: validPick }
  return { ok: true, value: isDraw ? validPick : null }
}

async function fetchLeg1PredictionForMatch(
  db: D1Database,
  groupId: string,
  userId: string,
  match: {
    competition_id?: string
    phase: string | null
    leg?: 1 | 2 | null
    home_team_id?: string
    away_team_id?: string
  },
): Promise<Leg1ScorePair | null> {
  if (
    match.leg !== 2 ||
    !match.competition_id ||
    !match.phase ||
    !match.home_team_id ||
    !match.away_team_id
  ) {
    return null
  }
  const row = await db
    .prepare(
      `SELECT p.predicted_home_score, p.predicted_away_score
       FROM matches m1
       JOIN predictions p ON p.match_id = m1.id
       WHERE m1.competition_id = ?
         AND m1.phase = ?
         AND m1.leg = 1
         AND m1.home_team_id = ?
         AND m1.away_team_id = ?
         AND p.group_id = ?
         AND p.user_id = ?`,
    )
    .bind(
      match.competition_id,
      match.phase,
      match.away_team_id,
      match.home_team_id,
      groupId,
      userId,
    )
    .first<{ predicted_home_score: number; predicted_away_score: number }>()

  if (!row) return null
  return { homeScore: row.predicted_home_score, awayScore: row.predicted_away_score }
}

/**
 * PUT /predictions
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

  if (!isValidScore(predicted_home_score) || !isValidScore(predicted_away_score)) {
    return c.json({ error: `Placar deve ser um inteiro entre 0 e ${MAX_SCORE}` }, 400)
  }

  const db = c.env.DB

  if (await isPilotGroupBlocked(c, db, group_id)) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  const { membership } = await getGroupMembershipTimed(db, group_id, userId)

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  const match = await db
    .prepare(
      `SELECT m.id, m.competition_id, m.home_team_id, m.away_team_id, m.start_time, m.status,
              m.postponed, m.locked_at, m.round, m.phase, m.leg, c.penalty_phases
       FROM matches m
       JOIN groups g ON g.competition_id = m.competition_id
       JOIN competitions c ON c.id = m.competition_id
       WHERE m.id = ? AND g.id = ?`,
    )
    .bind(match_id, group_id)
    .first<{
      id: string
      competition_id?: string
      home_team_id?: string
      away_team_id?: string
      start_time: string
      status: string
      postponed: number
      locked_at: string | null
      round: string
      phase: string | null
      leg?: 1 | 2 | null
      penalty_phases: string
    }>()

  if (!match) {
    return c.json({ error: 'Jogo não encontrado nesta competição' }, 404)
  }

  const now = new Date().toISOString()
  if (isMatchLocked(match, now)) {
    return c.json({ error: 'Palpite bloqueado — o jogo já começou' }, 422)
  }

  const eligible = matchGoesToPenalties(parsePenaltyPhases(match.penalty_phases), match.phase)
  const leg1Score = eligible
    ? await fetchLeg1PredictionForMatch(db, group_id, userId, match)
    : null

  const validated = resolveValidatedPenaltyWinner(
    eligible,
    predicted_home_score,
    predicted_away_score,
    predicted_penalty_winner,
    match.leg,
    leg1Score,
  )
  if (!validated.ok) {
    return c.json(
      {
        error:
          'predicted_penalty_winner é obrigatório (home ou away) num palpite de empate decidido nos pênaltis',
      },
      400,
    )
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
      validated.value,
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

/** Teto do placar de um palpite. Evita números absurdos no feed e no card de compartilhar. */
export const MAX_SCORE = 99

function isValidScore(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_SCORE
}

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
  if (body.predictions.length > 100) {
    return 'Máximo de 100 palpites por requisição'
  }

  for (const p of body.predictions) {
    if (
      !p ||
      typeof p.match_id !== 'string' ||
      !isValidScore(p.predicted_home_score) ||
      !isValidScore(p.predicted_away_score)
    ) {
      return `Cada palpite precisa de match_id e placares inteiros entre 0 e ${MAX_SCORE}`
    }
  }

  return null
}

type BulkMatchInfo = {
  id: string
  competition_id?: string
  home_team_id?: string
  away_team_id?: string
  start_time: string
  status?: string
  postponed: number
  locked_at?: string | null
  phase: string | null
  leg?: 1 | 2 | null
  penalty_phases: string
}

async function fetchBulkLeg1Map(
  db: D1Database,
  groupId: string,
  userId: string,
  byMatch: Map<string, { home: number; away: number; penaltyWinner?: unknown }>,
  matchInfo: Map<string, BulkMatchInfo>,
): Promise<Map<string, Leg1ScorePair>> {
  const leg1ScoreByPair = new Map<string, Leg1ScorePair>()
  const leg2Phases = new Set<string>()
  let compId: string | undefined

  for (const m of matchInfo.values()) {
    if (m.leg === 2 && m.phase && m.competition_id) {
      leg2Phases.add(m.phase)
      compId = m.competition_id
    }
  }

  for (const [mId, data] of byMatch.entries()) {
    const info = matchInfo.get(mId)
    if (info?.leg === 1 && info.phase && info.home_team_id && info.away_team_id) {
      leg1ScoreByPair.set(`${info.phase}:${info.home_team_id}:${info.away_team_id}`, {
        homeScore: data.home,
        awayScore: data.away,
      })
    }
  }

  if (leg2Phases.size === 0 || !compId) return leg1ScoreByPair

  const phases = Array.from(leg2Phases)
  const placeholders = phases.map(() => '?').join(', ')
  const rows = await db
    .prepare(
      `SELECT m1.id, m1.phase, m1.home_team_id, m1.away_team_id,
              p.predicted_home_score, p.predicted_away_score
       FROM matches m1
       LEFT JOIN predictions p ON p.match_id = m1.id AND p.group_id = ? AND p.user_id = ?
       WHERE m1.competition_id = ? AND m1.leg = 1 AND m1.phase IN (${placeholders})`,
    )
    .bind(groupId, userId, compId, ...phases)
    .all<{
      id: string
      phase: string | null
      home_team_id: string
      away_team_id: string
      predicted_home_score: number | null
      predicted_away_score: number | null
    }>()

  for (const r of rows.results) {
    if (!r.phase) continue
    const key = `${r.phase}:${r.home_team_id}:${r.away_team_id}`
    if (leg1ScoreByPair.has(key)) continue
    const inPayload = byMatch.get(r.id)
    if (inPayload) {
      leg1ScoreByPair.set(key, { homeScore: inPayload.home, awayScore: inPayload.away })
    } else if (r.predicted_home_score !== null && r.predicted_away_score !== null) {
      leg1ScoreByPair.set(key, {
        homeScore: r.predicted_home_score,
        awayScore: r.predicted_away_score,
      })
    }
  }

  return leg1ScoreByPair
}

function buildBulkPutStatements(
  db: D1Database,
  userId: string,
  groupId: string,
  byMatch: Map<string, { home: number; away: number; penaltyWinner?: unknown }>,
  matchInfo: Map<string, BulkMatchInfo>,
  leg1ScoreByPair: Map<string, Leg1ScorePair>,
  now: string,
) {
  const saved: string[] = []
  const locked: string[] = []
  const notFound: string[] = []
  const invalidPenalty: string[] = []
  const statements: D1PreparedStatement[] = []

  const penaltyPhasesCache = new Map<string, string[]>()

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

    if (isMatchLocked(info, now)) {
      locked.push(matchId)
      continue
    }

    const { home, away, penaltyWinner: rawPenaltyWinner } = matchData

    let parsedPhases = penaltyPhasesCache.get(info.penalty_phases)
    if (!parsedPhases) {
      parsedPhases = parsePenaltyPhases(info.penalty_phases)
      penaltyPhasesCache.set(info.penalty_phases, parsedPhases)
    }
    const eligible = matchGoesToPenalties(parsedPhases, info.phase)
    const leg1Score =
      info.leg === 2 && info.phase && info.home_team_id && info.away_team_id
        ? (leg1ScoreByPair.get(`${info.phase}:${info.away_team_id}:${info.home_team_id}`) ?? null)
        : null

    const validated = resolveValidatedPenaltyWinner(
      eligible,
      home,
      away,
      rawPenaltyWinner,
      info.leg,
      leg1Score,
    )
    if (!validated.ok) {
      invalidPenalty.push(matchId)
      continue
    }

    statements.push(
      insertStmt.bind(
        crypto.randomUUID(),
        userId,
        groupId,
        matchId,
        home,
        away,
        validated.value,
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

  if (await isPilotGroupBlocked(c, db, group_id as string)) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  const { membership } = await getGroupMembershipTimed(db, group_id as string, userId)

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  const byMatch = new Map<string, { home: number; away: number; penaltyWinner?: unknown }>()
  for (const p of predictions!) {
    byMatch.set(p.match_id as string, {
      home: p.predicted_home_score as number,
      away: p.predicted_away_score as number,
      penaltyWinner: p.predicted_penalty_winner,
    })
  }
  const matchIds = Array.from(byMatch.keys())

  const placeholders = matchIds.map(() => '?').join(', ')
  const matchRows = await db
    .prepare(
      `SELECT m.id, m.competition_id, m.home_team_id, m.away_team_id, m.start_time, m.status,
              m.postponed, m.locked_at, m.phase, m.leg, c.penalty_phases
       FROM matches m
       JOIN groups g ON g.competition_id = m.competition_id
       JOIN competitions c ON c.id = m.competition_id
       WHERE g.id = ? AND m.id IN (${placeholders})`,
    )
    .bind(group_id, ...matchIds)
    .all<BulkMatchInfo>()

  const matchInfo = new Map(matchRows.results.map((m) => [m.id, m]))
  const leg1ScoreByPair = await fetchBulkLeg1Map(
    db,
    group_id as string,
    userId,
    byMatch,
    matchInfo,
  )
  const now = new Date().toISOString()

  const { saved, locked, notFound, invalidPenalty, statements } = buildBulkPutStatements(
    db,
    userId,
    group_id as string,
    byMatch,
    matchInfo,
    leg1ScoreByPair,
    now,
  )

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
    const batches = []
    for (let i = 0; i < statements.length; i += 100) {
      batches.push(db.batch(statements.slice(i, i + 100)))
    }
    await Promise.all(batches)
    logEvent(c.env.AE, 'prediction_saved', {
      blobs: [group_id!, '', await hashUserId(userId), 'bulk'],
      doubles: [saved.length],
    })
  }

  return c.json({ ok: true, saved, locked, not_found: notFound })
}

router.put('/bulk', requireAuth, handleBulkPut)

async function verifyGroupsForImport(
  db: D1Database,
  userId: string,
  sourceGroupId: string,
  targetGroupId: string,
): Promise<{ error: string; status: ContentfulStatusCode } | null> {
  const [sourceMembership, targetMembership] = await Promise.all([
    getGroupMembership(db, sourceGroupId, userId),
    getGroupMembership(db, targetGroupId, userId),
  ])

  if (!sourceMembership) {
    return { error: 'Acesso negado ao grupo de origem', status: 403 }
  }

  if (!targetMembership) {
    return { error: 'Acesso negado ao grupo de destino', status: 403 }
  }

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

  if (
    (await isPilotGroupBlocked(c, db, source_group_id)) ||
    (await isPilotGroupBlocked(c, db, target_group_id))
  ) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  const validationError = await verifyGroupsForImport(db, userId, source_group_id, target_group_id)
  if (validationError) {
    return c.json({ error: validationError.error }, validationError.status)
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

  const batches = []
  for (let i = 0; i < importStatements.length; i += 100) {
    batches.push(db.batch(importStatements.slice(i, i + 100)))
  }
  await Promise.all(batches)

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
