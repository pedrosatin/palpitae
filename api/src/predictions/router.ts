import { type Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { requireAuth } from '../auth/middleware'
import { hasPilotAccess } from '../auth/permissions'
import { isMatchLocked, lockedSql } from '../matches/locking'
import { matchGoesToPenalties, parsePenaltyPhases } from '../matches/penalties'
import { isKnockoutPhase, roundLabel } from '../matches/rounds'
import { resolveSingleMatchClassified, resolveTwoLegClassified } from '../matches/scoring'
import {
  fetchTieMatches,
  indexTies,
  type TieInfo,
  type TieMatch,
  type TieRole,
} from '../matches/ties'
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

// ---------------------------------------------------------------------------
// Confronto de mata-mata: classificado previsto e palpite da ida
// ---------------------------------------------------------------------------

type Leg1ScorePair = {
  homeScore: number
  awayScore: number
}

/**
 * Colunas do jogo que as listagens selecionam só para montar o confronto. Saem
 * da resposta em `attachPredictedClassifiedToRows`.
 */
const TIE_ROW_COLUMNS = `m.competition_id AS tie_competition_id,
      m.start_time AS tie_start_time,
      m.phase AS tie_phase,
      m.leg AS tie_leg,
      m.home_team_id AS tie_home_team_id,
      m.away_team_id AS tie_away_team_id`

type PredictionRow = Record<string, unknown>

function hasPrediction(row: PredictionRow): boolean {
  return (
    typeof row.predicted_home_score === 'number' && typeof row.predicted_away_score === 'number'
  )
}

/** Confrontos dos jogos de mata-mata com palpite nas linhas, indexados pelo id do jogo. */
async function fetchRowTies(
  db: D1Database,
  rows: PredictionRow[],
): Promise<Map<string, TieInfo<TieMatch>>> {
  const phasesByCompetition = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!hasPrediction(r) || !isKnockoutPhase(r.tie_phase as string | null)) continue
    const competitionId = r.tie_competition_id as string
    const phases = phasesByCompetition.get(competitionId) ?? new Set<string>()
    phases.add(r.tie_phase as string)
    phasesByCompetition.set(competitionId, phases)
  }

  const ties = new Map<string, TieInfo<TieMatch>>()
  for (const [competitionId, phases] of phasesByCompetition) {
    const tieMatches = await fetchTieMatches(db, competitionId, phases)
    for (const [matchId, tie] of indexTies(tieMatches)) ties.set(matchId, tie)
  }
  return ties
}

/**
 * Palpites de ida de um usuário, indexados pelo id do jogo. Com `lockedNow`, só
 * devolve palpites de jogos travados (anti-cópia, ver locking.ts).
 */
async function fetchLeg1Predictions(
  db: D1Database,
  groupId: string,
  userId: string,
  leg1Ids: string[],
  lockedNow?: string,
): Promise<Map<string, Leg1ScorePair>> {
  const leg1Map = new Map<string, Leg1ScorePair>()
  if (leg1Ids.length === 0) return leg1Map

  const lockedFilter = lockedNow ? ` AND ${lockedSql()}` : ''
  const params: string[] = [groupId, userId, JSON.stringify(leg1Ids)]
  if (lockedNow) params.push(lockedNow)

  const { results } = await db
    .prepare(
      `SELECT p.match_id, p.predicted_home_score, p.predicted_away_score
       FROM predictions p
       JOIN matches m ON m.id = p.match_id
       WHERE p.group_id = ? AND p.user_id = ?
         AND p.match_id IN (SELECT value FROM json_each(?))${lockedFilter}`,
    )
    .bind(...params)
    .all<{ match_id: string; predicted_home_score: number; predicted_away_score: number }>()

  for (const r of results) {
    leg1Map.set(r.match_id, {
      homeScore: r.predicted_home_score,
      awayScore: r.predicted_away_score,
    })
  }
  return leg1Map
}

/**
 * Palpites de ida de um único usuário para as voltas com palpite nas linhas.
 * Aproveita a ida que já está nas linhas e só consulta o banco para as que
 * faltam. Quando quem pede não é o dono, `lockedNow` restringe a idas travadas.
 */
