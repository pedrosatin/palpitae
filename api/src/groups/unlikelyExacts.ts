import type { D1Database } from '@cloudflare/workers-types'

/** Máximo de palpiteiros distintos com o placar exato, em percentual (piso da auditoria 01). */
export const UNLIKELY_EXACT_MAX_PERCENT = 10

/** Mínimo de palpiteiros distintos no jogo para a estatística valer. */
export const UNLIKELY_EXACT_MIN_TIPSTERS = 10

/**
 * Mínimo de palpiteiros distintos que não são membros do grupo de quem lê.
 * Impede que o reconhecimento dependa do palpite de uma só pessoa desconhecida.
 */
export const UNLIKELY_EXACT_MIN_OUTSIDE_TIPSTERS = 10

/** Candidato a gravar: membro do grupo com placar exato raro na rodada. */
export interface UnlikelyExactCandidate {
  user_id: string
  match_id: string
  tipster_count: number
  exact_tipster_count: number
  outside_tipster_count: number
  home_score: number
  away_score: number
}

/** Linha já gravada em `unlikely_exacts` para a rodada de referência. */
export interface UnlikelyExactRow {
  user_id: string
  match_id: string
  tipster_count: number
  exact_tipster_count: number
  outside_tipster_count: number
  home_score: number
  away_score: number
}

/** Resumo por membro para a resposta de round-standings. */
export interface UnlikelyExactStanding {
  unlikely_exact: boolean
}

/** Jogo da rodada com agregado de raridade (ou ausente / desatualizado). */
export interface RoundMatchRarityRow {
  match_id: string
  home_score: number
  away_score: number
  scored_at: string
  tipster_count: number | null
  exact_count: number | null
  scored_at_snapshot: string | null
}

/** Agregado por jogo compartilhado entre grupos. */
export interface MatchScoreRarity {
  match_id: string
  tipster_count: number
  exact_count: number
  scored_at_snapshot: string
}

/**
 * Jogos da rodada de referência com o agregado `match_score_rarity` (LEFT JOIN).
 * A leitura do grupo usa só estas linhas (≤ jogos da rodada), sem varrer os
 * palpites da competição inteira.
 */
export const ROUND_MATCH_RARITY_SQL = `SELECT
  m.id AS match_id,
  m.home_score AS home_score,
  m.away_score AS away_score,
  m.scored_at AS scored_at,
  r.tipster_count AS tipster_count,
  r.exact_count AS exact_count,
  r.scored_at_snapshot AS scored_at_snapshot
FROM matches m
LEFT JOIN match_score_rarity r ON r.match_id = m.id
WHERE m.competition_id = (SELECT competition_id FROM groups WHERE id = ?)
  AND m.round = ?
  AND m.status = 'finished'
  AND m.scored_at IS NOT NULL
  AND m.home_score IS NOT NULL
  AND m.away_score IS NOT NULL`

/** Conta palpiteiros distintos e exatos de um jogo (grupos ativos). */
export const MATCH_SCORE_RARITY_COMPUTE_SQL = `SELECT
  COUNT(DISTINCT p.user_id) AS tipster_count,
  COUNT(DISTINCT CASE
    WHEN p.predicted_home_score = ? AND p.predicted_away_score = ?
    THEN p.user_id
  END) AS exact_count
FROM predictions p
JOIN groups pg ON pg.id = p.group_id AND pg.deleted_at IS NULL
WHERE p.match_id = ?`

/**
 * Upsert do agregado. `ON CONFLICT DO UPDATE` só aplica quando o snapshot
 * gravado difere do novo (outra pontuação do jogo).
 */
export const MATCH_SCORE_RARITY_UPSERT_SQL = `INSERT INTO match_score_rarity (
  match_id, tipster_count, exact_count, scored_at_snapshot, computed_at
) VALUES (?, ?, ?, ?, datetime('now'))
ON CONFLICT (match_id) DO UPDATE SET
  tipster_count = excluded.tipster_count,
  exact_count = excluded.exact_count,
  scored_at_snapshot = excluded.scored_at_snapshot,
  computed_at = excluded.computed_at
WHERE match_score_rarity.scored_at_snapshot != excluded.scored_at_snapshot`

