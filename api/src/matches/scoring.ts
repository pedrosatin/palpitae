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

/** Jogo a pontuar com o número de palpites, que só dimensiona as gravações. */
type PlannedMatch = UnscoredMatchRow & {
  /** Palpites do jogo, contando os de grupos excluídos. */
  prediction_count: number
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

/** Pontos de um palpite no ranking. Exige o alias `p` para `predictions`. */
export const PREDICTION_POINTS_SQL = 'p.points_awarded + p.penalty_points + p.classified_points'

/** 1 quando o palpite cravou o placar. Exige os aliases `p` (`predictions`) e `g` (`groups`). */
export const EXACT_HIT_SQL =
  'CASE WHEN g.points_exact > g.points_winner AND p.points_awarded = g.points_exact THEN 1 ELSE 0 END'

/**
 * Grupo não excluído. A pontuação e o ranking param na exclusão: pontos e ranking de
 * um grupo excluído ficam como estavam.
 * Exige o alias `g` para `groups`.
 */
const ACTIVE_GROUP_SQL = 'g.deleted_at IS NULL'

function leaderboardRefreshStatement(db: D1Database, groupIds: string[]) {
  return db
    .prepare(`INSERT INTO leaderboard (group_id, user_id, total_points, exact_hits, last_updated)
    SELECT p.group_id, p.user_id, SUM(${PREDICTION_POINTS_SQL}),
      SUM(${EXACT_HIT_SQL}), ?
    FROM predictions p JOIN groups g ON g.id = p.group_id AND ${ACTIVE_GROUP_SQL}
    WHERE p.group_id IN (SELECT value FROM json_each(?)) GROUP BY p.group_id, p.user_id
    ON CONFLICT (group_id, user_id) DO UPDATE SET total_points = excluded.total_points,
      exact_hits = excluded.exact_hits, last_updated = excluded.last_updated`)
    .bind(new Date().toISOString(), JSON.stringify(groupIds))
}

/**
 * Condição de toda gravação da pontuação de um jogo: ele segue encerrado com o
 * placar e o vencedor nos pênaltis lidos e, na volta, a ida não mudou. Se uma
 * correção de placar chegou depois da leitura, a gravação não altera nada e o
 * jogo fica para quem ler o placar novo.
 */
const UNCHANGED_RESULT_SQL = `EXISTS (SELECT 1 FROM matches WHERE id = ? AND status = 'finished'
    AND home_score = ? AND away_score = ? AND penalty_winner IS ?)
  AND NOT EXISTS (SELECT 1 FROM matches WHERE id = ?
    AND (status IS NOT ? OR home_score IS NOT ? OR away_score IS NOT ?))`

function unchangedResultBinds(m: UnscoredMatchRow, tie: TieInfo<TieMatchRow> | undefined) {
  const leg1 = tie?.role === 'leg2' ? tie.partner : null
  return [
    m.id,
    m.home_score,
    m.away_score,
    m.penalty_winner,
    leg1?.id ?? null,
    leg1?.status ?? null,
    leg1?.home_score ?? null,
    leg1?.away_score ?? null,
  ]
}

/**
 * Palpites dos jogos informados, só de grupos não excluídos. Um jogo de volta
 * traz junto os palpites da ida, que decidem o classificado.
 */
async function fetchPredictions(db: D1Database, matchIds: string[]): Promise<ScoredPredictionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.match_id, p.group_id, p.user_id,
              p.predicted_home_score, p.predicted_away_score, p.predicted_penalty_winner,
              g.points_exact, g.points_winner, g.points_penalty, g.points_classified
       FROM predictions p
       JOIN groups g ON g.id = p.group_id AND ${ACTIVE_GROUP_SQL}
       WHERE p.match_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(matchIds))
    .all<ScoredPredictionRow>()
  return results
}

/**
 * Volta já pontuada cuja ida está na lista de não pontuados: a ida teve o placar
 * corrigido depois da volta, então o classificado da volta precisa ser refeito.
 * Repontuar é idempotente: os pontos são gravados com SET e o ranking é a soma.
 */
