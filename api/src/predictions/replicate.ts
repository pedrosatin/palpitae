import type { Context } from 'hono'
import { hasPilotAccess } from '../auth/permissions'
import { runInBatches } from '../d1Batch'
import { competitionStatusSql } from '../groups/competitionStatus'
import { validateJson } from '../http/validateJson'
import { isMatchLocked } from '../matches/locking'
import { resolveTwoLegClassified } from '../matches/scoring'
import { matchGoesToPenalties, parsePenaltyPhases } from '../matches/penalties'
import { fetchTieMatches, indexTies, type TieInfo, type TieMatch } from '../matches/ties'
import { hashUserId, logEvent } from '../observability'
import { enforceDailyWriteBudget } from '../security/limits'
import type { AppContext } from '../types'
import { guardedUpsertParams, prepareGuardedUpsert } from './guardedUpsert'
import { type Leg1ScorePair, resolvePenaltyPick } from './penaltyPick'
import {
  mapReplicatePredictionError,
  REPLICATE_MAX_MATCHES,
  REPLICATE_MAX_TARGETS,
  type ReplicatePredictionBody,
  replicatePredictionSchema,
} from './writeSchemas'

/** Grupos de destino e jogos por requisição. O lote de escrita cresce com o produto dos dois. */
export const MAX_BATCH_STATEMENTS = REPLICATE_MAX_TARGETS * REPLICATE_MAX_MATCHES

/** O que a cópia de palpites precisa saber de um grupo. */
export type CopyGroup = {
  id: string
  competition_id: string
  points_exact: number
}

type GroupRow = CopyGroup & {
  competition_status: string
  visibility: string | null
}

type SourceRow = {
  match_id: string
  predicted_home_score: number
  predicted_away_score: number
  predicted_penalty_winner: 'home' | 'away' | null
  start_time: string
  status: string
  postponed: number
  locked_at: string | null
  phase: string | null
  penalty_phases: string
}

type ExistingRow = {
  group_id: string
  match_id: string
  predicted_home_score: number
  predicted_away_score: number
  predicted_penalty_winner: 'home' | 'away' | null
}

export type ReplicateGroupResult = {
  group_id: string
  saved: number
  replaced: number
}

/**
 * Num grupo "só vencedor" (`points_exact = 0`), o resultado do palpite vira 1x0,
 * 0x0 ou 0x1, os placares dos botões Casa, Empate e Fora.
 */
export function outcomeScore(home: number, away: number): { home: number; away: number } {
  if (home > away) return { home: 1, away: 0 }
  if (home < away) return { home: 0, away: 1 }
  return { home: 0, away: 0 }
}

/**
 * Origem "só vencedor" não grava em destino que pontua o placar exato. O botão
 * grava 1x0 e apagaria um placar que o destino pode ter palpitado.
 */
export function acceptsFrom(source: CopyGroup, target: CopyGroup): boolean {
  return source.points_exact > 0 || target.points_exact === 0
}

function scoreFor(group: CopyGroup, source: SourceRow): { home: number; away: number } {
  const home = source.predicted_home_score
  const away = source.predicted_away_score
  return group.points_exact === 0 ? outcomeScore(home, away) : { home, away }
}

async function fetchMemberGroups(
  db: D1Database,
  userId: string,
  groupIds: string[],
): Promise<Map<string, GroupRow>> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.competition_id, g.points_exact, ${competitionStatusSql('g', 'c')} AS competition_status, c.visibility
       FROM groups g
       JOIN competitions c ON c.id = g.competition_id
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
       WHERE g.deleted_at IS NULL
         AND g.id IN (SELECT value FROM json_each(?))
         AND NOT EXISTS (SELECT 1 FROM group_bans b WHERE b.group_id = g.id AND b.user_id = gm.user_id)`,
    )
    .bind(userId, JSON.stringify(groupIds))
    .all<GroupRow>()
  return new Map(results.map((g) => [g.id, g]))
}

async function fetchSourcePredictions(
  db: D1Database,
  userId: string,
  groupId: string,
  matchIds: string[] | null,
): Promise<SourceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.match_id, p.predicted_home_score, p.predicted_away_score, p.predicted_penalty_winner,
              m.start_time, m.status, m.postponed, m.locked_at, m.phase, c.penalty_phases
       FROM predictions p
       JOIN matches m ON m.id = p.match_id
       JOIN competitions c ON c.id = m.competition_id
       WHERE p.user_id = ? AND p.group_id = ?${
         matchIds ? ' AND p.match_id IN (SELECT value FROM json_each(?))' : ''
       }`,
    )
    .bind(userId, groupId, ...(matchIds ? [JSON.stringify(matchIds)] : []))
    .all<SourceRow>()
  return results
}