/**
 * Membros deste grupo com placar exato pontuado nos jogos da rodada, cruzados
 * com o agregado já fresco. O filtro de raridade e o mínimo de tipsters fora
 * do grupo entram em TypeScript (`buildUnlikelyCandidates`).
 */
export const GROUP_EXACT_ON_ROUND_SQL = `SELECT
  p.user_id AS user_id,
  m.id AS match_id,
  m.home_score AS home_score,
  m.away_score AS away_score,
  r.tipster_count AS tipster_count,
  r.exact_count AS exact_tipster_count
FROM matches m
JOIN match_score_rarity r
  ON r.match_id = m.id AND r.scored_at_snapshot = m.scored_at
JOIN predictions p ON p.match_id = m.id AND p.group_id = ?
JOIN groups g ON g.id = p.group_id
WHERE m.competition_id = (SELECT competition_id FROM groups WHERE id = ?)
  AND m.round = ?
  AND m.status = 'finished'
  AND m.scored_at IS NOT NULL
  AND m.home_score IS NOT NULL
  AND m.away_score IS NOT NULL
  AND g.points_exact > g.points_winner
  AND p.predicted_home_score = m.home_score
  AND p.predicted_away_score = m.away_score
  AND p.points_awarded = g.points_exact`

/**
 * Palpiteiros distintos do jogo que também são membros deste grupo.
 * `outside = tipster_count - in_group` (o denominador da raridade já exclui
 * grupos apagados).
 */
export const IN_GROUP_TIPSTERS_ON_MATCH_SQL = `SELECT
  p.match_id AS match_id,
  COUNT(DISTINCT p.user_id) AS in_group_tipsters
FROM predictions p
JOIN groups pg ON pg.id = p.group_id AND pg.deleted_at IS NULL
JOIN group_members gm ON gm.group_id = ? AND gm.user_id = p.user_id
WHERE p.match_id IN (SELECT value FROM json_each(?))
GROUP BY p.match_id`

export const UNLIKELY_EXACTS_FOR_ROUND_SQL = `SELECT
  user_id, match_id, tipster_count, exact_tipster_count, outside_tipster_count,
  home_score, away_score
FROM unlikely_exacts
WHERE group_id = ? AND round = ?`

/** Verdadeiro quando há massa mínima e no máximo X% cravaram o placar. */
export function isUnlikelyExact(tipsterCount: number, exactTipsterCount: number): boolean {
  if (tipsterCount < UNLIKELY_EXACT_MIN_TIPSTERS) return false
  if (exactTipsterCount < 1) return false
  return exactTipsterCount * 100 <= tipsterCount * UNLIKELY_EXACT_MAX_PERCENT
}

/** Reconhecimento válido: raridade + mínimo de tipsters fora do grupo. */
export function qualifiesUnlikelyExact(
  tipsterCount: number,
  exactTipsterCount: number,
  outsideTipsterCount: number,
): boolean {
  if (outsideTipsterCount < UNLIKELY_EXACT_MIN_OUTSIDE_TIPSTERS) return false
  return isUnlikelyExact(tipsterCount, exactTipsterCount)
}

/** Agregado ausente ou com `scored_at` diferente do snapshot. */
export function needsRarityRecompute(row: RoundMatchRarityRow): boolean {
  if (row.scored_at_snapshot == null) return true
  return row.scored_at_snapshot !== row.scored_at
}

export function outsideTipsterCount(tipsterCount: number, inGroupTipsters: number): number {
  return Math.max(0, tipsterCount - Math.max(0, inGroupTipsters))
}

interface GroupExactHit {
  user_id: string
  match_id: string
  home_score: number
  away_score: number
  tipster_count: number
  exact_tipster_count: number
}

/** Monta candidatos a partir do agregado fresco e das contagens in-group. */
export function buildUnlikelyCandidates(
  hits: GroupExactHit[],
  inGroupByMatch: ReadonlyMap<string, number>,
): UnlikelyExactCandidate[] {
  const out: UnlikelyExactCandidate[] = []
  for (const hit of hits) {
    const inGroup = inGroupByMatch.get(hit.match_id) ?? 0
    const outside = outsideTipsterCount(hit.tipster_count, inGroup)
    if (!qualifiesUnlikelyExact(hit.tipster_count, hit.exact_tipster_count, outside)) continue
    out.push({
      user_id: hit.user_id,
      match_id: hit.match_id,
      tipster_count: hit.tipster_count,
      exact_tipster_count: hit.exact_tipster_count,
      outside_tipster_count: outside,
      home_score: hit.home_score,
      away_score: hit.away_score,
    })
  }
  return out
}

