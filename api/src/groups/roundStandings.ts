import type { D1Database } from '@cloudflare/workers-types'
import { EXACT_HIT_SQL, PREDICTION_POINTS_SQL } from '../matches/scoring'

/** Membro com os totais do ranking e o que ele fez na rodada de referência. */
export interface RoundMemberRow {
  user_id: string
  joined_at: string
  total_points: number
  exact_hits: number
  round_points: number
  round_exact: number
}

export interface RoundStanding {
  user_id: string
  round_points: number
  /** Posição anterior menos a atual. Positivo é subiu. `null` quando ninguém tinha ponto antes. */
  position_change: number | null
}

export interface RoundStandingsResponse {
  round: string | null
  standings: RoundStanding[]
}

type Score = (row: RoundMemberRow) => number

/** Compara como o `ORDER BY` do SQLite. `localeCompare` daria outra ordem. */
function compareBinary(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** Ordem oficial do ranking, a mesma de `GET /groups/:id/members`. */
function ranked(rows: RoundMemberRow[], points: Score, exact: Score): RoundMemberRow[] {
  return [...rows].sort(
    (a, b) =>
      points(b) - points(a) ||
      exact(b) - exact(a) ||
      compareBinary(a.joined_at, b.joined_at) ||
      compareBinary(a.user_id, b.user_id),
  )
}

/**
 * Pontos de cada membro na rodada e a variação de posição, na ordem atual do
 * ranking. A posição anterior aplica a mesma ordem aos totais sem a rodada.
 */
export function computeRoundStandings(rows: RoundMemberRow[]): RoundStanding[] {
  const pointsBefore: Score = (row) => row.total_points - row.round_points
  const exactBefore: Score = (row) => row.exact_hits - row.round_exact
  const positionBefore = new Map(
    ranked(rows, pointsBefore, exactBefore).map((row, index) => [row.user_id, index + 1]),
  )
  const hadPoints = rows.some((row) => pointsBefore(row) > 0)

  return ranked(
    rows,
    (row) => row.total_points,
    (row) => row.exact_hits,
  ).map((row, index) => ({
    user_id: row.user_id,
    round_points: row.round_points,
    position_change: hadPoints ? positionBefore.get(row.user_id)! - (index + 1) : null,
  }))
}

/**
 * Rodada de referência do grupo (ADR-021), a encerrada de maior número.
 *
 * A rodada só encerra depois de pontuada. Jogo `finished` sem `scored_at` ainda
 * não deu pontos aos palpites e mantém a rodada pendente.
 *
 * Rodada numerada deixa de ser candidata quando uma rodada não numerada tem jogo
 * encerrado depois do último jogo encerrado dela. É o que tira a coluna quando o
 * mata-mata começa. Fase preliminar anterior às rodadas e jogo solto com `round`
 * `REGULAR_SEASON` ou `NULL` anterior à rodada não bloqueiam.
 *
 * `numbered` usa `COALESCE` porque `matches.round` aceita `NULL`, e `GLOB` com
 * `NULL` deixaria a rodada fora das duas contagens.
 */
async function findReferenceRound(db: D1Database, groupId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `WITH rounds AS (
         SELECT
           m.round,
           COALESCE(m.round, '') GLOB '[0-9]*' AND COALESCE(m.round, '') NOT GLOB '*[^0-9]*' AS numbered,
           SUM(m.status = 'finished' AND m.scored_at IS NOT NULL) AS finished,
           SUM((m.status <> 'finished' OR m.scored_at IS NULL) AND m.postponed = 0) AS pending,
           MAX(CASE WHEN m.status = 'finished' THEN m.start_time END) AS last_finished
         FROM groups g
         JOIN matches m ON m.competition_id = g.competition_id
         WHERE g.id = ?
         GROUP BY m.round
       )
       SELECT r.round
       FROM rounds r
       WHERE r.numbered = 1 AND r.finished > 0 AND r.pending = 0
         AND NOT EXISTS (
           SELECT 1 FROM rounds o WHERE o.numbered = 0 AND o.last_finished > r.last_finished
         )
       ORDER BY CAST(r.round AS INTEGER) DESC
       LIMIT 1`,
    )
    .bind(groupId)
    .first<{ round: string }>()
  return row?.round ?? null
}

/** Membros atuais com os totais e a soma da rodada. Sem palpite na rodada, a soma é 0. */
async function fetchRoundMembers(
  db: D1Database,
  groupId: string,
  round: string,
): Promise<RoundMemberRow[]> {
  const { results } = await db
    .prepare(
      `SELECT
         gm.user_id,
         gm.joined_at,
         COALESCE(l.total_points, 0) AS total_points,
         COALESCE(l.exact_hits, 0) AS exact_hits,
         COALESCE(r.round_points, 0) AS round_points,
         COALESCE(r.round_exact, 0) AS round_exact
       FROM group_members gm
       INNER JOIN users u ON gm.user_id = u.id
       LEFT JOIN leaderboard l ON gm.group_id = l.group_id AND gm.user_id = l.user_id
       LEFT JOIN (
         SELECT
           p.user_id,
           SUM(${PREDICTION_POINTS_SQL}) AS round_points,
           SUM(${EXACT_HIT_SQL}) AS round_exact
         FROM predictions p
         JOIN groups g ON g.id = p.group_id
         JOIN matches m ON m.id = p.match_id AND m.competition_id = g.competition_id
         WHERE p.group_id = ? AND m.round = ?
         GROUP BY p.user_id
       ) r ON gm.user_id = r.user_id
       WHERE gm.group_id = ?`,
    )
    .bind(groupId, round, groupId)
    .all<RoundMemberRow>()
  return results
}

export async function getRoundStandings(
  db: D1Database,
  groupId: string,
): Promise<RoundStandingsResponse> {
  const round = await findReferenceRound(db, groupId)
  if (round === null) return { round: null, standings: [] }
  return { round, standings: computeRoundStandings(await fetchRoundMembers(db, groupId, round)) }
}
