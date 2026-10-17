import { matchGoesToPenalties, parsePenaltyPhases } from './penalties'

export interface ScoreInput {
  actualHome: number
  actualAway: number
  predictedHome: number
  predictedAway: number
  /** Group's points for an exact-score hit. 0 disables the exact-score bonus (1X2 mode). Default 3. */
  pointsExact?: number
  /** Group's points for predicting the correct winner/draw. Default 1. */
  pointsWinner?: number
}

/**
 * Pure scoring function for a single match prediction.
 *
 * Defaults match the classic rule (ADR-004):
 *   pointsExact (default 3)  — exact score match (when pointsExact > 0)
 *   pointsWinner (default 1) — correct outcome (home win / draw / away win), wrong score
 *   0 pts                    — wrong outcome
 *
 * When pointsExact is 0 ("só vencedor" / 1X2 mode), the exact-score check is
 * skipped and any correct outcome awards pointsWinner.
 */
export function calculatePoints(input: ScoreInput): number {
  const {
    actualHome,
    actualAway,
    predictedHome,
    predictedAway,
    pointsExact = 3,
    pointsWinner = 1,
  } = input
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
  if (penaltyWinner === null) return 0
  if (predictedHome !== predictedAway) return 0
  if (predictedPenaltyWinner === null) return 0
  return predictedPenaltyWinner === penaltyWinner ? pointsPenalty : 0
}

/**
 * Deriva quem avança num confronto de jogo único ou final.
 * Em caso de empate no tempo regulamentar e prorrogação, usa o vencedor nos pênaltis.
 */
export function resolveSingleMatchClassified(
  homeScore: number,
  awayScore: number,
  penaltyWinner: 'home' | 'away' | null,
): 'home' | 'away' | null {
  if (homeScore > awayScore) return 'home'
  if (awayScore > homeScore) return 'away'
  return penaltyWinner
}

/**
 * Deriva quem avança num confronto de ida e volta em relação ao mandante e ao
 * visitante do jogo de volta, em que o mandante da volta foi visitante na ida.
 */
export function resolveTwoLegClassified(
  leg1: { homeScore: number; awayScore: number },
  leg2: { homeScore: number; awayScore: number; penaltyWinner: 'home' | 'away' | null },
): 'home' | 'away' | null {
  const home2Agg = leg2.homeScore + leg1.awayScore
  const away2Agg = leg2.awayScore + leg1.homeScore
  if (home2Agg > away2Agg) return 'home'
  if (away2Agg > home2Agg) return 'away'
  return leg2.penaltyWinner
}

/**
 * Pontuação de classificado creditada apenas no jogo decisivo do confronto.
 */
export function calculateClassifiedBonus(
  predictedClassified: 'home' | 'away' | null,
  actualClassified: 'home' | 'away' | null,
  pointsClassified: number,
  eligible: boolean,
): number {
  if (!eligible || pointsClassified <= 0 || !actualClassified || !predictedClassified) return 0
  return predictedClassified === actualClassified ? pointsClassified : 0
}

type UnscoredMatchRow = {
  id: string
  home_team_id?: string
  away_team_id?: string
  home_score: number
  away_score: number
  penalty_winner: 'home' | 'away' | null
  phase: string | null
  leg?: 1 | 2 | null
  penalty_phases: string
}

type ScoredPredictionRow = {
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
  points_classified?: number
}

type Leg1MatchInfo = {
  id: string
  phase: string | null
  home_team_id: string
  away_team_id: string
  status: string
  home_score: number | null
  away_score: number | null
}

type Leg1PredictionInfo = {
  match_id: string
  group_id: string
  user_id: string
  predicted_home_score: number
  predicted_away_score: number
}

async function recalculateLeaderboards(groupIds: string[], db: D1Database): Promise<void> {
  if (groupIds.length === 0) return

  const rows = await db
    .prepare(
      `SELECT p.group_id, p.user_id,
              SUM(p.points_awarded + p.penalty_points + p.classified_points) AS total_points,
              SUM(
                CASE WHEN g.points_exact > g.points_winner
                       AND p.points_awarded = g.points_exact
                     THEN 1 ELSE 0 END
              ) AS exact_hits
       FROM predictions p
       JOIN groups g ON g.id = p.group_id
       WHERE p.group_id IN (SELECT value FROM json_each(?))
       GROUP BY p.group_id, p.user_id`,
    )
    .bind(JSON.stringify(groupIds))
    .all<{ group_id: string; user_id: string; total_points: number; exact_hits: number }>()

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
      .bind(row.group_id, row.user_id, row.total_points, row.exact_hits, now),
  )

  await runStatementBatches(db, statements)
}