/** Resumo por usuário a partir das linhas gravadas da rodada. */
export function summarizeUnlikelyExacts(
  rows: UnlikelyExactRow[],
  userIds: Iterable<string>,
): Map<string, UnlikelyExactStanding> {
  const have = new Set(rows.map((row) => row.user_id))
  const map = new Map<string, UnlikelyExactStanding>()
  for (const userId of userIds) {
    map.set(userId, { unlikely_exact: have.has(userId) })
  }
  return map
}

function awardKey(userId: string, matchId: string): string {
  return `${userId}:${matchId}`
}

/** Candidatos ainda sem linha na rodada. */
export function pendingUnlikelyInserts(
  candidates: UnlikelyExactCandidate[],
  existing: UnlikelyExactRow[],
): UnlikelyExactCandidate[] {
  const have = new Set(existing.map((row) => awardKey(row.user_id, row.match_id)))
  return candidates.filter((row) => !have.has(awardKey(row.user_id, row.match_id)))
}

async function fetchUnlikelyExactsForRound(
  db: D1Database,
  groupId: string,
  referenceRound: string,
): Promise<UnlikelyExactRow[]> {
  const { results } = await db
    .prepare(UNLIKELY_EXACTS_FOR_ROUND_SQL)
    .bind(groupId, referenceRound)
    .all<UnlikelyExactRow>()
  return results
}

function insertStatements(
  db: D1Database,
  groupId: string,
  referenceRound: string,
  pending: UnlikelyExactCandidate[],
) {
  return pending.map((row) =>
    db
      .prepare(
        `INSERT INTO unlikely_exacts (
           group_id, user_id, match_id, round,
           tipster_count, exact_tipster_count, outside_tipster_count,
           home_score, away_score
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (group_id, user_id, match_id) DO NOTHING`,
      )
      .bind(
        groupId,
        row.user_id,
        row.match_id,
        referenceRound,
        row.tipster_count,
        row.exact_tipster_count,
        row.outside_tipster_count,
        row.home_score,
        row.away_score,
      ),
  )
}

/**
 * Calcula e grava o agregado de um jogo quando falta ou o `scored_at` mudou.
 * Um jogo por vez, para limitar o custo da primeira leitura da rodada.
 */
export async function ensureMatchScoreRarity(
  db: D1Database,
  row: RoundMatchRarityRow,
): Promise<MatchScoreRarity> {
  if (!needsRarityRecompute(row) && row.tipster_count != null && row.exact_count != null) {
    return {
      match_id: row.match_id,
      tipster_count: row.tipster_count,
      exact_count: row.exact_count,
      scored_at_snapshot: row.scored_at_snapshot!,
    }
  }

  const computed = await db
    .prepare(MATCH_SCORE_RARITY_COMPUTE_SQL)
    .bind(row.home_score, row.away_score, row.match_id)
    .first<{ tipster_count: number; exact_count: number }>()

  const tipsterCount = Number(computed?.tipster_count ?? 0)
  const exactCount = Number(computed?.exact_count ?? 0)

  await db
    .prepare(MATCH_SCORE_RARITY_UPSERT_SQL)
    .bind(row.match_id, tipsterCount, exactCount, row.scored_at)
    .run()

  return {
    match_id: row.match_id,
    tipster_count: tipsterCount,
    exact_count: exactCount,
    scored_at_snapshot: row.scored_at,
  }
}

/**
 * Garante agregados frescos para todos os jogos da rodada de referência do
 * grupo. Preferimos cálculo preguiçoso na leitura a calcular no fim da
 * pontuação (`scoring.ts`): o tick do poller já opera no orçamento de
 * subrequests da ADR-027, e o agregado é compartilhado por todos os grupos
 * depois da primeira abertura.
 */
