import type { D1Database } from '@cloudflare/workers-types'
import { matchGoesToPenalties, parsePenaltyPhases } from './penalties'
import { isKnockoutPhase } from './rounds'
import { fetchTieMatches, indexTies, type TieInfo, type TieMatch } from './ties'

export function calculatePoints({
  actualHome,
  actualAway,
  predictedHome,
  predictedAway,
  pointsExact = 3,
  pointsWinner = 1,
}: {
  actualHome: number
  actualAway: number
  predictedHome: number
  predictedAway: number
  pointsExact?: number
  pointsWinner?: number
}): number {
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
 * Devolve o classificado como 'home' ou 'away' do jogo de volta. O mandante da
 * volta é o visitante da ida.
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
 * Devolve pointsClassified quando o classificado previsto coincide com o real,
 * e 0 nos outros casos.
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
  competition_id: string
  home_team_id: string
  away_team_id: string
  start_time: string
  home_score: number
  away_score: number
  penalty_winner: 'home' | 'away' | null
  phase: string | null
  leg: 1 | 2 | null
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
  points_classified: number
}

/** Jogo de mata-mata com o placar e o estado de pontuação, para montar os confrontos. */
type TieMatchRow = TieMatch & {
  status: string
  home_score: number | null
  away_score: number | null
  penalty_winner: 'home' | 'away' | null
  scored_at: string | null
}

const TIE_MATCH_COLUMNS = ['status', 'home_score', 'away_score', 'penalty_winner', 'scored_at']

type Leg1PredictionInfo = {
  match_id: string
  group_id: string
  user_id: string
  predicted_home_score: number
  predicted_away_score: number
}

function leaderboardRefreshStatement(db: D1Database, groupIds: string[]) {
  return db
    .prepare(`INSERT INTO leaderboard (group_id, user_id, total_points, exact_hits, last_updated)
    SELECT p.group_id, p.user_id, SUM(p.points_awarded + p.penalty_points + p.classified_points),
      SUM(CASE WHEN g.points_exact > g.points_winner AND p.points_awarded = g.points_exact THEN 1 ELSE 0 END), ?
    FROM predictions p JOIN groups g ON g.id = p.group_id
    WHERE p.group_id IN (SELECT value FROM json_each(?)) GROUP BY p.group_id, p.user_id
    ON CONFLICT (group_id, user_id) DO UPDATE SET total_points = excluded.total_points,
      exact_hits = excluded.exact_hits, last_updated = excluded.last_updated`)
    .bind(new Date().toISOString(), JSON.stringify(groupIds))
}