/** Run D1 statements in parallel chunks of 100 (D1 batch limit). */
async function runStatementBatches(
  db: D1Database,
  statements: ReturnType<D1Database['prepare']>[],
): Promise<void> {
  const batches = []
  for (let i = 0; i < statements.length; i += 100) {
    const chunk = statements.slice(i, i + 100)
    batches.push(db.batch(chunk))
  }
  await Promise.all(batches)
}

async function fetchPredictionsInChunks(
  db: D1Database,
  matchIds: string[],
): Promise<ScoredPredictionRow[]> {
  const allPredictions: ScoredPredictionRow[] = []
  const chunkSize = 90

  for (let i = 0; i < matchIds.length; i += chunkSize) {
    const chunkIds = matchIds.slice(i, i + chunkSize)
    const placeholders = chunkIds.map(() => '?').join(',')

    const chunkPredictions = await db
      .prepare(
        `SELECT p.id, p.match_id, p.group_id, p.user_id,
                p.predicted_home_score, p.predicted_away_score, p.predicted_penalty_winner,
                g.points_exact, g.points_winner, g.points_penalty, g.points_classified
         FROM predictions p
         JOIN groups g ON g.id = p.group_id
         WHERE p.match_id IN (${placeholders})`,
      )
      .bind(...chunkIds)
      .all<ScoredPredictionRow>()

    allPredictions.push(...chunkPredictions.results)
  }

  return allPredictions
}

async function fetchLeg1Context(
  competitionId: string,
  unscored: UnscoredMatchRow[],
  db: D1Database,
): Promise<{
  leg1ByKey: Map<string, Leg1MatchInfo>
  leg1PredByKey: Map<string, Leg1PredictionInfo>
}> {
  const leg2Phases = Array.from(
    new Set(
      unscored
        .filter((m) => m.leg === 2 && m.phase)
        .map((m) => m.phase as string),
    ),
  )

  const leg1ByKey = new Map<string, Leg1MatchInfo>()
  const leg1PredByKey = new Map<string, Leg1PredictionInfo>()
  if (leg2Phases.length === 0) return { leg1ByKey, leg1PredByKey }

  const phasePlaceholders = leg2Phases.map(() => '?').join(',')
  const leg1Matches = await db
    .prepare(
      `SELECT id, phase, home_team_id, away_team_id, status, home_score, away_score
       FROM matches
       WHERE competition_id = ? AND leg = 1 AND phase IN (${phasePlaceholders})`,
    )
    .bind(competitionId, ...leg2Phases)
    .all<Leg1MatchInfo>()

  const leg1Ids: string[] = []
  for (const m1 of leg1Matches.results) {
    if (!m1.phase) continue
    leg1ByKey.set(`${m1.phase}:${m1.home_team_id}:${m1.away_team_id}`, m1)
    leg1Ids.push(m1.id)
  }

  if (leg1Ids.length === 0) return { leg1ByKey, leg1PredByKey }

  const chunkSize = 90
  for (let i = 0; i < leg1Ids.length; i += chunkSize) {
    const chunkIds = leg1Ids.slice(i, i + chunkSize)
    const placeholders = chunkIds.map(() => '?').join(',')
    const preds = await db
      .prepare(
        `SELECT match_id, group_id, user_id, predicted_home_score, predicted_away_score
         FROM predictions
         WHERE match_id IN (${placeholders})`,
      )
      .bind(...chunkIds)
      .all<Leg1PredictionInfo>()

    for (const p1 of preds.results) {
      leg1PredByKey.set(`${p1.match_id}:${p1.group_id}:${p1.user_id}`, p1)
    }
  }

  return { leg1ByKey, leg1PredByKey }
}

