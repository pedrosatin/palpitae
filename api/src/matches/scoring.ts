import type { D1Database } from '@cloudflare/workers-types'

export function calculatePoints(
  actualHome: number,
  actualAway: number,
  predictedHome: number,
  predictedAway: number,
): number {
  if (predictedHome === actualHome && predictedAway === actualAway) return 3
  const actualWinner = actualHome > actualAway ? 'home' : actualHome < actualAway ? 'away' : 'draw'
  const predictedWinner =
    predictedHome > predictedAway ? 'home' : predictedHome < predictedAway ? 'away' : 'draw'
  return actualWinner === predictedWinner ? 1 : 0
}

async function recalculateLeaderboard(groupId: string, db: D1Database): Promise<void> {
  const rows = await db
    .prepare(
      `SELECT user_id,
              SUM(points_awarded) AS total_points,
              SUM(CASE WHEN points_awarded = 3 THEN 1 ELSE 0 END) AS exact_hits
       FROM predictions
       WHERE group_id = ?
       GROUP BY user_id`,
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
      `SELECT id, group_id, user_id, predicted_home_score, predicted_away_score
       FROM predictions WHERE match_id = ?`,
    )
    .bind(matchId)
    .all<{
      id: string
      group_id: string
      user_id: string
      predicted_home_score: number
      predicted_away_score: number
    }>()

  const now = new Date().toISOString()
  const statements: ReturnType<D1Database['prepare']>[] = []

  const affectedGroups = new Set<string>()
  for (const p of predictions.results) {
    const points = calculatePoints(homeScore, awayScore, p.predicted_home_score, p.predicted_away_score)
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