async function recalculateLeaderboards(groupIds: string[], db: D1Database): Promise<void> {
  if (groupIds.length > 0) await db.batch([leaderboardRefreshStatement(db, groupIds)])
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

/** Busca os palpites dos jogos informados em lotes (limite de bind do D1 ~100). */
async function fetchPredictionsInChunks(
  db: D1Database,
  matchIds: string[],
): Promise<ScoredPredictionRow[]> {
  const allPredictions: ScoredPredictionRow[] = []
  const CHUNK_SIZE = 90 // Safe limit under 100 for D1 IN clauses

  for (let i = 0; i < matchIds.length; i += CHUNK_SIZE) {
    const chunkIds = matchIds.slice(i, i + CHUNK_SIZE)
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

/** Palpites dos jogos de ida, indexados por `match_id:group_id:user_id`. */
async function fetchLeg1Predictions(
  db: D1Database,
  leg1Ids: string[],
): Promise<Map<string, Leg1PredictionInfo>> {
  const leg1PredByKey = new Map<string, Leg1PredictionInfo>()
  const CHUNK_SIZE = 90 // Safe limit under 100 for D1 IN clauses

  for (let i = 0; i < leg1Ids.length; i += CHUNK_SIZE) {
    const chunkIds = leg1Ids.slice(i, i + CHUNK_SIZE)
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

  return leg1PredByKey
}

/**
 * Volta já pontuada cuja ida está na lista de não pontuados: a ida teve o placar
 * corrigido depois da volta, então o classificado da volta precisa ser refeito.
 * Repontuar é idempotente: os pontos são gravados com SET e o ranking é a soma.
 */
function findLeg2ToRescore(
  unscored: UnscoredMatchRow[],
  ties: Map<string, TieInfo<TieMatchRow>>,
): UnscoredMatchRow[] {
  const unscoredIds = new Set(unscored.map((m) => m.id))
  const extra: UnscoredMatchRow[] = []
  for (const m of unscored) {
    const tie = ties.get(m.id)
    const leg2 = tie?.partner
    if (tie?.role !== 'leg1' || !leg2 || unscoredIds.has(leg2.id)) continue
    if (leg2.status !== 'finished' || leg2.scored_at === null) continue
    if (leg2.home_score === null || leg2.away_score === null) continue
    unscoredIds.add(leg2.id)
    extra.push({
      ...leg2,
      home_score: leg2.home_score,
      away_score: leg2.away_score,
      penalty_phases: m.penalty_phases,
    })
  }
  return extra
}

/**
 * Pontos de classificado de um palpite. Só o jogo decisivo do confronto credita:
 * a volta no ida e volta, ou o jogo único. Vale em toda fase de mata-mata,
 * independente de `penalty_phases`. Sem palpite na ida, a volta não pontua.
 */
function evaluateClassifiedPointsForPrediction(
  matchCtx: UnscoredMatchRow,
  p: ScoredPredictionRow,
  tie: TieInfo<TieMatchRow> | undefined,
  leg1PredByKey: Map<string, Leg1PredictionInfo>,
): number {
  const pointsClassified = p.points_classified ?? 0
  const eligible = isKnockoutPhase(matchCtx.phase)
  const role = tie?.role ?? 'single'
  if (!eligible || pointsClassified <= 0 || role === 'leg1') return 0

  if (role === 'leg2') {
    const leg1 = tie?.partner
    if (
      !leg1 ||
      leg1.status !== 'finished' ||
      leg1.home_score === null ||
      leg1.away_score === null
    ) {
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
    return calculateClassifiedBonus(
      predictedClassified,
      actualClassified,
      pointsClassified,
      eligible,
    )
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
  // 1. Fetch all unscored matches along with penalty context and scores
  const unscored = await db
    .prepare(
      `SELECT m.id, m.competition_id, m.home_team_id, m.away_team_id, m.start_time,
              m.home_score, m.away_score, m.penalty_winner, m.phase, m.leg, c.penalty_phases
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

  // 2. Knockout ties: pair each match with the other leg and pull back the
  // already-scored leg 2 of any leg 1 whose score was corrected.
  const tieMatches = await fetchTieMatches<TieMatchRow>(
    db,
    competitionId,
    unscored.results.map((m) => m.phase),
    TIE_MATCH_COLUMNS,
  )
  const ties = indexTies(tieMatches)
  const matchesToScore = [...unscored.results, ...findLeg2ToRescore(unscored.results, ties)]

  // 3. Fetch predictions for all matches to score in chunks (D1 bind limit ~100),
  // plus the leg 1 predictions that the leg 2 classified bonus depends on.
  const matchIds = matchesToScore.map((m) => m.id)
  const leg1Ids = Array.from(
    new Set(
      matchesToScore.flatMap((m) => {
        const tie = ties.get(m.id)
        return tie?.role === 'leg2' && tie.partner ? [tie.partner.id] : []
      }),
    ),
  )
  const [allPredictions, leg1PredByKey] = await Promise.all([
    fetchPredictionsInChunks(db, matchIds),
    fetchLeg1Predictions(db, leg1Ids),
  ])

  // 4. Process matches and map them by id for quick lookup
  const matchMap = new Map<string, UnscoredMatchRow>()
  for (const m of matchesToScore) {
    matchMap.set(m.id, m)
  }

  const eligibleCache = new Map<string, boolean>() // match_id -> eligible

  const now = new Date().toISOString()
  const statements: ReturnType<D1Database['prepare']>[] = []
  const affectedGroups = new Set<string>()

  const updatePredictionStmt = db.prepare(
    `UPDATE predictions SET points_awarded = ?, penalty_points = ?, classified_points = ? * (SELECT points_classified FROM groups WHERE id = predictions.group_id) WHERE id = ?`,
  )

  // 5. Evaluate all predictions
  for (const p of allPredictions) {
    const matchCtx = matchMap.get(p.match_id)!

    // Cache eligibility check per match
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

    const tie = ties.get(p.match_id)
    const p1 =
      tie?.role === 'leg2' && tie.partner
        ? leg1PredByKey.get(`${tie.partner.id}:${p.group_id}:${p.user_id}`)
        : undefined
    const penaltyEligible = tie?.role === 'leg2' ? Boolean(p1) : eligible && tie?.role !== 'leg1'
    const penaltyPoints = calculatePenaltyBonus(
      p.predicted_home_score + (p1?.predicted_away_score ?? 0),
      p.predicted_away_score + (p1?.predicted_home_score ?? 0),
      p.predicted_penalty_winner,
      matchCtx.penalty_winner,
      p.points_penalty,
      penaltyEligible,
    )

    const classifiedPoints = evaluateClassifiedPointsForPrediction(
      matchCtx,
      { ...p, points_classified: 1 },
      ties.get(p.match_id),
      leg1PredByKey,
    )

    statements.push(updatePredictionStmt.bind(points, penaltyPoints, classifiedPoints, p.id))
    affectedGroups.add(p.group_id)
  }

  const updateMatchStmt = db.prepare(`UPDATE matches SET scored_at = ? WHERE id = ?`)

  // 6. Update matches as scored
  for (const matchId of matchIds) {
    statements.push(updateMatchStmt.bind(now, matchId))
  }

  // 7. Execute updates in chunks of 100 to avoid D1 limits
  await runStatementBatches(db, statements)

  // 8. Deduplicated recalculate leaderboard
  await recalculateLeaderboards(Array.from(affectedGroups), db)
}

/** Statements for an atomic group-rule change; other groups and scoring flags stay untouched. */
export async function classifiedRuleChangeStatements(
  db: D1Database,
  groupId: string,
  competitionId: string,
  pointsClassified: number,
) {
  const { results: matches } = await db
    .prepare(
      `SELECT id, competition_id, home_team_id, away_team_id, start_time, home_score, away_score,
            penalty_winner, phase, leg, status, scored_at FROM matches WHERE competition_id = ? ORDER BY id`,
    )
    .bind(competitionId)
    .all<TieMatchRow>()
  const ties = indexTies(matches)
  const { results: predictions } = await db
    .prepare(
      `SELECT p.id, p.match_id, p.group_id, p.user_id, p.predicted_home_score, p.predicted_away_score,
            p.predicted_penalty_winner, g.points_exact, g.points_winner, g.points_penalty, g.points_classified
     FROM predictions p JOIN groups g ON g.id = p.group_id WHERE p.group_id = ? ORDER BY p.id`,
    )
    .bind(groupId)
    .all<ScoredPredictionRow>()
  const leg1 = new Map(predictions.map((p) => [`${p.match_id}:${p.group_id}:${p.user_id}`, p]))
  const matchMap = new Map(matches.map((m) => [m.id, m]))
  const updates: { id: string; points: number }[] = []
  for (const prediction of predictions) {
    const match = matchMap.get(prediction.match_id)
    if (
      !match ||
      match.status !== 'finished' ||
      match.home_score === null ||
      match.away_score === null ||
      !isKnockoutPhase(match.phase)
    )
      continue
    const points = evaluateClassifiedPointsForPrediction(
      {
        ...match,
        home_score: match.home_score,
        away_score: match.away_score,
        penalty_phases: '[]',
      },
      { ...prediction, points_classified: pointsClassified },
      ties.get(match.id),
      leg1,
    )
    updates.push({ id: prediction.id, points })
  }
  // The guard runs inside the write transaction. A sync or prediction edit between
  // the reads above and this batch aborts it, so the caller can rebuild the snapshot.
  const matchFields = [
    'id',
    'competition_id',
    'home_team_id',
    'away_team_id',
    'start_time',
    'home_score',
    'away_score',
    'penalty_winner',
    'phase',
    'leg',
    'status',
  ] as const
  const pickFields = [
    'id',
    'match_id',
    'group_id',
    'user_id',
    'predicted_home_score',
    'predicted_away_score',
    'predicted_penalty_winner',
  ] as const
  const matchSnapshot = JSON.stringify(matches.map((m) => matchFields.map((field) => m[field])))
  const pickSnapshot = JSON.stringify(predictions.map((p) => pickFields.map((field) => p[field])))
  const guard = db
    .prepare(`SELECT CASE WHEN
    (SELECT json_group_array(json_array(${matchFields.join(', ')})) FROM (SELECT * FROM matches WHERE competition_id = ? ORDER BY id)) = ?
    AND (SELECT json_group_array(json_array(${pickFields.join(', ')})) FROM (SELECT * FROM predictions WHERE group_id = ? ORDER BY id)) = ?
    THEN 1 ELSE json_extract('{}', 'classified_snapshot_changed') END`)
    .bind(competitionId, matchSnapshot, groupId, pickSnapshot)
  return [
    guard,
    db
      .prepare(`UPDATE predictions SET classified_points = (
      SELECT json_extract(value, '$.points') FROM json_each(?) WHERE json_extract(value, '$.id') = predictions.id
    ) WHERE group_id = ? AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`)
      .bind(JSON.stringify(updates), groupId, JSON.stringify(updates)),
    leaderboardRefreshStatement(db, [groupId]),
  ]
}
