import type { D1Database } from '@cloudflare/workers-types'
import { isKnockoutPhase } from '../matches/rounds'
import { EXACT_HIT_SQL, PREDICTION_POINTS_SQL } from '../matches/scoring'

/** Membro com os totais do ranking e o que ele fez na rodada de referência. */
export interface RoundMemberRow {
  user_id: string
  joined_at: string
  total_points: number
  exact_hits: number
  /** Pontos só na rodada de referência, o que a coluna mostra. */
  round_points: number
  /** Pontos da rodada de referência e das rodadas numeradas posteriores. */
  since_points: number
  /** Exatos da rodada de referência e das rodadas numeradas posteriores. */
  since_exact: number
}

export interface RoundStanding {
  user_id: string
  round_points: number
  /** Posição anterior menos a atual. Positivo é subiu. `null` quando ninguém tinha ponto antes. */
  position_change: number | null
  /** Rodadas encerradas seguidas, da referência para trás, com todos os jogos palpitados. */
  streak: number
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
 * ranking, que já tem os jogos pontuados da rodada em andamento.
 *
 * A posição anterior aplica a mesma ordem aos totais sem a rodada de referência
 * e sem as rodadas numeradas posteriores. Descontar só a referência compararia
 * com um estado que nunca existiu. Jogo remarcado de rodada anterior conta como
 * ponto de antes. Membro fora de `streaks` tem sequência 0.
 */
export function computeRoundStandings(
  rows: RoundMemberRow[],
  streaks: ReadonlyMap<string, number>,
): RoundStanding[] {
  const pointsBefore: Score = (row) => row.total_points - row.since_points
  const exactBefore: Score = (row) => row.exact_hits - row.since_exact
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
    streak: streaks.get(row.user_id) ?? 0,
  }))
}

/** Agregado dos jogos da competição numa combinação de rodada e fase. */
export interface RoundPhaseRow {
  round: string | null
  phase: string | null
  finished: number
  pending: number
  first_start: string
  last_scored: string | null
}

interface NumberedRound {
  round: string
  finished: number
  pending: number
  firstStart: string
}

/** Soma as linhas de cada rodada numerada. Uma rodada pode ter mais de uma fase. */
function numberedRounds(rows: RoundPhaseRow[]): NumberedRound[] {
  const byRound = new Map<string, NumberedRound>()
  for (const row of rows) {
    if (row.round === null || !/^\d+$/.test(row.round)) continue
    const seen = byRound.get(row.round)
    byRound.set(row.round, {
      round: row.round,
      finished: (seen?.finished ?? 0) + row.finished,
      pending: (seen?.pending ?? 0) + row.pending,
      firstStart: seen && seen.firstStart < row.first_start ? seen.firstStart : row.first_start,
    })
  }
  return [...byRound.values()]
}

/** Rodadas numeradas com jogo pontuado e nada pendente, da maior para a menor. */
function closedRounds(rows: RoundPhaseRow[]): NumberedRound[] {
  return numberedRounds(rows)
    .filter((round) => round.finished > 0 && round.pending === 0)
    .sort((a, b) => Number(b.round) - Number(a.round))
}

/**
 * Rodada de referência do grupo (ADR-021), ou `null` quando o mata-mata já começou.
 *
 * A referência é a rodada numerada de maior número com jogo pontuado e nada
 * pendente. Só essa é avaliada. Se uma fase eliminatória tem jogo pontuado depois
 * do início dela, a resposta é `null`, sem tentar uma rodada menor. Fase não
 * eliminatória nunca bloqueia, seja qual for o `round`.
 */
export function pickReferenceRound(rows: RoundPhaseRow[]): string | null {
  const reference = closedRounds(rows)[0]
  if (!reference) return null

  const knockoutStarted = rows.some(
    (row) =>
      isKnockoutPhase(row.phase) &&
      row.last_scored !== null &&
      row.last_scored > reference.firstStart,
  )
  return knockoutStarted ? null : reference.round
}

/** Palpites de um membro nos jogos encerrados e pontuados de uma rodada numerada. */
export interface MemberRoundPicks {
  user_id: string
  round: string
  picks: number
}

/**
 * Sequência de rodadas palpitadas de cada membro com palpite (ADR-021).
 *
 * Percorre as rodadas encerradas da maior para a menor, e a maior é a referência.
 * Rodada aberta fica fora da lista, então não conta e não quebra a sequência. A
 * sequência para na primeira rodada com menos palpites que jogos pontuados.
 */
