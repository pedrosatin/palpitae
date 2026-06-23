import type { D1Database } from '@cloudflare/workers-types'
import { logEvent } from '../observability'
import { isKnockoutPhase, KNOCKOUT_PHASES_SQL, penaltyPicksActive } from './phases'

// After this window a knockout draw scores as a plain draw so a missing penalties payload can't freeze points forever.
export const PENALTY_DEFER_GRACE_MS = 6 * 60 * 60 * 1000 // 6h, past the ~200min match window

export function calculatePoints(
  actualHome: number,
  actualAway: number,
  predictedHome: number,
  predictedAway: number,
  pointsExact = 3,
  pointsWinner = 1,
): number {
  // pointsExact === 0 is the "winner only" / 1X2 mode: there is no exact-score bonus,
  // so we never short-circuit here — otherwise a 1X2 pick stored as (1,0)/(0,0)/(0,1)
  // would accidentally score the exact value when the real score happens to match.
  if (pointsExact > 0 && predictedHome === actualHome && predictedAway === actualAway)
    return pointsExact
  const actualWinner = actualHome > actualAway ? 'home' : actualHome < actualAway ? 'away' : 'draw'
  const predictedWinner =
    predictedHome > predictedAway ? 'home' : predictedHome < predictedAway ? 'away' : 'draw'
  return actualWinner === predictedWinner ? pointsWinner : 0
}

// Caller gates this on isPenaltyShootout + penaltyPicksActive; this only compares the two team ids.
export function penaltyBonus(
  actualWinnerId: string | null,
  predictedWinnerId: string | null,
): 0 | 1 {
  if (!actualWinnerId || !predictedWinnerId) return 0
  return actualWinnerId === predictedWinnerId ? 1 : 0
}

async function recalculateLeaderboard(groupId: string, db: D1Database): Promise<void> {
  // exact_hits compares only points_awarded (not penalty_bonus) so an exact-score pick that also nailed the shootout still counts.
  const rows = await db
    .prepare(
      `SELECT p.user_id,
              SUM(p.points_awarded + p.penalty_bonus) AS total_points,
              SUM(
                CASE WHEN g.points_exact > g.points_winner
                       AND p.points_awarded = g.points_exact
                     THEN 1 ELSE 0 END
              ) AS exact_hits
       FROM predictions p
       JOIN groups g ON g.id = p.group_id
       WHERE p.group_id = ?
       GROUP BY p.user_id`,
    )
    .bind(groupId)
    .all<{ user_id: string; total_points: number; exact_hits: number }>()

  if (rows.results.length === 0) return

  const now = new Date().toISOString()
  const statements = rows.results.map((row) =>
    db
      .prepare(
        `INSERT INTO leaderboard (group_id, user_id, total_points, exact_hits, last_updated)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (group_id, user_id) DO UPDATE SET
           total_points = excluded.total_points,
           exact_hits   = excluded.exact_hits,
           last_updated = excluded.last_updated`,
      )
      .bind(groupId, row.user_id, row.total_points, row.exact_hits, now),
  )

  await db.batch(statements)
}

