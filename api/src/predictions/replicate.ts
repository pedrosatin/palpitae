import type { Context } from 'hono'
import { hasPilotAccess } from '../auth/permissions'
import { isMatchLocked } from '../matches/locking'
import { matchGoesToPenalties, parsePenaltyPhases } from '../matches/penalties'
import { fetchTieMatches, indexTies, type TieInfo, type TieMatch } from '../matches/ties'
import { hashUserId, logEvent } from '../observability'
import type { AppContext } from '../types'
import { type Leg1ScorePair, resolvePenaltyPick } from './penaltyPick'

/** Grupos de destino e jogos por requisição. O lote de escrita cresce com o produto dos dois. */
const MAX_TARGET_GROUPS = 10
const MAX_MATCHES = 100
const BATCH_SIZE = 100

type GroupRow = {
  id: string
  competition_id: string
  points_exact: number
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
 * Placar gravado num grupo "só vencedor" (`points_exact = 0`): o resultado do
 * palpite vira 1x0, 0x0 ou 0x1, o mesmo que os botões de Casa, Empate e Fora gravam.
 */
export function outcomeScore(home: number, away: number): { home: number; away: number } {
  if (home > away) return { home: 1, away: 0 }
  if (home < away) return { home: 0, away: 1 }
  return { home: 0, away: 0 }
}

function scoreFor(group: GroupRow, source: SourceRow): { home: number; away: number } {
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
      `SELECT g.id, g.competition_id, g.points_exact, c.status AS competition_status, c.visibility
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
  matchIds: string[],
): Promise<SourceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.match_id, p.predicted_home_score, p.predicted_away_score, p.predicted_penalty_winner,
              m.start_time, m.status, m.postponed, m.locked_at, m.phase, c.penalty_phases
       FROM predictions p
       JOIN matches m ON m.id = p.match_id
       JOIN competitions c ON c.id = m.competition_id
       WHERE p.user_id = ? AND p.group_id = ? AND p.match_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(userId, groupId, JSON.stringify(matchIds))
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

type Plan = {
  statements: D1PreparedStatement[]
  results: ReplicateGroupResult[]
  invalidPenalty: number
}

function planWrites(input: {
  db: D1Database
  userId: string
  now: string
  targets: GroupRow[]
  open: SourceRow[]
  ties: Map<string, TieInfo<TieMatch>>
  existing: Map<string, ExistingRow>
}): Plan {
  const { db, userId, now, targets, open, ties, existing } = input
  const insert = db.prepare(
    `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, predicted_penalty_winner, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, group_id, match_id) DO UPDATE SET
       predicted_home_score     = excluded.predicted_home_score,
       predicted_away_score     = excluded.predicted_away_score,
       predicted_penalty_winner = excluded.predicted_penalty_winner,
       updated_at               = excluded.updated_at`,
  )
  const sourceByMatch = new Map(open.map((r) => [r.match_id, r]))
  const statements: D1PreparedStatement[] = []
  const results: ReplicateGroupResult[] = []
  let invalidPenalty = 0

  for (const group of targets) {
    const result: ReplicateGroupResult = { group_id: group.id, saved: 0, replaced: 0 }
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
      const penalty = resolvePenaltyPick({
        eligible: matchGoesToPenalties(parsePenaltyPhases(source.penalty_phases), source.phase),
        role,
        home,
        away,
        rawPenaltyWinner: source.predicted_penalty_winner,
        leg1Score,
      })
      if (!penalty.ok) {
        invalidPenalty += 1
        continue
      }

      const current = existing.get(`${group.id}:${source.match_id}`)
      const same =
        current !== undefined &&
        current.predicted_home_score === home &&
        current.predicted_away_score === away &&
        current.predicted_penalty_winner === penalty.value
      result.saved += 1
      if (same) continue
      if (current) result.replaced += 1
      statements.push(
        insert.bind(
          crypto.randomUUID(),
          userId,
          group.id,
          source.match_id,
          home,
          away,
          penalty.value,
          now,
          now,
        ),
      )
    }
    results.push(result)
  }
  return { statements, results, invalidPenalty }
}

/**
 * POST /predictions/replicate
 *
 * Aplica os palpites que o usuário já salvou num grupo aos outros grupos do mesmo
 * campeonato. O front chama depois de salvar, com a opção "Aplicar também em"
 * marcada. A origem é o palpite gravado em `source_group_id`, nunca um placar
 * enviado no corpo, então não há como gravar num grupo um placar que o usuário
 * não tem na origem.
 *
 * Regras:
 *   - o usuário precisa ser membro (sem banimento) da origem e de cada destino;
 *   - destino de outro campeonato ou de campeonato encerrado fica de fora;
 *   - jogo travado nunca é gravado (`isMatchLocked`) e vem em `locked_matches`;
 *   - um grupo "só vencedor" (`points_exact = 0`) recebe o resultado do placar;
 *   - o palpite que o destino já tinha é substituído e contado em `replaced`;
 *   - o custo no D1 não cresce com o número de grupos: uma consulta para os
 *     grupos, uma para a origem, uma para os palpites existentes e uma escrita em lote.
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
    body = await c.req.json<Record<string, unknown>>()
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
      group.competition_id === sourceGroup.competition_id && group.competition_status !== 'finished'
    if (usable) eligible.push(group)
    else skippedGroups.push(id)
  }

  const now = new Date().toISOString()
  const sourceRows = await fetchSourcePredictions(db, userId, sourceGroupId, matchIds)
  const found = new Set(sourceRows.map((r) => r.match_id))
  const missingMatches = matchIds.filter((id) => !found.has(id))
  const lockedMatches = sourceRows.filter((r) => isMatchLocked(r, now)).map((r) => r.match_id)
  const lockedSet = new Set(lockedMatches)
  const open = sourceRows.filter((r) => !lockedSet.has(r.match_id))

  let results: ReplicateGroupResult[] = eligible.map((g) => ({
    group_id: g.id,
    saved: 0,
    replaced: 0,
  }))
  if (eligible.length > 0 && open.length > 0) {
    const ties = await fetchTies(db, sourceGroup.competition_id, open)
    const lookupIds = new Set(open.map((r) => r.match_id))
    for (const r of open) {
      const partner = ties.get(r.match_id)?.partner
      if (ties.get(r.match_id)?.role === 'leg2' && partner) lookupIds.add(partner.id)
    }
    const existing = await fetchExisting(
      db,
      userId,
      eligible.map((g) => g.id),
      Array.from(lookupIds),
    )
    const plan = planWrites({ db, userId, now, targets: eligible, open, ties, existing })
    results = plan.results
    const chunks: D1PreparedStatement[][] = []
    for (let i = 0; i < plan.statements.length; i += BATCH_SIZE) {
      chunks.push(plan.statements.slice(i, i + BATCH_SIZE))
    }
    await Promise.all(chunks.map((chunk) => db.batch(chunk)))
    if (plan.statements.length > 0) {
      logEvent(c.env.AE, 'prediction_saved', {
        blobs: [
          sourceGroupId,
          '',
          await hashUserId(userId),
          'replicate',
          sourceGroup.competition_id,
        ],
        doubles: [plan.statements.length],
      })
    }
  }

  return c.json({
    ok: true,
    groups: results,
    skipped_groups: skippedGroups,
    locked_matches: lockedMatches,
    missing_matches: missingMatches,
  })
}