export async function ensureRoundMatchRarities(
  db: D1Database,
  groupId: string,
  referenceRound: string,
): Promise<RoundMatchRarityRow[]> {
  const { results } = await db
    .prepare(ROUND_MATCH_RARITY_SQL)
    .bind(groupId, referenceRound)
    .all<RoundMatchRarityRow>()

  const rows = results
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (!needsRarityRecompute(row)) continue
    const fresh = await ensureMatchScoreRarity(db, row)
    rows[i] = {
      ...row,
      tipster_count: fresh.tipster_count,
      exact_count: fresh.exact_count,
      scored_at_snapshot: fresh.scored_at_snapshot,
    }
  }
  return rows
}

async function fetchGroupExactHits(
  db: D1Database,
  groupId: string,
  referenceRound: string,
): Promise<GroupExactHit[]> {
  const { results } = await db
    .prepare(GROUP_EXACT_ON_ROUND_SQL)
    .bind(groupId, groupId, referenceRound)
    .all<GroupExactHit>()
  return results
}

async function fetchInGroupTipstersByMatch(
  db: D1Database,
  groupId: string,
  matchIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (matchIds.length === 0) return map
  const { results } = await db
    .prepare(IN_GROUP_TIPSTERS_ON_MATCH_SQL)
    .bind(groupId, JSON.stringify(matchIds))
    .all<{ match_id: string; in_group_tipsters: number }>()
  for (const row of results) {
    map.set(row.match_id, Number(row.in_group_tipsters))
  }
  return map
}

/**
 * Descobre candidatos da rodada lendo só agregados da rodada e palpites do
 * próprio grupo (mais a contagem in-group por jogo).
 */
export async function findUnlikelyCandidates(
  db: D1Database,
  groupId: string,
  referenceRound: string,
): Promise<UnlikelyExactCandidate[]> {
  await ensureRoundMatchRarities(db, groupId, referenceRound)
  const hits = await fetchGroupExactHits(db, groupId, referenceRound)
  if (hits.length === 0) return []
  const matchIds = [...new Set(hits.map((h) => h.match_id))]
  const inGroup = await fetchInGroupTipstersByMatch(db, groupId, matchIds)
  return buildUnlikelyCandidates(hits, inGroup)
}

/**
 * Grava placares improváveis da rodada de referência e devolve o resumo.
 *
 * Falha de escrita não sobe: a resposta usa só o que já está confirmado no banco.
 */
export async function recordUnlikelyExacts(
  db: D1Database,
  groupId: string,
  referenceRound: string,
  candidates: UnlikelyExactCandidate[],
  existing: UnlikelyExactRow[],
  memberIds: Iterable<string>,
): Promise<Map<string, UnlikelyExactStanding>> {
  try {
    const pending = pendingUnlikelyInserts(candidates, existing)
    let rows = existing
    if (pending.length > 0) {
      await db.batch(insertStatements(db, groupId, referenceRound, pending))
      rows = await fetchUnlikelyExactsForRound(db, groupId, referenceRound)
    }
    return summarizeUnlikelyExacts(rows, memberIds)
  } catch (error) {
    console.error('[groups] Falha ao gravar unlikely_exacts do grupo %s:', groupId, error)
    try {
      const rows = await fetchUnlikelyExactsForRound(db, groupId, referenceRound)
      return summarizeUnlikelyExacts(rows, memberIds)
    } catch (readError) {
      console.error(
        '[groups] Falha ao reler unlikely_exacts do grupo %s após erro de gravação:',
        groupId,
        readError,
      )
      return summarizeUnlikelyExacts(existing, memberIds)
    }
  }
}

/**
 * Garante agregados, descobre candidatos, grava e resume. Usado por
 * `getRoundStandings` no lugar da varredura antiga de todos os palpites da
 * competição em cada leitura.
 */
export async function loadUnlikelyExactStandings(
  db: D1Database,
  groupId: string,
  referenceRound: string,
  existing: UnlikelyExactRow[],
  memberIds: Iterable<string>,
): Promise<Map<string, UnlikelyExactStanding>> {
  let candidates: UnlikelyExactCandidate[] = []
  try {
    candidates = await findUnlikelyCandidates(db, groupId, referenceRound)
  } catch (error) {
    console.error(
      '[groups] Falha ao calcular raridade do placar improvável do grupo %s:',
      groupId,
      error,
    )
  }
  return recordUnlikelyExacts(db, groupId, referenceRound, candidates, existing, memberIds)
}
