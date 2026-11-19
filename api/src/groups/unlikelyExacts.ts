import type { D1Database } from '@cloudflare/workers-types'

/** Máximo de palpiteiros distintos com o placar exato, em percentual (piso da auditoria 01). */
export const UNLIKELY_EXACT_MAX_PERCENT = 10

/** Mínimo de palpiteiros distintos no jogo para a estatística valer. */
export const UNLIKELY_EXACT_MIN_TIPSTERS = 10

/** Candidato a gravar: membro do grupo com placar exato raro na rodada. */
export interface UnlikelyExactCandidate {
  user_id: string
  match_id: string
  tipster_count: number
  exact_tipster_count: number
  home_score: number
  away_score: number
}

/** Linha já gravada em `unlikely_exacts` para a rodada de referência. */
export interface UnlikelyExactRow {
  user_id: string
  match_id: string
  tipster_count: number
  exact_tipster_count: number
  percent_rounded: number
  home_score: number
  away_score: number
}

/** Resumo por membro para a resposta de round-standings. */
export interface UnlikelyExactStanding {
  unlikely_exact: boolean
  /** Menor percentual arredondado entre os placares raros da rodada. */
  unlikely_exact_percent: number | null
}

/**
 * Agrega palpiteiros distintos por jogo da rodada na competição do grupo.
 * Cada usuário conta uma vez, mesmo com palpites em vários grupos. Grupos
 * apagados ficam de fora. A raridade usa o placar previsto contra o oficial,
 * sem `points_awarded` (regras de grupo diferem). Só entra membro deste grupo
 * com placar exato pontuado (`points_exact > points_winner`).
 */
export const UNLIKELY_EXACT_CANDIDATES_SQL = `WITH round_matches AS (
  SELECT m.id AS match_id, m.home_score AS home_score, m.away_score AS away_score
  FROM matches m
  WHERE m.competition_id = (SELECT competition_id FROM groups WHERE id = ?)
    AND m.round = ?
    AND m.status = 'finished'
    AND m.scored_at IS NOT NULL
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL
),
match_pool AS (
  SELECT
    rm.match_id AS match_id,
    rm.home_score AS home_score,
    rm.away_score AS away_score,
    COUNT(DISTINCT p.user_id) AS tipster_count,
    COUNT(DISTINCT CASE
      WHEN p.predicted_home_score = rm.home_score
       AND p.predicted_away_score = rm.away_score
      THEN p.user_id
    END) AS exact_tipster_count
  FROM round_matches rm
  JOIN predictions p ON p.match_id = rm.match_id
  JOIN groups pg ON pg.id = p.group_id AND pg.deleted_at IS NULL
  GROUP BY rm.match_id
  HAVING COUNT(DISTINCT p.user_id) >= ${UNLIKELY_EXACT_MIN_TIPSTERS}
     AND COUNT(DISTINCT CASE
           WHEN p.predicted_home_score = rm.home_score
            AND p.predicted_away_score = rm.away_score
           THEN p.user_id
         END) >= 1
     AND COUNT(DISTINCT CASE
           WHEN p.predicted_home_score = rm.home_score
            AND p.predicted_away_score = rm.away_score
           THEN p.user_id
         END) * 100
         <= COUNT(DISTINCT p.user_id) * ${UNLIKELY_EXACT_MAX_PERCENT}
)
SELECT
  p.user_id AS user_id,
  mp.match_id AS match_id,
  mp.tipster_count AS tipster_count,
  mp.exact_tipster_count AS exact_tipster_count,
  mp.home_score AS home_score,
  mp.away_score AS away_score
FROM match_pool mp
JOIN predictions p ON p.match_id = mp.match_id AND p.group_id = ?
JOIN groups g ON g.id = p.group_id
WHERE g.points_exact > g.points_winner
  AND p.predicted_home_score = mp.home_score
  AND p.predicted_away_score = mp.away_score
  AND p.points_awarded = g.points_exact`

export const UNLIKELY_EXACTS_FOR_ROUND_SQL = `SELECT
  user_id, match_id, tipster_count, exact_tipster_count,
  percent_rounded, home_score, away_score
FROM unlikely_exacts
WHERE group_id = ? AND round = ?`

/** Verdadeiro quando há massa mínima e no máximo X% cravaram o placar. */
export function isUnlikelyExact(tipsterCount: number, exactTipsterCount: number): boolean {
  if (tipsterCount < UNLIKELY_EXACT_MIN_TIPSTERS) return false
  if (exactTipsterCount < 1) return false
  return exactTipsterCount * 100 <= tipsterCount * UNLIKELY_EXACT_MAX_PERCENT
}

/**
 * Percentual inteiro para a UI. Arredonda e nunca mostra 0% quando há acerto,
 * para não sugerir contagem vazia.
 */
export function roundUnlikelyPercent(tipsterCount: number, exactTipsterCount: number): number {
  if (tipsterCount <= 0 || exactTipsterCount <= 0) return 1
  return Math.min(
    UNLIKELY_EXACT_MAX_PERCENT,
    Math.max(1, Math.round((exactTipsterCount * 100) / tipsterCount)),
  )
}

/** Resumo por usuário a partir das linhas gravadas da rodada. */
export function summarizeUnlikelyExacts(
  rows: UnlikelyExactRow[],
  userIds: Iterable<string>,
): Map<string, UnlikelyExactStanding> {
  const byUser = new Map<string, number>()
  for (const row of rows) {
    const current = byUser.get(row.user_id)
    if (current === undefined || row.percent_rounded < current) {
      byUser.set(row.user_id, row.percent_rounded)
    }
  }
  const map = new Map<string, UnlikelyExactStanding>()
  for (const userId of userIds) {
    const percent = byUser.get(userId)
    map.set(userId, {
      unlikely_exact: percent !== undefined,
      unlikely_exact_percent: percent ?? null,
    })
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
           tipster_count, exact_tipster_count, percent_rounded,
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
        roundUnlikelyPercent(row.tipster_count, row.exact_tipster_count),
        row.home_score,
        row.away_score,
      ),
  )
}

/**
 * Grava placares improváveis da rodada de referência e devolve o resumo.
 *
 * Os candidatos e as linhas já gravadas vêm do mesmo `db.batch` do chamador
 * quando possível. Falha de escrita não sobe: a resposta usa só o que já está
 * confirmado no banco.
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
