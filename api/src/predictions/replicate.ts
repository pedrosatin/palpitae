import type { Context } from 'hono'
import { hasPilotAccess } from '../auth/permissions'
import { competitionStatusSql } from '../groups/competitionStatus'
import { isMatchLocked, lockedSql, SQL_NOW } from '../matches/locking'
import { resolveTwoLegClassified } from '../matches/scoring'
import { matchGoesToPenalties, parsePenaltyPhases } from '../matches/penalties'
import { fetchTieMatches, indexTies, type TieInfo, type TieMatch } from '../matches/ties'
import { hashUserId, logEvent } from '../observability'
import type { AppContext } from '../types'
import { type Leg1ScorePair, resolvePenaltyPick } from './penaltyPick'

/** Grupos de destino e jogos por requisição. O lote de escrita cresce com o produto dos dois. */
const MAX_TARGET_GROUPS = 10
const MAX_MATCHES = 100
const BATCH_SIZE = 100

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
  /** Jogos que o grupo passou a ter com o placar do grupo de origem. */
  saved: number
  /** Jogos em que o grupo tinha um palpite diferente, agora substituído. */
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

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function stringList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || !value.every(isString)) return null
  const unique = Array.from(new Set(value))
  return unique.length > max ? null : unique
}

/** Grupos de que o usuário é membro (sem banimento) entre `groupIds`, numa única consulta. */
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

/** Palpites do usuário na origem. Sem `matchIds`, todos os que ele tem no grupo. */
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

/** Palpites que o usuário já tem nos grupos de destino para os jogos dados, numa única consulta. */
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

/** Confrontos de mata-mata dos jogos a copiar, indexados pelo id do jogo. */
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

/** Classificado que o palpite da origem prevê para a volta, ou null se ela não decide. */
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

type Plan = {
  statements: D1PreparedStatement[]
  /** Jogo de cada instrução de `statements`, na mesma ordem. */
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
  // O jogo é relido na própria escrita, com o relógio do banco. Se ele travou ou
  // começou depois das consultas, nada é gravado.
  // Com `onlyMissing`, o palpite salvo no destino depois das consultas também fica.
  const insert = db.prepare(
    `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, predicted_penalty_winner, created_at, updated_at)
     SELECT ?, ?, ?, m.id, ?, ?, ?, ?, ?
     FROM matches m
     WHERE m.id = ? AND NOT ${lockedSql('m', SQL_NOW)}
     ON CONFLICT (user_id, group_id, match_id) DO ${
       onlyMissing
         ? 'NOTHING'
         : `UPDATE SET
       predicted_home_score     = excluded.predicted_home_score,
       predicted_away_score     = excluded.predicted_away_score,
       predicted_penalty_winner = excluded.predicted_penalty_winner,
       updated_at               = excluded.updated_at`
     }`,
  )
  const allSourceByMatch = new Map(input.open.map((r) => [r.match_id, r]))
  const statements: D1PreparedStatement[] = []
  const statementMatches: string[] = []
  const results: ReplicateGroupResult[] = []

  for (const group of targets) {
    const result: ReplicateGroupResult = { group_id: group.id, saved: 0, replaced: 0 }
    // Com `onlyMissing`, o jogo que o grupo já palpitou sai da cópia, e a volta usa a ida dele.
    const open = onlyMissing
      ? input.open.filter((r) => !existing.has(`${group.id}:${r.match_id}`))
      : input.open
    const sourceByMatch = new Map(open.map((r) => [r.match_id, r]))
    for (const source of open) {
      const { home, away } = scoreFor(group, source)
      const tie = ties.get(source.match_id)
      const role = tie?.role ?? 'single'
      // A ida vem do que este grupo vai ter depois do lote, ou do palpite que ele já tem.
      let leg1Score: Leg1ScorePair | null = null
      if (role === 'leg2' && tie?.partner) {
        const leg1Source = sourceByMatch.get(tie.partner.id)
        if (leg1Source) {
          const leg1 = scoreFor(group, leg1Source)
          leg1Score = { homeScore: leg1.home, awayScore: leg1.away }
        } else {
          const stored = existing.get(`${group.id}:${tie.partner.id}`)
          if (stored) {
            leg1Score = {
              homeScore: stored.predicted_home_score,
              awayScore: stored.predicted_away_score,
            }
          }
        }
      }
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

      // Num destino "só vencedor" vale o resultado, não o placar gravado.
      const sameScore =
        current !== undefined &&
        (group.points_exact === 0
          ? sameOutcome(current, home, away)
          : current.predicted_home_score === home && current.predicted_away_score === away)
      const same = sameScore && current?.predicted_penalty_winner === penalty.value
      result.saved += 1
      if (same) continue
      if (current) result.replaced += 1
      statements.push(
        insert.bind(
          crypto.randomUUID(),
          userId,
          group.id,
          home,
          away,
          penalty.value,
          now,
          now,
          source.match_id,
        ),
      )
      statementMatches.push(source.match_id)
    }
    results.push(result)
  }
  return { statements, statementMatches, results }
}