function findLeg2ToRescore(
  unscored: PlannedMatch[],
  ties: Map<string, TieInfo<TieMatchRow>>,
): PlannedMatch[] {
  const unscoredIds = new Set(unscored.map((m) => m.id))
  const extra: PlannedMatch[] = []
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
      // Ida e volta têm os mesmos grupos: a contagem da ida serve de estimativa.
      prediction_count: m.prediction_count,
    })
  }
  return extra
}

/**
 * Jogo que decide nos pênaltis, terminou empatado (no placar do jogo único ou no
 * agregado da volta) e ainda não tem o vencedor da disputa. Fica sem pontuação até
 * o provedor informar o vencedor: pontuar antes daria zero de classificado e de
 * pênaltis a todos. Segue a regra de `decides_on_penalties` de `GET /matches`.
 */
function awaitsPenaltyWinner(m: UnscoredMatchRow, tie: TieInfo<TieMatchRow> | undefined): boolean {
  if (m.penalty_winner !== null || tie?.role === 'leg1') return false
  if (tie?.role === 'leg2') {
    const leg1 = tie.partner
    if (leg1?.status !== 'finished' || leg1.home_score === null || leg1.away_score === null)
      return false
    return m.home_score + leg1.away_score === m.away_score + leg1.home_score
  }
  return (
    m.home_score === m.away_score &&
    matchGoesToPenalties(parsePenaltyPhases(m.penalty_phases), m.phase)
  )
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
 * Tamanho de uma gravação. Jogos com poucos palpites dividem a mesma gravação até
 * somar `PREDICTIONS_PER_WRITE` palpites ou `MATCHES_PER_WRITE` jogos. Um jogo com
 * mais palpites que isso vai inteiro numa gravação só dele, com os pontos em
 * instruções de até `PREDICTIONS_PER_STATEMENT` palpites. Cada bind do D1 aceita
 * 2 MB, e os pontos de 1000 palpites ocupam cerca de 50 KB.
 */
const PREDICTIONS_PER_WRITE = 250
const MATCHES_PER_WRITE = 25
const PREDICTIONS_PER_STATEMENT = 1000

/**
 * Chamadas ao D1 do planejamento (jogos sem pontuação e confrontos de mata-mata)
 * e de cada gravação (leitura dos palpites e o `batch`).
 */
const PLAN_CALLS = 2
const WRITE_CALLS = 2

/** Chamadas abaixo das quais `scoreUnprocessedMatches` não começa: planejar e gravar uma vez. */
export const MIN_SCORING_CALLS = PLAN_CALLS + WRITE_CALLS

export type ScoringOutcome = {
  /** Jogos cuja gravação rodou. Ela não altera nada se o resultado mudou depois da leitura. */
  scored: number
  /** `false` quando a execução parou por falta de chamadas, com ou sem jogo pendente. */
  complete: boolean
}

/** Jogos gravados juntos: um jogo, ou a ida e a volta de um confronto. */
type ScoringUnit = { matches: PlannedMatch[]; predictions: number }

/** Pontos de um palpite: id, pontos do placar, de pênaltis e de classificado (0 ou 1). */
type ScoredPoints = [id: string, points: number, penalty: number, classified: number]

/**
 * Agrupa os jogos em unidades de gravação. Ida e volta do mesmo confronto ficam
 * na mesma unidade: gravada sozinha, a ida corrigida sairia dos pendentes e a
 * execução seguinte não repontuaria a volta.
 */
function buildUnits(
  matches: PlannedMatch[],
  ties: Map<string, TieInfo<TieMatchRow>>,
): ScoringUnit[] {
  const units: ScoringUnit[] = []
  const unitByMatch = new Map<string, ScoringUnit>()
  for (const m of matches) {
    const partnerId = ties.get(m.id)?.partner?.id
    let unit = partnerId ? unitByMatch.get(partnerId) : undefined
    if (!unit) {
      unit = { matches: [], predictions: 0 }
      units.push(unit)
    }
    unit.matches.push(m)
    unit.predictions += m.prediction_count
    unitByMatch.set(m.id, unit)
  }
  return units
}

/** Junta as unidades em gravações, na ordem, sem dividir nenhuma. */
function packWrites(units: ScoringUnit[]): ScoringUnit[] {
  const writes: ScoringUnit[] = []
  let current: ScoringUnit | undefined
  for (const unit of units) {
    if (
      !current ||
      current.predictions + unit.predictions > PREDICTIONS_PER_WRITE ||
      current.matches.length + unit.matches.length > MATCHES_PER_WRITE
    ) {
      current = { matches: [], predictions: 0 }
      writes.push(current)
    }
    current.matches.push(...unit.matches)
    current.predictions += unit.predictions
  }
  return writes
}

/**
 * Pontua os jogos de uma gravação. Lê os palpites, calcula os pontos e grava num
 * `batch` só, que é uma transação: os pontos, o `scored_at` de cada jogo e o
 * ranking dos grupos com palpite neles. O jogo fica marcado como pontuado junto
 * com os pontos e o ranking, ou nada muda.
 */
async function scoreWrite(
  db: D1Database,
  matches: UnscoredMatchRow[],
  ties: Map<string, TieInfo<TieMatchRow>>,
): Promise<void> {
  const toScore = new Map(matches.map((m) => [m.id, m]))
  const penaltyPhase = new Map(
    matches.map((m) => [m.id, matchGoesToPenalties(parsePenaltyPhases(m.penalty_phases), m.phase)]),
  )
  const leg1Ids = matches.flatMap((m) => {
    const tie = ties.get(m.id)
    return tie?.role === 'leg2' && tie.partner ? [tie.partner.id] : []
  })
  const predictions = await fetchPredictions(
    db,
    Array.from(new Set([...toScore.keys(), ...leg1Ids])),
  )
  const leg1PredByKey = new Map(
    predictions.map((p) => [`${p.match_id}:${p.group_id}:${p.user_id}`, p]),
  )

  const pointsByMatch = new Map<string, ScoredPoints[]>()
  const affectedGroups = new Set<string>()
  for (const p of predictions) {
    const matchCtx = toScore.get(p.match_id)
    if (!matchCtx) continue // palpite da ida, lido só para o classificado da volta

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
    const penaltyEligible =
      tie?.role === 'leg2' ? Boolean(p1) : penaltyPhase.get(p.match_id) && tie?.role !== 'leg1'
    const penaltyPoints = calculatePenaltyBonus(
      p.predicted_home_score + (p1?.predicted_away_score ?? 0),
      p.predicted_away_score + (p1?.predicted_home_score ?? 0),
      p.predicted_penalty_winner,
      matchCtx.penalty_winner,
      p.points_penalty,
      Boolean(penaltyEligible),
    )

    // 0 ou 1. A gravação multiplica pelo valor do grupo naquele momento.
    const classifiedPoints = evaluateClassifiedPointsForPrediction(
      matchCtx,
      { ...p, points_classified: 1 },
      tie,
      leg1PredByKey,
    )

    const scored = pointsByMatch.get(p.match_id) ?? []
    scored.push([p.id, points, penaltyPoints, classifiedPoints])
    pointsByMatch.set(p.match_id, scored)
    affectedGroups.add(p.group_id)
  }

  const updatePointsStmt = db.prepare(
    `UPDATE predictions SET points_awarded = json_extract(scored.value, '$[1]'),
       penalty_points = json_extract(scored.value, '$[2]'),
       classified_points = json_extract(scored.value, '$[3]')
         * (SELECT points_classified FROM groups WHERE id = predictions.group_id)
     FROM json_each(?) AS scored
     WHERE predictions.id = json_extract(scored.value, '$[0]') AND ${UNCHANGED_RESULT_SQL}
       AND EXISTS (SELECT 1 FROM groups g WHERE g.id = predictions.group_id AND ${ACTIVE_GROUP_SQL})`,
  )
  const markScoredStmt = db.prepare(
    `UPDATE matches SET scored_at = ? WHERE id = ? AND ${UNCHANGED_RESULT_SQL}`,
  )
  const now = new Date().toISOString()
  const statements: ReturnType<D1Database['prepare']>[] = []
  for (const m of matches) {
    const unchanged = unchangedResultBinds(m, ties.get(m.id))
    const scored = pointsByMatch.get(m.id) ?? []
    for (let i = 0; i < scored.length; i += PREDICTIONS_PER_STATEMENT) {
      const chunk = scored.slice(i, i + PREDICTIONS_PER_STATEMENT)
      statements.push(updatePointsStmt.bind(JSON.stringify(chunk), ...unchanged))
    }
    statements.push(markScoredStmt.bind(now, m.id, ...unchanged))
  }
  if (affectedGroups.size > 0) {
    statements.push(leaderboardRefreshStatement(db, Array.from(affectedGroups)))
  }
  await db.batch(statements)
}

/**
 * Pontua os jogos encerrados sem `scored_at` da competição, do mais antigo para o
 * mais novo. O progresso é por jogo. Cada gravação fecha os jogos dela, e jogo
 * com `scored_at` não é refeito. Chamar de novo é seguro. Execuções simultâneas,
 * nova tentativa depois de uma gravação que falhou e correção de placar no meio
 * terminam com os pontos e o ranking de uma execução só sobre o resultado mais
 * recente.
 *
 * `maxCalls` limita as chamadas ao D1 desta execução. Quando a próxima gravação
 * não cabe, a função para com `complete: false` e os jogos que faltam ficam para
 * a execução seguinte. Sem `maxCalls` não há limite.
 */
export async function scoreUnprocessedMatches(
  competitionId: string,
  db: D1Database,
  maxCalls = Infinity,
): Promise<ScoringOutcome> {
  if (maxCalls < MIN_SCORING_CALLS) return { scored: 0, complete: false }

  // 1. Jogos sem pontuação, com o contexto de pênaltis e quantos palpites cada um tem.
  const unscored = await db
    .prepare(
      `SELECT m.id, m.competition_id, m.home_team_id, m.away_team_id, m.start_time,
              m.home_score, m.away_score, m.penalty_winner, m.phase, m.leg, c.penalty_phases,
              (SELECT COUNT(*) FROM predictions p WHERE p.match_id = m.id) AS prediction_count
       FROM matches m
       JOIN competitions c ON c.id = m.competition_id
       WHERE m.competition_id = ?
         AND m.status = 'finished'
         AND m.scored_at IS NULL
         AND m.home_score IS NOT NULL
         AND m.away_score IS NOT NULL
       ORDER BY m.start_time, m.id`,
    )
    .bind(competitionId)
    .all<PlannedMatch>()

  if (unscored.results.length === 0) return { scored: 0, complete: true }

  // 2. Confrontos de mata-mata: cada jogo com o outro jogo do par, e a volta já
  // pontuada de uma ida que teve o placar corrigido. Jogo decisivo empatado sem o
  // vencedor dos pênaltis espera o provedor, sem scored_at.
  const tieMatches = await fetchTieMatches<TieMatchRow>(
    db,
    competitionId,
    unscored.results.map((m) => m.phase),
    TIE_MATCH_COLUMNS,
  )
  const ties = indexTies(tieMatches)
  const matchesToScore = [
    ...unscored.results,
    ...findLeg2ToRescore(unscored.results, ties),
  ].filter((m) => !awaitsPenaltyWinner(m, ties.get(m.id)))

  // 3. Uma gravação por vez, enquanto houver chamadas.
  let calls = PLAN_CALLS
  let scored = 0
  for (const write of packWrites(buildUnits(matchesToScore, ties))) {
    if (calls + WRITE_CALLS > maxCalls) return { scored, complete: false }
    await scoreWrite(db, write.matches, ties)
    calls += WRITE_CALLS
    scored += write.matches.length
  }
  return { scored, complete: true }
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