function evaluateClassifiedPointsForPrediction(
  matchCtx: UnscoredMatchRow,
  p: ScoredPredictionRow,
  eligible: boolean,
  leg1ByKey: Map<string, Leg1MatchInfo>,
  leg1PredByKey: Map<string, Leg1PredictionInfo>,
): number {
  const pointsClassified = p.points_classified ?? 0
  if (!eligible || pointsClassified <= 0 || matchCtx.leg === 1) return 0

  if (matchCtx.leg === 2) {
    if (!matchCtx.phase || !matchCtx.home_team_id || !matchCtx.away_team_id) return 0
    const leg1 = leg1ByKey.get(
      `${matchCtx.phase}:${matchCtx.away_team_id}:${matchCtx.home_team_id}`,
    )
    if (!leg1 || leg1.status !== 'finished' || leg1.home_score === null || leg1.away_score === null) {
      return 0
    }
    const p1 = leg1PredByKey.get(`${leg1.id}:${p.group_id}:${p.user_id}`)
    if (!p1) return 0

    const actualClassified = resolveTwoLegClassified(
      { homeScore: leg1.home_score, awayScore: leg1.away_score },
      {
        homeScore: matchCtx.home_score,
        awayScore: matchCtx.away_score,
        penaltyWinner: matchCtx.penalty_winner,
      },
    )
    const predictedClassified = resolveTwoLegClassified(
      { homeScore: p1.predicted_home_score, awayScore: p1.predicted_away_score },
      {
        homeScore: p.predicted_home_score,
        awayScore: p.predicted_away_score,
        penaltyWinner: p.predicted_penalty_winner,
      },
    )
    return calculateClassifiedBonus(predictedClassified, actualClassified, pointsClassified, eligible)
  }

  const actualClassified = resolveSingleMatchClassified(
    matchCtx.home_score,
    matchCtx.away_score,
    matchCtx.penalty_winner,
  )
  const predictedClassified = resolveSingleMatchClassified(
    p.predicted_home_score,
    p.predicted_away_score,
    p.predicted_penalty_winner,
  )
  return calculateClassifiedBonus(predictedClassified, actualClassified, pointsClassified, eligible)
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
      `SELECT m.id, m.home_team_id, m.away_team_id, m.home_score, m.away_score,
              m.penalty_winner, m.phase, m.leg, c.penalty_phases
       FROM matches m
       JOIN competitions c ON c.id = m.competition_id
       WHERE m.competition_id = ?
         AND m.status = 'finished'
         AND m.scored_at IS NULL
         AND m.home_score IS NOT NULL
         AND m.away_score IS NOT NULL`,
    )
    .bind(competitionId)
    .all<UnscoredMatchRow>()

  if (unscored.results.length === 0) return

  const matchIds = unscored.results.map((m) => m.id)
  const [allPredictions, { leg1ByKey, leg1PredByKey }] = await Promise.all([
    fetchPredictionsInChunks(db, matchIds),
    fetchLeg1Context(competitionId, unscored.results, db),
  ])

  const matchMap = new Map<string, UnscoredMatchRow>()
  for (const m of unscored.results) {
    matchMap.set(m.id, m)
  }

  const eligibleCache = new Map<string, boolean>()
  const now = new Date().toISOString()
  const statements: ReturnType<D1Database['prepare']>[] = []
  const affectedGroups = new Set<string>()

  const updatePredictionStmt = db.prepare(
    `UPDATE predictions SET points_awarded = ?, penalty_points = ?, classified_points = ? WHERE id = ?`,
  )

  for (const p of allPredictions) {
    const matchCtx = matchMap.get(p.match_id)!

    let eligible = eligibleCache.get(p.match_id)
    if (eligible === undefined) {
      eligible = matchGoesToPenalties(parsePenaltyPhases(matchCtx.penalty_phases), matchCtx.phase)
      eligibleCache.set(p.match_id, eligible)
    }

    const points = calculatePoints({
      actualHome: matchCtx.home_score,
      actualAway: matchCtx.away_score,
      predictedHome: p.predicted_home_score,
      predictedAway: p.predicted_away_score,
      pointsExact: p.points_exact,
      pointsWinner: p.points_winner,
    })

    const penaltyPoints = calculatePenaltyBonus(
      p.predicted_home_score,
      p.predicted_away_score,
      p.predicted_penalty_winner,
      matchCtx.penalty_winner,
      p.points_penalty,
      eligible,
    )

    const classifiedPoints = evaluateClassifiedPointsForPrediction(
      matchCtx,
      p,
      eligible,
      leg1ByKey,
      leg1PredByKey,
    )

    statements.push(updatePredictionStmt.bind(points, penaltyPoints, classifiedPoints, p.id))
    affectedGroups.add(p.group_id)
  }

  const updateMatchStmt = db.prepare(`UPDATE matches SET scored_at = ? WHERE id = ?`)
  for (const matchId of matchIds) {
    statements.push(updateMatchStmt.bind(now, matchId))
  }

  await runStatementBatches(db, statements)
  await recalculateLeaderboards(Array.from(affectedGroups), db)
}