async function fetchExisting(
  db: D1Database,
  userId: string,
  groupIds: string[],
  matchIds: string[],
): Promise<Map<string, ExistingRow>> {
  const { results } = await db
    .prepare(
      `SELECT group_id, match_id, predicted_home_score, predicted_away_score, predicted_penalty_winner
       FROM predictions
       WHERE user_id = ?
         AND group_id IN (SELECT value FROM json_each(?))
         AND match_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(userId, JSON.stringify(groupIds), JSON.stringify(matchIds))
    .all<ExistingRow>()
  return new Map(results.map((r) => [`${r.group_id}:${r.match_id}`, r]))
}

async function fetchTies(
  db: D1Database,
  competitionId: string,
  rows: SourceRow[],
): Promise<Map<string, TieInfo<TieMatch>>> {
  return indexTies(await fetchTieMatches(db, competitionId, new Set(rows.map((r) => r.phase))))
}

function sameOutcome(current: ExistingRow, home: number, away: number): boolean {
  return (
    Math.sign(current.predicted_home_score - current.predicted_away_score) ===
    Math.sign(home - away)
  )
}

function derivedClassified(
  sourceGroupId: string,
  source: SourceRow,
  tie: TieInfo<TieMatch> | undefined,
  sourceByMatch: Map<string, SourceRow>,
  existing: Map<string, ExistingRow>,
): 'home' | 'away' | null {
  if (!tie?.partner) return null
  const leg1 =
    sourceByMatch.get(tie.partner.id) ?? existing.get(`${sourceGroupId}:${tie.partner.id}`)
  if (!leg1) return null
  return resolveTwoLegClassified(
    { homeScore: leg1.predicted_home_score, awayScore: leg1.predicted_away_score },
    {
      homeScore: source.predicted_home_score,
      awayScore: source.predicted_away_score,
      penaltyWinner: null,
    },
  )
}

/**
 * Palpite da ida para a volta: o que este grupo vai ter depois do lote ou, sem a
 * ida na cópia, o que ele já tem. Fora da volta devolve null.
 */
function leg1ScoreFor(
  group: CopyGroup,
  tie: TieInfo<TieMatch> | undefined,
  sourceByMatch: Map<string, SourceRow>,
  existing: Map<string, ExistingRow>,
): Leg1ScorePair | null {
  if (tie?.role !== 'leg2' || !tie.partner) return null
  const leg1Source = sourceByMatch.get(tie.partner.id)
  if (leg1Source) {
    const leg1 = scoreFor(group, leg1Source)
    return { homeScore: leg1.home, awayScore: leg1.away }
  }
  const stored = existing.get(`${group.id}:${tie.partner.id}`)
  if (!stored) return null
  return { homeScore: stored.predicted_home_score, awayScore: stored.predicted_away_score }
}

/**
 * O destino já tem o palpite que a cópia gravaria. Num destino "só vencedor" vale
 * o resultado, não o placar gravado.
 */
function isSamePrediction(
  group: CopyGroup,
  current: ExistingRow | undefined,
  pick: { home: number; away: number; penaltyWinner: 'home' | 'away' | null },
): boolean {
  if (!current || current.predicted_penalty_winner !== pick.penaltyWinner) return false
  if (group.points_exact === 0) return sameOutcome(current, pick.home, pick.away)
  return current.predicted_home_score === pick.home && current.predicted_away_score === pick.away
}

type Plan = {
  statements: D1PreparedStatement[]
  statementMatches: string[]
  results: ReplicateGroupResult[]
}

function planWrites(input: {
  db: D1Database
  userId: string
  sourceGroupId: string
  now: string
  targets: CopyGroup[]
  open: SourceRow[]
  ties: Map<string, TieInfo<TieMatch>>
  existing: Map<string, ExistingRow>
  onlyMissing: boolean
}): Plan {
  const { db, userId, sourceGroupId, now, targets, ties, existing, onlyMissing } = input
  const insert = prepareGuardedUpsert(db, { onlyMissing })
  const allSourceByMatch = new Map(input.open.map((r) => [r.match_id, r]))
  const statements: D1PreparedStatement[] = []
  const statementMatches: string[] = []
  const results: ReplicateGroupResult[] = []

  for (const group of targets) {
    const result: ReplicateGroupResult = { group_id: group.id, saved: 0, replaced: 0 }
    const open = onlyMissing
      ? input.open.filter((r) => !existing.has(`${group.id}:${r.match_id}`))
      : input.open
    const sourceByMatch = new Map(open.map((r) => [r.match_id, r]))
    for (const source of open) {
      const { home, away } = scoreFor(group, source)
      const tie = ties.get(source.match_id)
      const role = tie?.role ?? 'single'
      const leg1Score = leg1ScoreFor(group, tie, sourceByMatch, existing)
      const current = existing.get(`${group.id}:${source.match_id}`)
      let rawPenaltyWinner = source.predicted_penalty_winner
      const tiedHere =
        leg1Score !== null && home + leg1Score.awayScore === away + leg1Score.homeScore
      if (role === 'leg2' && tiedHere && !rawPenaltyWinner) {
        // A origem não empata o agregado e guarda null. Vale o pick que o destino já tinha,
        // senão o classificado que a origem previu.
        rawPenaltyWinner =
          current?.predicted_penalty_winner ??
          derivedClassified(sourceGroupId, source, tie, allSourceByMatch, existing)
      }
      const penalty = resolvePenaltyPick({
        eligible: matchGoesToPenalties(parsePenaltyPhases(source.penalty_phases), source.phase),
        role,
        home,
        away,
        rawPenaltyWinner,
        leg1Score,
      })
      if (!penalty.ok) continue

      result.saved += 1
      if (isSamePrediction(group, current, { home, away, penaltyWinner: penalty.value })) continue
      if (current) result.replaced += 1
      statements.push(
        insert.bind(
          ...guardedUpsertParams({
            userId,
            groupId: group.id,
            matchId: source.match_id,
            home,
            away,
            penaltyWinner: penalty.value,
            now,
          }),
        ),
      )
      statementMatches.push(source.match_id)
    }
    results.push(result)
  }
  return { statements, statementMatches, results }
}

export type CopyPlan = Plan & {
  lockedMatches: string[]
  missingMatches: string[]
}

/**
 * Lê os palpites da origem e monta as escritas nos destinos, com as regras de
 * `POST /predictions/replicate`. Quem chama decide os destinos e executa `statements`.
 * Sem `matchIds`, copia todos os palpites da origem. Com `onlyMissing`, só preenche
 * os jogos que o destino ainda não palpitou.
 */
export async function planCopy(
  db: D1Database,
  input: {
    userId: string
    source: CopyGroup
    targets: CopyGroup[]
    matchIds: string[] | null
    onlyMissing: boolean
    now: string
  },
): Promise<CopyPlan> {
  const { userId, source, targets, matchIds, onlyMissing, now } = input
  const sourceRows = await fetchSourcePredictions(db, userId, source.id, matchIds)
  const found = new Set(sourceRows.map((r) => r.match_id))
  const missingMatches = (matchIds ?? []).filter((id) => !found.has(id))
  const lockedMatches = sourceRows.filter((r) => isMatchLocked(r, now)).map((r) => r.match_id)
  const lockedSet = new Set(lockedMatches)
  const open = sourceRows.filter((r) => !lockedSet.has(r.match_id))
  const empty = targets.map((g) => ({ group_id: g.id, saved: 0, replaced: 0 }))
  if (targets.length === 0 || open.length === 0) {
    return { statements: [], statementMatches: [], results: empty, lockedMatches, missingMatches }
  }

  const ties = await fetchTies(db, source.competition_id, open)
  const lookupIds = new Set(open.map((r) => r.match_id))
  for (const r of open) {
    const partner = ties.get(r.match_id)?.partner
    if (ties.get(r.match_id)?.role === 'leg2' && partner) lookupIds.add(partner.id)
  }
  const existing = await fetchExisting(
    db,
    userId,
    [source.id, ...targets.map((g) => g.id)],
    Array.from(lookupIds),
  )
  const plan = planWrites({
    db,
    userId,
    sourceGroupId: source.id,
    now,
    targets,
    open,
    ties,
    existing,
    onlyMissing,
  })
  return { ...plan, lockedMatches, missingMatches }
}

export const replicateJsonValidator = validateJson(
  replicatePredictionSchema,
  mapReplicatePredictionError,
)

function partitionTargets(
  sourceGroup: GroupRow,
  targetGroupIds: string[],
  groups: Map<string, GroupRow>,
): { eligible: GroupRow[]; skippedGroups: string[] } {
  const eligible: GroupRow[] = []
  const skippedGroups: string[] = []
  for (const id of targetGroupIds) {
    const group = groups.get(id) as GroupRow
    const usable =
      group.competition_id === sourceGroup.competition_id &&
      group.competition_status !== 'finished' &&
      acceptsFrom(sourceGroup, group)
    if (usable) eligible.push(group)
    else skippedGroups.push(id)
  }
  return { eligible, skippedGroups }
}

/**
 * POST /predictions/replicate
 *
 * Aplica os palpites que o usuário já salvou num grupo aos outros grupos do mesmo
 * campeonato. O front chama depois de salvar, com a opção "Aplicar também em"
 * marcada. O placar vem do palpite gravado em `source_group_id`. O corpo traz só os ids.
 *
 * Regras:
 *   - o usuário precisa ser membro (sem banimento) da origem e de cada destino;
 *   - destino de outro campeonato ou de campeonato encerrado fica de fora;
 *   - origem "só vencedor" não grava em destino que pontua placar exato, que fica de fora;
 *   - jogo travado nunca é gravado (`isMatchLocked`) e vem em `locked_matches`;
 *   - um destino "só vencedor" (`points_exact = 0`) recebe o resultado do placar;
 *   - o palpite que o destino já tinha é substituído e contado em `replaced`;
 *   - o número de SELECTs não cresce com o número de grupos, e as escritas saem em
 *     lotes de 100 (`runInBatches`).
 *
 * Body: { source_group_id, target_group_ids: string[], match_ids: string[] }
 *
 * Response: {
 *   ok, groups: [{ group_id, saved, replaced }], skipped_groups: string[],
 *   locked_matches: string[], missing_matches: string[]
 * }
 *
 * Errors:
 *   400 corpo inválido; 403 usuário fora da origem ou de algum destino; 404 grupo piloto;
 *   429 orçamento diário de escrita excedido.
 */
export async function handleReplicatePost(
  c: Context<AppContext, string, { out: { json: ReplicatePredictionBody } }>,
) {
  const userId = c.get('userId')
  const body = c.req.valid('json')
  const sourceGroupId = body.source_group_id
  const targetGroupIds = body.target_group_ids
  const matchIds = body.match_ids

  const db = c.env.DB
  const groups = await fetchMemberGroups(db, userId, [sourceGroupId, ...targetGroupIds])
  const sourceGroup = groups.get(sourceGroupId)
  if (!sourceGroup) return c.json({ error: 'Acesso negado ao grupo de origem' }, 403)
  if (sourceGroup.visibility === 'pilot' && !hasPilotAccess(c.get('userIdentity'), c.env)) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }
  if (targetGroupIds.some((id) => !groups.has(id))) {
    return c.json({ error: 'Acesso negado ao grupo de destino' }, 403)
  }

  const { eligible, skippedGroups } = partitionTargets(sourceGroup, targetGroupIds, groups)

  const now = new Date().toISOString()
  const plan = await planCopy(db, {
    userId,
    source: sourceGroup,
    targets: eligible,
    matchIds,
    onlyMissing: false,
    now,
  })
  const { results, lockedMatches, missingMatches } = plan
  if (plan.statements.length > 0) {
    const budgetError = await enforceDailyWriteBudget(c, plan.statements.length)
    if (budgetError) return budgetError
    await runInBatches(db, plan.statements)
    logEvent(c.env.AE, 'prediction_saved', {
      blobs: [sourceGroupId, '', await hashUserId(userId), 'replicate', sourceGroup.competition_id],
      doubles: [plan.statements.length],
    })
  }

  return c.json({
    ok: true,
    groups: results,
    skipped_groups: skippedGroups,
    locked_matches: lockedMatches,
    missing_matches: missingMatches,
  })
}