export type CopyPlan = Plan & {
  /** Jogos da origem já travados, que não entram na cópia. */
  lockedMatches: string[]
  /** Jogos pedidos que a origem não palpitou. */
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
 *     lotes de `BATCH_SIZE`.
 *
 * Body: { source_group_id, target_group_ids: string[], match_ids: string[] }
 *
 * Response: {
 *   ok, groups: [{ group_id, saved, replaced }], skipped_groups: string[],
 *   locked_matches: string[], missing_matches: string[]
 * }
 *
 * Errors:
 *   400 corpo inválido; 403 usuário fora da origem ou de algum destino; 404 grupo piloto.
 */
export async function handleReplicatePost(c: Context<AppContext>) {
  const userId = c.get('userId')

  let body: Record<string, unknown>
  try {
    const parsed = await c.req.json<unknown>()
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return c.json({ error: 'Body JSON inválido' }, 400)
    }
    body = parsed as Record<string, unknown>
  } catch {
    return c.json({ error: 'Body JSON inválido' }, 400)
  }

  const sourceGroupId = body.source_group_id
  const targetIds = stringList(body.target_group_ids, MAX_TARGET_GROUPS)
  const matchIds = stringList(body.match_ids, MAX_MATCHES)
  if (!isString(sourceGroupId) || !targetIds || !matchIds || matchIds.length === 0) {
    return c.json(
      {
        error: `source_group_id, target_group_ids (até ${MAX_TARGET_GROUPS}) e match_ids (1 a ${MAX_MATCHES}) são obrigatórios`,
      },
      400,
    )
  }
  const targetGroupIds = targetIds.filter((id) => id !== sourceGroupId)
  if (targetGroupIds.length === 0) {
    return c.json({ error: 'target_group_ids deve ter ao menos um grupo diferente da origem' }, 400)
  }

  const db = c.env.DB
  const groups = await fetchMemberGroups(db, userId, [sourceGroupId, ...targetGroupIds])
  const sourceGroup = groups.get(sourceGroupId)
  if (!sourceGroup) return c.json({ error: 'Acesso negado ao grupo de origem' }, 403)
  if (sourceGroup.visibility === 'pilot' && !hasPilotAccess(c.get('userEmail'), c.env)) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }
  if (targetGroupIds.some((id) => !groups.has(id))) {
    return c.json({ error: 'Acesso negado ao grupo de destino' }, 403)
  }

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
    const chunks: D1PreparedStatement[][] = []
    for (let i = 0; i < plan.statements.length; i += BATCH_SIZE) {
      chunks.push(plan.statements.slice(i, i + BATCH_SIZE))
    }
    await Promise.all(chunks.map((chunk) => db.batch(chunk)))
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
