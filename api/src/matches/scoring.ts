import type { D1Database } from '@cloudflare/workers-types'

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

async function recalculateLeaderboard(groupId: string, db: D1Database): Promise<void> {
  // exact_hits is inferred from the awarded points: a prediction is an exact hit
  // when it scored the group's points_exact. We only count it when the exact bonus
  // is distinguishable from a plain winner hit (points_exact > points_winner) — when
  // they're equal there's no exact bonus to detect, so exact_hits stays 0.
  const rows = await db
    .prepare(
      `SELECT p.user_id,
              SUM(p.points_awarded) AS total_points,
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
  db: D1Database,
): Promise<void> {
  const predictions = await db
    .prepare(
      `SELECT p.id, p.group_id, p.user_id,
              p.predicted_home_score, p.predicted_away_score,
              g.points_exact, g.points_winner
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
      points_exact: number
      points_winner: number
    }>()

  const now = new Date().toISOString()
  const statements: ReturnType<D1Database['prepare']>[] = []

  const affectedGroups = new Set<string>()
  for (const p of predictions.results) {
    const points = calculatePoints(
      homeScore,
      awayScore,
      p.predicted_home_score,
      p.predicted_away_score,
      p.points_exact,
      p.points_winner,
    )
    statements.push(
      db.prepare(`UPDATE predictions SET points_awarded = ? WHERE id = ?`).bind(points, p.id),
    )
    affectedGroups.add(p.group_id)
  }

  statements.push(
    db.prepare(`UPDATE matches SET scored_at = ? WHERE id = ?`).bind(now, matchId),
  )

  await db.batch(statements)

  for (const groupId of affectedGroups) {
    await recalculateLeaderboard(groupId, db)
  }
}

/**
 * Finds finished matches with no scored_at in the given competition and scores them.
 * Safe to call multiple times — matches already scored are skipped.
 */
export async function scoreUnprocessedMatches(
  competitionId: string,
  db: D1Database,
): Promise<void> {
  const unscored = await db
    .prepare(
      `SELECT id, home_score, away_score FROM matches
       WHERE competition_id = ?
         AND status = 'finished'
         AND scored_at IS NULL
         AND home_score IS NOT NULL
         AND away_score IS NOT NULL`,
    )
    .bind(competitionId)
    .all<{ id: string; home_score: number; away_score: number }>()

  for (const match of unscored.results) {
    await scoreMatch(match.id, match.home_score, match.away_score, db)
  }
}