async function fetchSingleUserLeg1Map(
  db: D1Database,
  groupId: string,
  userId: string,
  rows: PredictionRow[],
  ties: Map<string, TieInfo<TieMatch>>,
  lockedNow?: string,
): Promise<Map<string, Leg1ScorePair>> {
  const leg1Ids = new Set<string>()
  for (const r of rows) {
    if (!hasPrediction(r)) continue
    const tie = ties.get(r.match_id as string)
    if (tie?.role === 'leg2' && tie.partner) leg1Ids.add(tie.partner.id)
  }

  const leg1Map = new Map<string, Leg1ScorePair>()
  if (leg1Ids.size === 0) return leg1Map

  const rowMatchIds = new Set<string>()
  for (const r of rows) {
    const matchId = r.match_id as string
    rowMatchIds.add(matchId)
    if (leg1Ids.has(matchId) && hasPrediction(r)) {
      leg1Map.set(matchId, {
        homeScore: r.predicted_home_score as number,
        awayScore: r.predicted_away_score as number,
      })
    }
  }

  const missing = Array.from(leg1Ids).filter((id) => !rowMatchIds.has(id))
  const fetched = await fetchLeg1Predictions(db, groupId, userId, missing, lockedNow)
  for (const [matchId, score] of fetched) leg1Map.set(matchId, score)
  return leg1Map
}

/**
 * Classificado previsto ('home' ou 'away' do jogo da linha). Só existe no jogo
 * decisivo de mata-mata: na volta, pela soma com o palpite da ida; no jogo único,
 * pelo próprio placar. Empate sem vencedor de pênaltis previsto devolve null.
 */
function computePredictedClassified(
  row: PredictionRow,
  tie: TieInfo<TieMatch> | undefined,
  leg1Score: Leg1ScorePair | null,
): 'home' | 'away' | null {
  if (!hasPrediction(row) || !isKnockoutPhase(row.tie_phase as string | null)) return null
  const home = row.predicted_home_score as number
  const away = row.predicted_away_score as number
  const penaltyWinner = (row.predicted_penalty_winner as 'home' | 'away' | null) ?? null
  const role: TieRole = tie?.role ?? 'single'

  if (role === 'leg1') return null
  if (role === 'leg2') {
    if (!leg1Score) return null
    return resolveTwoLegClassified(leg1Score, { homeScore: home, awayScore: away, penaltyWinner })
  }
  return resolveSingleMatchClassified(home, away, penaltyWinner)
}

/**
 * Acrescenta `classified_points` e `predicted_classified` a cada linha e tira as
 * colunas `tie_*`. `leg1Of` devolve o palpite da ida da linha, dado o id da ida.
 */
function attachPredictedClassifiedToRows(
  rows: PredictionRow[],
  ties: Map<string, TieInfo<TieMatch>>,
  leg1Of: (row: PredictionRow, leg1MatchId: string) => Leg1ScorePair | null,
): PredictionRow[] {
  return rows.map((row) => {
    const {
      tie_competition_id: _competitionId,
      tie_start_time: _startTime,
      tie_phase: _phase,
      tie_leg: _leg,
      tie_home_team_id: _homeTeamId,
      tie_away_team_id: _awayTeamId,
      ...rest
    } = row
    const tie = ties.get(row.match_id as string)
    const leg1Score = tie?.role === 'leg2' && tie.partner ? leg1Of(row, tie.partner.id) : null
    return {
      ...rest,
      // Sem palpite (LEFT JOIN do /user) o campo fica null, como points_awarded.
      classified_points: hasPrediction(row) ? (row.classified_points ?? 0) : null,
      predicted_classified: computePredictedClassified(row, tie, leg1Score),
    }
  })
}