async function scoreMatch(
  matchId: string,
  homeScore: number,
  awayScore: number,
  phase: string | null,
  penaltyWinnerTeamId: string | null,
  db: D1Database,
  ae?: AnalyticsEngineDataset,
): Promise<void> {
  // A penalty shootout: knockout match drawn at fullTime with a recorded winner.
  // Only then can a penalty pick earn its bonus.
  const isPenaltyShootout =
    isKnockoutPhase(phase) && homeScore === awayScore && penaltyWinnerTeamId !== null

  const predictions = await db
    .prepare(
      `SELECT p.id, p.group_id, p.user_id,
              p.predicted_home_score, p.predicted_away_score,
              p.predicted_penalty_winner_team_id,
              g.points_exact, g.points_winner, g.penalty_picks_enabled
       FROM predictions p
       JOIN groups g ON g.id = p.group_id
       WHERE p.match_id = ?`,
    )
    .bind(matchId)
    .all<{
      id: string
      group_id: string
      user_id: string
      predicted_home_score: number
      predicted_away_score: number
      predicted_penalty_winner_team_id: string | null
      points_exact: number
      points_winner: number
      penalty_picks_enabled: number
    }>()

  const now = new Date().toISOString()
  const statements: ReturnType<D1Database['prepare']>[] = []

  const affectedGroups = new Set<string>()
  // Per-group shootout tallies for the penalty_bonus_awarded event.
  const groupBonus = new Map<string, { awarded: number; total: number }>()

  for (const p of predictions.results) {
    const points = calculatePoints(
      homeScore,
      awayScore,
      p.predicted_home_score,
      p.predicted_away_score,
      p.points_exact,
      p.points_winner,
    )

    // Penalty bonus is gated on: the match being a shootout, the group having
    // penalty picks enabled, AND the group scoring exact scores (points_exact > 0).
    // 1X2 ("só vencedor") groups never award the bonus.
    let bonus: 0 | 1 = 0
    if (isPenaltyShootout && penaltyPicksActive(p.penalty_picks_enabled, p.points_exact)) {
      bonus = penaltyBonus(penaltyWinnerTeamId, p.predicted_penalty_winner_team_id)
      const tally = groupBonus.get(p.group_id) ?? { awarded: 0, total: 0 }
      tally.total += 1
      tally.awarded += bonus
      groupBonus.set(p.group_id, tally)
    }

    statements.push(
      db
        .prepare(`UPDATE predictions SET points_awarded = ?, penalty_bonus = ? WHERE id = ?`)
        .bind(points, bonus, p.id),
    )
    affectedGroups.add(p.group_id)
  }

  await db.batch(statements)

  // Recalculate leaderboards before marking scored_at. Errors are logged but
  // scored_at is always stamped — preventing the stamp would cause the poller to
  // re-award points on every run, which is worse than a temporary leaderboard drift.
  await Promise.allSettled(
    [...affectedGroups].map((groupId) => recalculateLeaderboard(groupId, db)),
  ).then((results) => {
    for (const r of results) {
      if (r.status === 'rejected') console.error('[scoring] leaderboard recalc failed:', r.reason)
    }
  })

  await db.prepare(`UPDATE matches SET scored_at = ? WHERE id = ?`).bind(now, matchId).run()

  if (isPenaltyShootout) {
    for (const [groupId, tally] of groupBonus) {
      logEvent(ae, 'penalty_bonus_awarded', {
        blobs: [matchId, groupId],
        doubles: [tally.awarded, tally.total],
      })
    }
  }
}

// Scores all finished unscored matches in a competition. Knockout draws wait for penalty_winner_team_id up to PENALTY_DEFER_GRACE_MS.
export async function scoreUnprocessedMatches(
  competitionId: string,
  db: D1Database,
  ae?: AnalyticsEngineDataset,
): Promise<void> {
  // Truncate to seconds: 'T21:00:00Z' > 'T21:00:00.000Z' in ASCII, so milliseconds break the boundary comparison.
  const graceDeadline = new Date(Date.now() - PENALTY_DEFER_GRACE_MS).toISOString().slice(0, 19) + 'Z'
  const unscored = await db
    .prepare(
      `SELECT id, home_score, away_score, phase, penalty_winner_team_id FROM matches
       WHERE competition_id = ?
         AND status = 'finished'
         AND scored_at IS NULL
         AND home_score IS NOT NULL
         AND away_score IS NOT NULL
         AND (
           home_score != away_score
           -- hardcoded constant, not user input; D1 doesn't support array binding for IN
           OR phase NOT IN (${KNOCKOUT_PHASES_SQL})
           OR phase IS NULL
           OR penalty_winner_team_id IS NOT NULL
           OR start_time IS NULL
           OR start_time <= ?
         )`,
    )
    .bind(competitionId, graceDeadline)
    .all<{
      id: string
      home_score: number
      away_score: number
      phase: string | null
      penalty_winner_team_id: string | null
    }>()

  for (const match of unscored.results) {
    await scoreMatch(
      match.id,
      match.home_score,
      match.away_score,
      match.phase,
      match.penalty_winner_team_id,
      db,
      ae,
    )
  }
}
