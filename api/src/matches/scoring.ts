import type { D1Database } from '@cloudflare/workers-types'
import { matchGoesToPenalties, parsePenaltyPhases } from './penalties'

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

/**
 * Additive bonus for correctly calling the penalty-shootout winner. Independent
 * of the exact-score rule — it only requires predicting the draw (the regular
 * result) plus the right shootout winner. Returns pointsPenalty or 0.
 *
 * All conditions must hold:
 *   - the match is in an eligible (competition, phase) — gated upstream;
 *   - the match actually went to penalties (penaltyWinner != null);
 *   - the prediction was a draw (predictedHome === predictedAway);
 *   - the predicted shootout winner matches the actual one;
 *   - pointsPenalty > 0 (0 disables the bonus).
 *
 * Missing the shootout winner costs nothing (no penalization), just no bonus.
 */
export function calculatePenaltyBonus(
  predictedHome: number,
  predictedAway: number,
  predictedPenaltyWinner: 'home' | 'away' | null,
  penaltyWinner: 'home' | 'away' | null,
  pointsPenalty: number,
  eligible: boolean,
): number {
  if (!eligible || pointsPenalty <= 0) return 0
  if (penaltyWinner === null) return 0 // não foi a pênaltis
  if (predictedHome !== predictedAway) return 0 // palpite não foi empate
  if (predictedPenaltyWinner === null) return 0
  return predictedPenaltyWinner === penaltyWinner ? pointsPenalty : 0
}

async function recalculateLeaderboard(groupId: string, db: D1Database): Promise<void> {
  // exact_hits is inferred from the awarded points: a prediction is an exact hit
  // when it scored the group's points_exact. We only count it when the exact bonus
  // is distinguishable from a plain winner hit (points_exact > points_winner) — when
  // they're equal there's no exact bonus to detect, so exact_hits stays 0.
  const rows = await db
    .prepare(
      `SELECT p.user_id,
              SUM(p.points_awarded + p.penalty_points) AS total_points,
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

/**
 * Finds finished matches with no scored_at in the given competition and scores them.
 * Safe to call multiple times — matches already scored are skipped.
 */
export async function scoreUnprocessedMatches(
  competitionId: string,
  db: D1Database,
): Promise<void> {
  // 1. Fetch all unscored matches along with penalty context and scores
  const unscored = await db
    .prepare(
      `SELECT m.id, m.home_score, m.away_score, m.penalty_winner, m.phase, c.penalty_phases
       FROM matches m
       JOIN competitions c ON c.id = m.competition_id
       WHERE m.competition_id = ?
         AND m.status = 'finished'
         AND m.scored_at IS NULL
         AND m.home_score IS NOT NULL
         AND m.away_score IS NOT NULL`,
    )
    .bind(competitionId)
    .all<{
      id: string
      home_score: number
      away_score: number
      penalty_winner: 'home' | 'away' | null
      phase: string | null
      penalty_phases: string
    }>()

  if (unscored.results.length === 0) return

  // 2. Fetch predictions for all unscored matches in chunks (D1 bind limit ~100)
  const allPredictions: {
    id: string
    match_id: string
    group_id: string
    user_id: string
    predicted_home_score: number
    predicted_away_score: number
    predicted_penalty_winner: 'home' | 'away' | null
    points_exact: number
    points_winner: number
    points_penalty: number
  }[] = []

  const matchIds = unscored.results.map((m) => m.id)
  const CHUNK_SIZE = 90 // Safe limit under 100 for D1 IN clauses

  for (let i = 0; i < matchIds.length; i += CHUNK_SIZE) {
    const chunkIds = matchIds.slice(i, i + CHUNK_SIZE)
    const placeholders = chunkIds.map(() => '?').join(',')

    const chunkPredictions = await db
      .prepare(
        `SELECT p.id, p.match_id, p.group_id, p.user_id,
                p.predicted_home_score, p.predicted_away_score, p.predicted_penalty_winner,
                g.points_exact, g.points_winner, g.points_penalty
         FROM predictions p
         JOIN groups g ON g.id = p.group_id
         WHERE p.match_id IN (${placeholders})`,
      )
      .bind(...chunkIds)
      .all<typeof allPredictions[number]>()

    allPredictions.push(...chunkPredictions.results)
  }

  // 3. Process matches and map them by id for quick lookup
  const matchMap = new Map<string, typeof unscored.results[number]>()
  for (const m of unscored.results) {
    matchMap.set(m.id, m)
  }

  const eligibleCache = new Map<string, boolean>() // match_id -> eligible

  const now = new Date().toISOString()
  const statements: ReturnType<D1Database['prepare']>[] = []
  const affectedGroups = new Set<string>()

  // 4. Evaluate all predictions
  for (const p of allPredictions) {
    const matchCtx = matchMap.get(p.match_id)!

    // Cache eligibility check per match
    let eligible = eligibleCache.get(p.match_id)
    if (eligible === undefined) {
      eligible = matchGoesToPenalties(
        parsePenaltyPhases(matchCtx.penalty_phases),
        matchCtx.phase,
      )
      eligibleCache.set(p.match_id, eligible)
    }

    const points = calculatePoints(
      matchCtx.home_score,
      matchCtx.away_score,
      p.predicted_home_score,
      p.predicted_away_score,
      p.points_exact,
      p.points_winner,
    )

    const penaltyPoints = calculatePenaltyBonus(
      p.predicted_home_score,
      p.predicted_away_score,
      p.predicted_penalty_winner,
      matchCtx.penalty_winner,
      p.points_penalty,
      eligible,
    )

    statements.push(
      db
        .prepare(`UPDATE predictions SET points_awarded = ?, penalty_points = ? WHERE id = ?`)
        .bind(points, penaltyPoints, p.id),
    )
    affectedGroups.add(p.group_id)
  }

  // 5. Update matches as scored
  for (const matchId of matchIds) {
    statements.push(
      db.prepare(`UPDATE matches SET scored_at = ? WHERE id = ?`).bind(now, matchId),
    )
  }

  // 6. Execute updates in chunks of 100 to avoid D1 limits
  for (let i = 0; i < statements.length; i += 100) {
    const chunk = statements.slice(i, i + 100)
    await db.batch(chunk)
  }

  // 7. Deduplicated recalculate leaderboard
  for (const groupId of affectedGroups) {
    await recalculateLeaderboard(groupId, db)
  }
}