export function computeStreaks(
  phases: RoundPhaseRow[],
  picks: MemberRoundPicks[],
): Map<string, number> {
  const rounds = closedRounds(phases)
  const picksByUser = new Map<string, Map<string, number>>()
  for (const row of picks) {
    const byRound = picksByUser.get(row.user_id) ?? new Map<string, number>()
    picksByUser.set(row.user_id, byRound.set(row.round, row.picks))
  }

  const streaks = new Map<string, number>()
  for (const [userId, byRound] of picksByUser) {
    const firstMissing = rounds.findIndex(
      (round) => (byRound.get(round.round) ?? 0) < round.finished,
    )
    streaks.set(userId, firstMissing === -1 ? rounds.length : firstMissing)
  }
  return streaks
}

/**
 * Agregados dos jogos da competição do grupo, por rodada e fase.
 *
 * `pending` conta jogo aberto e não adiado e jogo encerrado sem `scored_at`. O
 * segundo caso vale mesmo com `postponed = 1`, porque a football-data grava
 * `SUSPENDED` com essa flag e o fallback da ESPN encerra o jogo sem mexer nela.
 */
async function fetchRoundPhases(db: D1Database, groupId: string): Promise<RoundPhaseRow[]> {
  const { results } = await db
    .prepare(
      `SELECT
         m.round,
         m.phase,
         SUM(m.status = 'finished' AND m.scored_at IS NOT NULL) AS finished,
         SUM((m.status <> 'finished' AND m.postponed = 0) OR (m.status = 'finished' AND m.scored_at IS NULL)) AS pending,
         MIN(m.start_time) AS first_start,
         MAX(CASE WHEN m.status = 'finished' AND m.scored_at IS NOT NULL THEN m.start_time END) AS last_scored
       FROM groups g
       JOIN matches m ON m.competition_id = g.competition_id
       WHERE g.id = ?
       GROUP BY m.round, m.phase`,
    )
    .bind(groupId)
    .all<RoundPhaseRow>()
  return results
}

/** Membros atuais com os totais e as somas da rodada e da rodada em diante. Sem palpite, 0. */
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
         COALESCE(r.since_points, 0) AS since_points,
         COALESCE(r.since_exact, 0) AS since_exact
       FROM group_members gm
       INNER JOIN users u ON gm.user_id = u.id
       LEFT JOIN leaderboard l ON gm.group_id = l.group_id AND gm.user_id = l.user_id
       LEFT JOIN (
         SELECT
           p.user_id,
           SUM(CASE WHEN m.round = ? THEN ${PREDICTION_POINTS_SQL} ELSE 0 END) AS round_points,
           SUM(${PREDICTION_POINTS_SQL}) AS since_points,
           SUM(${EXACT_HIT_SQL}) AS since_exact
         FROM predictions p
         JOIN groups g ON g.id = p.group_id
         JOIN matches m ON m.id = p.match_id AND m.competition_id = g.competition_id
         WHERE p.group_id = ?
           AND m.round GLOB '[0-9]*' AND m.round NOT GLOB '*[^0-9]*'
           AND CAST(m.round AS INTEGER) >= CAST(? AS INTEGER)
         GROUP BY p.user_id
       ) r ON gm.user_id = r.user_id
       WHERE gm.group_id = ?`,
    )
    .bind(round, groupId, round, groupId)
    .all<RoundMemberRow>()
  return results
}

/**
 * Palpites do grupo nos jogos encerrados e pontuados, por membro e rodada numerada.
 * Palpite em jogo adiado fica de fora, para não cobrir a falta de outro jogo da rodada.
 */
async function fetchMemberRoundPicks(db: D1Database, groupId: string): Promise<MemberRoundPicks[]> {
  const { results } = await db
    .prepare(
      `SELECT p.user_id, m.round, COUNT(*) AS picks
       FROM predictions p
       JOIN groups g ON g.id = p.group_id
       JOIN matches m ON m.id = p.match_id AND m.competition_id = g.competition_id
       WHERE p.group_id = ?
         AND m.status = 'finished' AND m.scored_at IS NOT NULL
         AND m.round GLOB '[0-9]*' AND m.round NOT GLOB '*[^0-9]*'
       GROUP BY p.user_id, m.round`,
    )
    .bind(groupId)
    .all<MemberRoundPicks>()
  return results
}

export async function getRoundStandings(
  db: D1Database,
  groupId: string,
): Promise<RoundStandingsResponse> {
  const phases = await fetchRoundPhases(db, groupId)
  const round = pickReferenceRound(phases)
  if (round === null) return { round: null, standings: [] }
  const [members, picks] = await Promise.all([
    fetchRoundMembers(db, groupId, round),
    fetchMemberRoundPicks(db, groupId),
  ])
  return { round, standings: computeRoundStandings(members, computeStreaks(phases, picks)) }
}