/** Papel do jogo no confronto e palpite da ida do usuário quando o jogo é volta. */
async function resolveMatchTieForWrite(
  db: D1Database,
  groupId: string,
  userId: string,
  match: TieMatch,
): Promise<{ role: TieRole; leg1Score: Leg1ScorePair | null }> {
  if (!isKnockoutPhase(match.phase)) return { role: 'single', leg1Score: null }
  const tieMatches = await fetchTieMatches(db, match.competition_id, [match.phase])
  const tie = indexTies(tieMatches).get(match.id)
  const role: TieRole = tie?.role ?? 'single'
  if (role !== 'leg2' || !tie?.partner) return { role, leg1Score: null }
  const leg1Map = await fetchLeg1Predictions(db, groupId, userId, [tie.partner.id])
  return { role, leg1Score: leg1Map.get(tie.partner.id) ?? null }
}

/**
 * Vencedor dos pênaltis a gravar no palpite. Regras:
 *   - obrigatório só no empate do próprio jogo numa fase decidida nos pênaltis
 *     (penalty_phases), exceto na ida, que nunca vai a pênaltis;
 *   - na volta, se a soma com o palpite da ida empata o agregado, grava o pick
 *     quando vier válido. Sem pick o palpite é aceito e só não pontua o classificado;
 *   - nos outros casos grava null, e um valor inválido é descartado em silêncio.
 */
