import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import type { AppContext } from '../types'

const router = new Hono<AppContext>()

const KNOCKOUT_PHASES = [
  'LAST_32',
  'LAST_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
  'FINAL',
  'THIRD_PLACE',
] as const

type KnockoutPhase = (typeof KNOCKOUT_PHASES)[number]

const ROUND_POINTS: Record<KnockoutPhase, number> = {
  LAST_32: 1,
  LAST_16: 2,
  QUARTER_FINALS: 4,
  SEMI_FINALS: 8,
  FINAL: 16,
  THIRD_PLACE: 4,
}

/**
 * GET /bracket?competition_id=xxx&group_id=xxx
 *
 * Returns the knockout bracket data:
 * - teams: all teams that participated in the competition (for TBD picks)
 * - rounds: knockout matches grouped by phase, each with user's pick and all members' picks
 *
 * Positions within each round are derived from match schedule order (start_time, external_id).
 * A slot is "locked" when the corresponding match has already started.
 * Slots without a corresponding match (TBD) are never locked.
 *
 * Response:
 * {
 *   teams: [{ id, name, short_name, logo_url }],
 *   rounds: {
 *     LAST_32: [{ position, match?, locked, my_pick?, members_picks[] }],
 *     ...
 *   }
 * }
 */
router.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const competitionId = c.req.query('competition_id')
  const groupId = c.req.query('group_id')

  if (!competitionId || !groupId) {
    return c.json({ error: 'competition_id e group_id são obrigatórios' }, 400)
  }

  const db = c.env.DB

  const membership = await db
    .prepare(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`)
    .bind(groupId, userId)
    .first()

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  // Team → group letter mapping (from group stage matches)
  const teamGroupsResult = await db
    .prepare(
      `SELECT DISTINCT t.id AS team_id, m.group_name
       FROM teams t
       JOIN matches m ON (m.home_team_id = t.id OR m.away_team_id = t.id)
       WHERE m.competition_id = ? AND m.group_name IS NOT NULL
       ORDER BY m.group_name, t.id`,
    )
    .bind(competitionId)
    .all<{ team_id: string; group_name: string }>()

  const teamGroups: Record<string, string> = {}
  for (const row of teamGroupsResult.results) {
    if (!teamGroups[row.team_id]) teamGroups[row.team_id] = row.group_name
  }

  // All teams that appear in any match for this competition
  const teamsResult = await db
    .prepare(
      `
      SELECT DISTINCT t.id, t.name, t.short_name, t.logo_url
      FROM teams t
      JOIN matches m ON m.home_team_id = t.id OR m.away_team_id = t.id
      WHERE m.competition_id = ?
      ORDER BY t.name
      `,
    )
    .bind(competitionId)
    .all<{ id: string; name: string; short_name: string; logo_url: string | null }>()

  // Knockout matches with bracket positions (row_number per phase, ordered by start_time)
  const matchesResult = await db
    .prepare(
      `
      SELECT
        m.id,
        m.phase,
        m.start_time,
        m.status,
        m.home_score,
        m.away_score,
        m.home_team_id,
        ht.name   AS home_team_name,
        ht.short_name AS home_team_short,
        ht.logo_url   AS home_team_logo,
        m.away_team_id,
        at.name   AS away_team_name,
        at.short_name AS away_team_short,
        at.logo_url   AS away_team_logo,
        ROW_NUMBER() OVER (PARTITION BY m.phase ORDER BY m.start_time, m.external_id) AS position
      FROM matches m
      LEFT JOIN teams ht ON m.home_team_id = ht.id
      LEFT JOIN teams at ON m.away_team_id = at.id
      WHERE m.competition_id = ?
        AND m.phase IN (${KNOCKOUT_PHASES.map(() => '?').join(',')})
      ORDER BY m.phase, m.start_time, m.external_id
      `,
    )
    .bind(competitionId, ...KNOCKOUT_PHASES)
    .all<Record<string, unknown>>()

  // Current user's picks for this group + competition
  const myPicksResult = await db
    .prepare(
      `
      SELECT bp.round, bp.position, bp.team_id,
             t.name AS team_name, t.short_name AS team_short, t.logo_url AS team_logo
      FROM bracket_picks bp
      JOIN teams t ON bp.team_id = t.id
      WHERE bp.group_id = ? AND bp.user_id = ? AND bp.competition_id = ?
      `,
    )
    .bind(groupId, userId, competitionId)
    .all<{ round: string; position: number; team_id: string; team_name: string; team_short: string; team_logo: string | null }>()

  // All members' picks for visibility
  const allPicksResult = await db
    .prepare(
      `
      SELECT bp.round, bp.position, bp.user_id, bp.team_id,
             t.name AS team_name, t.short_name AS team_short, t.logo_url AS team_logo,
             COALESCE(p.nickname, u.email) AS user_display
      FROM bracket_picks bp
      JOIN teams t ON bp.team_id = t.id
      JOIN users u ON bp.user_id = u.id
      LEFT JOIN profiles p ON bp.user_id = p.user_id
      WHERE bp.group_id = ? AND bp.competition_id = ?
      `,
    )
    .bind(groupId, competitionId)
    .all<{ round: string; position: number; user_id: string; team_id: string; team_name: string; team_short: string; team_logo: string | null; user_display: string }>()

  const now = new Date().toISOString()

  // Build slots keyed by phase → position. A slot may originate from a real
  // match, from the user's pick, and/or from other members' picks — and in the
  // pre-tournament prediction phase there are NO knockout matches at all, so
  // picks must be able to stand on their own (otherwise they'd vanish on reload).
  type Slot = {
    position: number
    match: Record<string, unknown> | null
    locked: boolean
    my_pick: unknown
    members_picks: unknown[]
  }
  const roundMap = new Map<string, Map<number, Slot>>()

  function ensureSlot(phase: string, position: number): Slot {
    if (!roundMap.has(phase)) roundMap.set(phase, new Map())
    const byPos = roundMap.get(phase)!
    let slot = byPos.get(position)
    if (!slot) {
      slot = { position, match: null, locked: false, my_pick: null, members_picks: [] }
      byPos.set(position, slot)
    }
    return slot
  }

  // Slots backed by a real knockout match
  for (const m of matchesResult.results) {
    const slot = ensureSlot(m.phase as string, m.position as number)
    slot.match = {
      id: m.id,
      start_time: m.start_time,
      status: m.status,
      home_score: m.home_score,
      away_score: m.away_score,
      home_team_id: m.home_team_id,
      home_team_name: m.home_team_name,
      home_team_short: m.home_team_short,
      home_team_logo: m.home_team_logo,
      away_team_id: m.away_team_id,
      away_team_name: m.away_team_name,
      away_team_short: m.away_team_short,
      away_team_logo: m.away_team_logo,
    }
    slot.locked = (m.start_time as string) <= now
  }

  // Attach the current user's picks (creating TBD slots as needed)
  for (const p of myPicksResult.results) {
    ensureSlot(p.round, p.position).my_pick = p
  }

  // Attach all members' picks (creating TBD slots as needed)
  for (const p of allPicksResult.results) {
    ensureSlot(p.round, p.position).members_picks.push(p)
  }

  const rounds: Partial<Record<KnockoutPhase, unknown[]>> = {}
  for (const phase of KNOCKOUT_PHASES) {
    const byPos = roundMap.get(phase)
    if (byPos) rounds[phase] = [...byPos.values()].sort((a, b) => a.position - b.position)
  }

  return c.json({
    self_user_id: userId,
    teams: teamsResult.results,
    team_groups: teamGroups,
    rounds,
    round_points: ROUND_POINTS,
  })
})

/**
 * PUT /bracket
 *
 * Create or update a bracket pick (upsert by group_id + user_id + round + position).
 * Enforces lock: if a match for that slot has already started, returns 409.
 *
 * Body: { group_id, competition_id, round, position, team_id }
 */
router.put('/', requireAuth, async (c) => {
  const userId = c.get('userId')

  let body: {
    group_id?: string
    competition_id?: string
    round?: string
    position?: number
    team_id?: string
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'JSON inválido' }, 400)
  }

  const { group_id: groupId, competition_id: competitionId, round, position, team_id: teamId } = body

  if (!groupId || !competitionId || !round || position == null || !teamId) {
    return c.json(
      { error: 'Campos obrigatórios: group_id, competition_id, round, position, team_id' },
      400,
    )
  }

  if (!(KNOCKOUT_PHASES as readonly string[]).includes(round)) {
    return c.json({ error: `Fase inválida. Use: ${KNOCKOUT_PHASES.join(', ')}` }, 400)
  }

  if (!Number.isInteger(position) || position < 1) {
    return c.json({ error: 'position deve ser um inteiro positivo' }, 400)
  }

  const db = c.env.DB

  const membership = await db
    .prepare(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`)
    .bind(groupId, userId)
    .first()

  if (!membership) {
    return c.json({ error: 'Acesso negado' }, 403)
  }

  const competition = await db
    .prepare(`SELECT id FROM competitions WHERE id = ?`)
    .bind(competitionId)
    .first()

  if (!competition) {
    return c.json({ error: 'Competição não encontrada' }, 404)
  }

  const team = await db
    .prepare(`SELECT id FROM teams WHERE id = ?`)
    .bind(teamId)
    .first()

  if (!team) {
    return c.json({ error: 'Time não encontrado' }, 404)
  }

  // Lock check: find the Nth match (by position) in this round
  // OFFSET = position - 1 (positions are 1-based)
  const now = new Date().toISOString()
  const matchForSlot = await db
    .prepare(
      `
      SELECT start_time FROM matches
      WHERE competition_id = ? AND phase = ?
      ORDER BY start_time, external_id
      LIMIT 1 OFFSET ?
      `,
    )
    .bind(competitionId, round, position - 1)
    .first<{ start_time: string }>()

  if (matchForSlot && matchForSlot.start_time <= now) {
    return c.json({ error: 'Palpite bloqueado — jogo já começou' }, 409)
  }

  const ts = new Date().toISOString()
  await db
    .prepare(
      `
      INSERT INTO bracket_picks (id, group_id, user_id, competition_id, round, position, team_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (group_id, user_id, round, position) DO UPDATE SET
        team_id    = excluded.team_id,
        updated_at = excluded.updated_at
      `,
    )
    .bind(crypto.randomUUID(), groupId, userId, competitionId, round, position, teamId, ts, ts)
    .run()

  const saved = await db
    .prepare(
      `
      SELECT bp.id, bp.round, bp.position, bp.team_id,
             t.name AS team_name, t.short_name AS team_short, t.logo_url AS team_logo
      FROM bracket_picks bp
      JOIN teams t ON bp.team_id = t.id
      WHERE bp.group_id = ? AND bp.user_id = ? AND bp.competition_id = ?
        AND bp.round = ? AND bp.position = ?
      `,
    )
    .bind(groupId, userId, competitionId, round, position)
    .first()

  return c.json({ pick: saved })
})

export { router as bracketRouter }