function resolvePenaltyPick(input: {
  eligible: boolean
  role: TieRole
  home: number
  away: number
  rawPenaltyWinner: unknown
  leg1Score: Leg1ScorePair | null
}): { ok: true; value: 'home' | 'away' | null } | { ok: false } {
  const { eligible, role, home, away, rawPenaltyWinner, leg1Score } = input
  const validPick: 'home' | 'away' | null =
    rawPenaltyWinner === 'home' || rawPenaltyWinner === 'away' ? rawPenaltyWinner : null

  if (home === away && eligible && role !== 'leg1') {
    return validPick ? { ok: true, value: validPick } : { ok: false }
  }
  if (role === 'leg2' && leg1Score && home + leg1Score.awayScore === away + leg1Score.homeScore) {
    return { ok: true, value: validPick }
  }
  return { ok: true, value: null }
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
 * `predicted_classified` é o classificado ('home' ou 'away') que o palpite prevê
 * no jogo decisivo de um confronto de mata-mata (null nos demais jogos), e
 * `classified_points` os pontos de classificado já creditados.
 *
 * Response:
 * {
 *   predictions: [
 *     {
 *       id, match_id, predicted_home_score, predicted_away_score,
 *       points_awarded, classified_points, predicted_classified,
 *       locked, created_at, updated_at
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
      ${TIE_ROW_COLUMNS},
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
    .all<PredictionRow>()
  const ties = await fetchRowTies(db, result.results)
  const leg1Map = await fetchSingleUserLeg1Map(db, groupId, userId, result.results, ties)
  const queryMs = Date.now() - queryStartedAt

  const predictionsOut = attachPredictedClassifiedToRows(
    result.results,
    ties,
    (_row, leg1MatchId) => leg1Map.get(leg1MatchId) ?? null,
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
 *       points_awarded, classified_points, predicted_classified,
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

  if (await isPilotGroupBlocked(c, db, groupId)) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

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
           ht.name AS home_team_name,
           ht.short_name AS home_team_short_name,
           ht.logo_url AS home_team_logo,
           at.name AS away_team_name,
           at.short_name AS away_team_short_name,
           at.logo_url AS away_team_logo,
           ${TIE_ROW_COLUMNS}
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
  const predictions = batchResults[0].results as PredictionRow[]
  // O palpite da ida segue o mesmo filtro anti-cópia: para outro usuário, só idas travadas.
  const ties = await fetchRowTies(db, predictions)
  const leg1Map = await fetchSingleUserLeg1Map(
    db,
    groupId,
    targetUserId,
    predictions,
    ties,
    targetUserId === requesterId ? undefined : now,
  )
  const queryMs = Date.now() - queryStartedAt

  const activeRound = (batchResults[1].results as { round?: string }[])[0]?.round
  const lastRound = (batchResults[2].results as { round?: string }[])[0]?.round
  const defaultRound: string | null = activeRound ?? lastRound ?? null

  const enriched = attachPredictedClassifiedToRows(
    predictions,
    ties,
    (_row, leg1MatchId) => leg1Map.get(leg1MatchId) ?? null,
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
 *
 * Returns the predictions of ALL members of a group — for the social/tracking
 * view ("Palpites do grupo").
 *
 * Hidden groups reveal another member's prediction only once the match is locked.
 * The requester can always see and edit their own unlocked prediction.
 * Only current members' picks are listed: picks of someone who left or was removed
 * stay in the database but leave the feed, like the roster.
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
 *       predicted_home_score, predicted_away_score, points_awarded,
 *       classified_points, predicted_classified, locked
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

  if (await isPilotGroupBlocked(c, db, groupId)) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

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
    ? // Public group: every member's picks are visible in real time, no anti-copy filter.
      await db
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
             ${TIE_ROW_COLUMNS},
             CASE WHEN ${lockedSql()} THEN 1 ELSE 0 END AS locked
           FROM predictions pr
           JOIN group_members gm ON gm.group_id = pr.group_id AND gm.user_id = pr.user_id
           JOIN users u ON u.id = pr.user_id
           LEFT JOIN profiles p ON p.user_id = pr.user_id
           JOIN matches m ON m.id = pr.match_id
           WHERE pr.group_id = ?
           ORDER BY m.start_time ASC, user_display ASC`,
        )
        .bind(now, groupId)
        .all<PredictionRow>()
    : // Hidden group: only the requester or a locked match can reveal a pick.
      await db
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
             ${TIE_ROW_COLUMNS},
             CASE WHEN ${lockedSql()} THEN 1 ELSE 0 END AS locked
           FROM predictions pr
           JOIN group_members gm ON gm.group_id = pr.group_id AND gm.user_id = pr.user_id
           JOIN users u ON u.id = pr.user_id
           LEFT JOIN profiles p ON p.user_id = pr.user_id
           JOIN matches m ON m.id = pr.match_id
           WHERE pr.group_id = ?
             AND (
               ${lockedSql()}
               OR pr.user_id = ?
             )
           ORDER BY m.start_time ASC, user_display ASC`,
        )
        .bind(now, groupId, now, userId)
        .all<PredictionRow>()
  const ties = await fetchRowTies(db, predictionsResult.results)
  const predictionsMs = Date.now() - predictionsStartedAt

  // O palpite da ida vem das próprias linhas, que já passaram pelo filtro de
  // visibilidade acima: a volta não revela uma ida que o grupo ainda não pode ver.
  const leg1ByUserMatch = new Map<string, Leg1ScorePair>()
  for (const r of predictionsResult.results) {
    if (!hasPrediction(r)) continue
    leg1ByUserMatch.set(`${r.user_id}:${r.match_id}`, {
      homeScore: r.predicted_home_score as number,
      awayScore: r.predicted_away_score as number,
    })
  }
  const predictionsOut = attachPredictedClassifiedToRows(
    predictionsResult.results,
    ties,
    (row, leg1MatchId) => leg1ByUserMatch.get(`${row.user_id}:${leg1MatchId}`) ?? null,
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

/**
 * PUT /predictions
 *
 * Create or update a prediction (upsert by user_id + group_id + match_id).
 *
 * Prediction locking rules (ADR-004):
 *   - Predictions can be submitted or edited freely BEFORE match.start_time
 *   - Once match.start_time is reached, predictions are LOCKED — no edits allowed
 *   - If a match is rescheduled before it starts, the lock follows the new start_time
 *   - Jogo adiado (`postponed = 1`) que não começou NÃO trava, mesmo com start_time no passado
 *   - Jogo que o sync viu iniciado (`locked_at`) fica travado para sempre
 *
 * Body: { group_id, match_id, predicted_home_score, predicted_away_score, predicted_penalty_winner? }
 *
 * Vencedor dos pênaltis: ver `resolvePenaltyPick`. Na volta de um confronto, o
 * pick também é gravado quando o agregado previsto empata.
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

  if (!isValidScore(predicted_home_score) || !isValidScore(predicted_away_score)) {
    return c.json({ error: `Placar deve ser um inteiro entre 0 e ${MAX_SCORE}` }, 400)
  }

  const db = c.env.DB

  if (await isPilotGroupBlocked(c, db, group_id)) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  // Verify user is a member of the group
  const { membership } = await getGroupMembershipTimed(db, group_id, userId)

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  // Verify match belongs to the group's competition. Also pull the penalty gate
  // (phase + competition.penalty_phases) so we can validate the shootout pick, and
  // the tie fields (teams, leg) to find the other leg of a knockout tie.
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
      competition_id: string
      home_team_id: string
      away_team_id: string
      start_time: string
      status: string
      postponed: number
      locked_at: string | null
      round: string
      phase: string | null
      leg: 1 | 2 | null
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

  // Penalty pick: required only for a draw in an eligible (competition, phase),
  // except on a leg 1. On a leg 2 it is also kept when the predicted aggregate
  // ties. Otherwise it's nulled out, so we never persist a stale one.
  const eligible = matchGoesToPenalties(parsePenaltyPhases(match.penalty_phases), match.phase)
  const { role, leg1Score } = await resolveMatchTieForWrite(db, group_id, userId, match)
  const penalty = resolvePenaltyPick({
    eligible,
    role,
    home: predicted_home_score,
    away: predicted_away_score,
    rawPenaltyWinner: predicted_penalty_winner,
    leg1Score,
  })
  if (!penalty.ok) {
    return c.json(
      {
        error:
          'predicted_penalty_winner é obrigatório (home ou away) num palpite de empate decidido nos pênaltis',
      },
      400,
    )
  }
  const penaltyWinner = penalty.value

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
 *   - the penalty pick follows `resolvePenaltyPick`. On a leg 2, the leg 1 score
 *     comes from the payload when it is saved in the same request, or from the
 *     database otherwise (including when the payload's leg 1 is locked).
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
  competition_id: string
  home_team_id: string
  away_team_id: string
  start_time: string
  status?: string
  postponed: number
  locked_at?: string | null
  phase: string | null
  leg: 1 | 2 | null
  penalty_phases: string
}

type BulkPick = { home: number; away: number; penaltyWinner?: 'home' | 'away' | null }

type BulkTieContext = {
  roleByMatch: Map<string, TieRole>
  leg1ScoreByMatch: Map<string, Leg1ScorePair>
}

/**
 * Papel no confronto de cada jogo do payload e, para cada volta, o palpite da
 * ida. A ida do payload só vale se for gravada nesta requisição (não travada);
 * senão vale a ida gravada no banco.
 */
async function fetchBulkTieContext(
  db: D1Database,
  groupId: string,
  userId: string,
  byMatch: Map<string, BulkPick>,
  matchInfo: Map<string, BulkMatchInfo>,
  now: string,
): Promise<BulkTieContext> {
  const roleByMatch = new Map<string, TieRole>()
  const leg1ScoreByMatch = new Map<string, Leg1ScorePair>()

  const phasesByCompetition = new Map<string, Set<string>>()
  for (const info of matchInfo.values()) {
    if (!isKnockoutPhase(info.phase)) continue
    const phases = phasesByCompetition.get(info.competition_id) ?? new Set<string>()
    phases.add(info.phase as string)
    phasesByCompetition.set(info.competition_id, phases)
  }
  if (phasesByCompetition.size === 0) return { roleByMatch, leg1ScoreByMatch }

  const ties = new Map<string, TieInfo<TieMatch>>()
  for (const [competitionId, phases] of phasesByCompetition) {
    const tieMatches = await fetchTieMatches(db, competitionId, phases)
    for (const [matchId, tie] of indexTies(tieMatches)) ties.set(matchId, tie)
  }

  const leg1IdByLeg2 = new Map<string, string>()
  const leg1IdsFromDb = new Set<string>()
  for (const matchId of byMatch.keys()) {
    const tie = ties.get(matchId)
    if (!tie) continue
    roleByMatch.set(matchId, tie.role)
    if (tie.role !== 'leg2' || !tie.partner) continue

    const leg1Id = tie.partner.id
    leg1IdByLeg2.set(matchId, leg1Id)
    const leg1Info = matchInfo.get(leg1Id)
    const leg1Pick = byMatch.get(leg1Id)
    if (leg1Pick && leg1Info && !isMatchLocked(leg1Info, now)) {
      leg1ScoreByMatch.set(matchId, { homeScore: leg1Pick.home, awayScore: leg1Pick.away })
    } else {
      leg1IdsFromDb.add(leg1Id)
    }
  }

  const stored = await fetchLeg1Predictions(db, groupId, userId, Array.from(leg1IdsFromDb))
  for (const [leg2Id, leg1Id] of leg1IdByLeg2) {
    if (leg1ScoreByMatch.has(leg2Id)) continue
    const score = stored.get(leg1Id)
    if (score) leg1ScoreByMatch.set(leg2Id, score)
  }

  return { roleByMatch, leg1ScoreByMatch }
}

function buildBulkPutStatements(
  db: D1Database,
  userId: string,
  groupId: string,
  byMatch: Map<string, BulkPick>,
  matchInfo: Map<string, BulkMatchInfo>,
  tieContext: BulkTieContext,
  now: string,
) {
  const saved: string[] = []
  const locked: string[] = []
  const notFound: string[] = []
  const invalidPenalty: string[] = []
  const statements: D1PreparedStatement[] = []

  // Cache to avoid re-parsing the penalty_phases JSON string on every prediction loop iteration.
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

    // LOCK CHECK — derived at runtime from match.start_time (ADR-004)
    if (isMatchLocked(info, now)) {
      locked.push(matchId)
      continue
    }

    const { home, away, penaltyWinner: rawPenaltyWinner } = matchData

    // Same penalty validation as PUT /: required for a draw in an eligible phase
    // (except on a leg 1), kept on a leg 2 aggregate tie, nulled out otherwise.
    let parsedPhases = penaltyPhasesCache.get(info.penalty_phases)
    if (!parsedPhases) {
      parsedPhases = parsePenaltyPhases(info.penalty_phases)
      penaltyPhasesCache.set(info.penalty_phases, parsedPhases)
    }
    const eligible = matchGoesToPenalties(parsedPhases, info.phase)
    const penalty = resolvePenaltyPick({
      eligible,
      role: tieContext.roleByMatch.get(matchId) ?? 'single',
      home,
      away,
      rawPenaltyWinner,
      leg1Score: tieContext.leg1ScoreByMatch.get(matchId) ?? null,
    })
    if (!penalty.ok) {
      invalidPenalty.push(matchId)
      continue
    }
    const penaltyWinner = penalty.value

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

  if (await isPilotGroupBlocked(c, db, group_id as string)) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  // Verify user is a member of the group
  const { membership } = await getGroupMembershipTimed(db, group_id as string, userId)

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  // Dedupe by match_id (last value wins) so the IN-clause and batch stay 1:1
  const byMatch = new Map<string, BulkPick>()
  for (const p of predictions!) {
    byMatch.set(p.match_id as string, {
      home: p.predicted_home_score as number,
      away: p.predicted_away_score as number,
      penaltyWinner: p.predicted_penalty_winner ?? null,
    })
  }
  const matchIds = Array.from(byMatch.keys())

  // Fetch all referenced matches that actually belong to the group's competition.
  // phase + competition.penalty_phases drive the per-match penalty gate; teams and
  // leg locate the other leg of a knockout tie.
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
  const now = new Date().toISOString()
  const tieContext = await fetchBulkTieContext(
    db,
    group_id as string,
    userId,
    byMatch,
    matchInfo,
    now,
  )

  const { saved, locked, notFound, invalidPenalty, statements } = buildBulkPutStatements(
    db,
    userId,
    group_id as string,
    byMatch,
    matchInfo,
    tieContext,
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
    const batches = []
    for (let i = 0; i < statements.length; i += 100) {
      batches.push(db.batch(statements.slice(i, i + 100)))
    }
    await Promise.all(batches)
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
): Promise<{ error: string; status: ContentfulStatusCode } | null> {
  // Verify user is an active member of both groups (same rule as every group route)
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
