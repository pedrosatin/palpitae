import type { D1Database } from '@cloudflare/workers-types'
import { isKnockoutPhase } from '../matches/rounds'
import { EXACT_HIT_SQL, PREDICTION_POINTS_SQL } from '../matches/scoring'
import { notBannedSql } from './ranking'

/** Membro com os totais do ranking e o que ele fez na rodada de referência. */
export interface RoundMemberRow {
  user_id: string
  joined_at: string
  total_points: number
  exact_hits: number
  /** Pontos só na rodada de referência, o que a coluna mostra. */
  round_points: number
  /** Placares exatos só na rodada de referência. */
  round_exact: number
  /** Pontos da rodada de referência e das rodadas numeradas posteriores. */
  since_points: number
  /** Exatos da rodada de referência e das rodadas numeradas posteriores. */
  since_exact: number
}

/** Limiares de placares exatos no grupo: 5, 15 e 30. */
export const EXACT_MILESTONES = [5, 15, 30] as const

export type ExactMilestone = (typeof EXACT_MILESTONES)[number]

export interface RoundStanding {
  user_id: string
  round_points: number
  /** Posição anterior menos a atual. Positivo é subiu. `null` quando ninguém tinha ponto antes. */
  position_change: number | null
  /** Rodadas encerradas seguidas, da referência para trás, com todos os jogos palpitados. */
  streak: number
  /** Placares exatos acumulados do membro no grupo (mesmo total do ranking). */
  exact_hits: number
  /** Maior marco de placares exatos atingido no grupo. `null` abaixo do primeiro limiar. */
  exact_milestone: ExactMilestone | null
  /** Marcos cuja linha em `exact_milestones` tem `round` igual à rodada de referência. */
  exact_milestones_crossed: ExactMilestone[]
}

export interface RoundStandingsResponse {
  round: string | null
  standings: RoundStanding[]
}

/** Linha gravada em `exact_milestones`. `round` nulo é backfill sem destaque. */
export interface ExactMilestoneRow {
  user_id: string
  threshold: number
  round: string | null
}

type Score = (row: RoundMemberRow) => number

/** Compara como o `ORDER BY` do SQLite. `localeCompare` daria outra ordem. */
function compareBinary(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** Ordem oficial do ranking, a mesma de `rankingOrderSql`. */
function ranked(rows: RoundMemberRow[], points: Score, exact: Score): RoundMemberRow[] {
  return [...rows].sort(
    (a, b) =>
      points(b) - points(a) ||
      exact(b) - exact(a) ||
      compareBinary(a.joined_at, b.joined_at) ||
      compareBinary(a.user_id, b.user_id),
  )
}

/** Maior limiar `<= exactHits`. `null` abaixo de 5. */
export function highestExactMilestone(exactHits: number): ExactMilestone | null {
  let highest: ExactMilestone | null = null
  for (const threshold of EXACT_MILESTONES) {
    if (exactHits >= threshold) highest = threshold
  }
  return highest
}

/** Limiares já alcançados pelo total de exatos. */
export function thresholdsReached(exactHits: number): ExactMilestone[] {
  return EXACT_MILESTONES.filter((threshold) => exactHits >= threshold)
}

/**
 * Limiares cruzados ao passar de `before` para `after` exatos.
 * Mantida para testes unitários do intervalo; a API grava e destaca por estado.
 */
export function exactMilestonesCrossed(before: number, after: number): ExactMilestone[] {
  return EXACT_MILESTONES.filter((threshold) => before < threshold && after >= threshold)
}

/** Marcos do membro cuja linha tem `round` igual à rodada de referência. */
export function crossedForReference(
  rows: ExactMilestoneRow[],
  userId: string,
  referenceRound: string,
): ExactMilestone[] {
  return EXACT_MILESTONES.filter((threshold) =>
    rows.some(
      (row) =>
        row.user_id === userId && row.threshold === threshold && row.round === referenceRound,
    ),
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
 *
 * O marco permanente usa o total de exatos do grupo. O destaque de cruzamento
 * vem das linhas de `exact_milestones` cuja `round` é a rodada de referência.
 */
export function computeRoundStandings(
  rows: RoundMemberRow[],
  streaks: ReadonlyMap<string, number>,
  crossedByUser: ReadonlyMap<string, ExactMilestone[]> = new Map(),
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
  ).map((row, index) => {
    return {
      user_id: row.user_id,
      round_points: row.round_points,
      position_change: hadPoints ? positionBefore.get(row.user_id)! - (index + 1) : null,
      streak: streaks.get(row.user_id) ?? 0,
      exact_hits: row.exact_hits,
      exact_milestone: highestExactMilestone(row.exact_hits),
      exact_milestones_crossed: crossedByUser.get(row.user_id) ?? [],
    }
  })
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

const ROUND_PHASES_SQL = `SELECT
         m.round,
         m.phase,
         SUM(m.status = 'finished' AND m.scored_at IS NOT NULL) AS finished,
         SUM((m.status <> 'finished' AND m.postponed = 0) OR (m.status = 'finished' AND m.scored_at IS NULL)) AS pending,
         MIN(m.start_time) AS first_start,
         MAX(CASE WHEN m.status = 'finished' AND m.scored_at IS NOT NULL THEN m.start_time END) AS last_scored
       FROM groups g
       JOIN matches m ON m.competition_id = g.competition_id
       WHERE g.id = ?
       GROUP BY m.round, m.phase`

const ROUND_MEMBERS_SQL = `SELECT
         gm.user_id,
         gm.joined_at,
         COALESCE(l.total_points, 0) AS total_points,
         COALESCE(l.exact_hits, 0) AS exact_hits,
         COALESCE(r.round_points, 0) AS round_points,
         COALESCE(r.round_exact, 0) AS round_exact,
         COALESCE(r.since_points, 0) AS since_points,
         COALESCE(r.since_exact, 0) AS since_exact
       FROM group_members gm
       INNER JOIN users u ON gm.user_id = u.id
       LEFT JOIN leaderboard l ON gm.group_id = l.group_id AND gm.user_id = l.user_id
       LEFT JOIN (
         SELECT
           p.user_id,
           SUM(CASE WHEN m.round = ? THEN ${PREDICTION_POINTS_SQL} ELSE 0 END) AS round_points,
           SUM(CASE WHEN m.round = ? THEN ${EXACT_HIT_SQL} ELSE 0 END) AS round_exact,
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
       WHERE gm.group_id = ? AND ${notBannedSql('gm')}`

const MEMBER_ROUND_PICKS_SQL = `SELECT p.user_id, m.round, COUNT(*) AS picks
       FROM predictions p
       JOIN groups g ON g.id = p.group_id
       JOIN matches m ON m.id = p.match_id AND m.competition_id = g.competition_id
       WHERE p.group_id = ?
         AND m.status = 'finished' AND m.scored_at IS NOT NULL
         AND m.round GLOB '[0-9]*' AND m.round NOT GLOB '*[^0-9]*'
       GROUP BY p.user_id, m.round`

/**
 * Agregados dos jogos da competição do grupo, por rodada e fase.
 *
 * `pending` conta jogo aberto e não adiado e jogo encerrado sem `scored_at`. O
 * segundo caso vale mesmo com `postponed = 1`: até o fallback da ESPN passar a
 * zerar a flag ao encerrar o jogo, ele gravava `finished` com `postponed = 1`.
 */
async function fetchRoundPhases(db: D1Database, groupId: string): Promise<RoundPhaseRow[]> {
  const { results } = await db.prepare(ROUND_PHASES_SQL).bind(groupId).all<RoundPhaseRow>()
  return results
}

/** Membros elegíveis com os totais e as somas da rodada e da rodada em diante. Sem palpite, 0. */
async function fetchRoundMembers(
  db: D1Database,
  groupId: string,
  round: string,
): Promise<RoundMemberRow[]> {
  const { results } = await db
    .prepare(ROUND_MEMBERS_SQL)
    .bind(round, round, groupId, round, groupId)
    .all<RoundMemberRow>()
  return results
}

/**
 * Lê fases, membros e palpites no mesmo `db.batch`, para as três consultas
 * verem o mesmo estado do D1. O `round` do bind vem de uma leitura prévia;
 * se a referência no lote divergir, a chamada refetcha os membros.
 */
async function fetchStandingsSnapshot(
  db: D1Database,
  groupId: string,
  round: string,
): Promise<{
  phases: RoundPhaseRow[]
  members: RoundMemberRow[]
  picks: MemberRoundPicks[]
  round: string | null
}> {
  const [phasesResult, membersResult, picksResult] = await db.batch([
    db.prepare(ROUND_PHASES_SQL).bind(groupId),
    db.prepare(ROUND_MEMBERS_SQL).bind(round, round, groupId, round, groupId),
    db.prepare(MEMBER_ROUND_PICKS_SQL).bind(groupId),
  ])
  const phases = (phasesResult.results ?? []) as RoundPhaseRow[]
  const syncedRound = pickReferenceRound(phases)
  if (syncedRound === null) {
    return { phases, members: [], picks: [], round: null }
  }
  if (syncedRound !== round) {
    const members = await fetchRoundMembers(db, groupId, syncedRound)
    const picks = (picksResult.results ?? []) as MemberRoundPicks[]
    return { phases, members, picks, round: syncedRound }
  }
  return {
    phases,
    members: (membersResult.results ?? []) as RoundMemberRow[],
    picks: (picksResult.results ?? []) as MemberRoundPicks[],
    round: syncedRound,
  }
}

async function fetchExactMilestones(db: D1Database, groupId: string): Promise<ExactMilestoneRow[]> {
  const { results } = await db
    .prepare(
      `SELECT user_id, threshold, round
       FROM exact_milestones
       WHERE group_id = ?`,
    )
    .bind(groupId)
    .all<ExactMilestoneRow>()
  return results
}

/**
 * Tenta marcar o grupo como inicializado. Só quem recebe `changes > 0` faz o
 * backfill com `round` nulo; quem perde segue o caminho de grupo já inicializado.
 */
async function tryAcquireExactMilestonesInit(db: D1Database, groupId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO exact_milestones_initialized (group_id) VALUES (?)
       ON CONFLICT (group_id) DO NOTHING`,
    )
    .bind(groupId)
    .run()
  return (result.meta?.changes ?? 0) > 0
}

async function releaseExactMilestonesInit(db: D1Database, groupId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM exact_milestones_initialized WHERE group_id = ?`)
    .bind(groupId)
    .run()
}

function milestoneKey(userId: string, threshold: number): string {
  return `${userId}:${threshold}`
}

function backfillStatements(db: D1Database, groupId: string, members: RoundMemberRow[]) {
  return backfillMilestoneInserts(members).map((row) =>
    db
      .prepare(
        `INSERT INTO exact_milestones (group_id, user_id, threshold, round)
         VALUES (?, ?, ?, NULL)
         ON CONFLICT (group_id, user_id, threshold) DO NOTHING`,
      )
      .bind(groupId, row.user_id, row.threshold),
  )
}

function newMilestoneStatements(
  db: D1Database,
  groupId: string,
  referenceRound: string,
  pending: { user_id: string; threshold: ExactMilestone }[],
) {
  return pending.map((row) =>
    db
      .prepare(
        `INSERT INTO exact_milestones (group_id, user_id, threshold, round)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (group_id, user_id, threshold) DO NOTHING`,
      )
      .bind(groupId, row.user_id, row.threshold, referenceRound),
  )
}

/** Linhas a gravar no backfill da primeira leitura: limiares já atingidos, sem destaque. */
export function backfillMilestoneInserts(
  members: RoundMemberRow[],
): { user_id: string; threshold: ExactMilestone }[] {
  const inserts: { user_id: string; threshold: ExactMilestone }[] = []
  for (const member of members) {
    for (const threshold of thresholdsReached(member.exact_hits)) {
      inserts.push({ user_id: member.user_id, threshold })
    }
  }
  return inserts
}

/** Limiares novos a gravar com a rodada de referência atual. */
export function newMilestoneInserts(
  members: RoundMemberRow[],
  existing: ExactMilestoneRow[],
): { user_id: string; threshold: ExactMilestone }[] {
  const have = new Set(existing.map((row) => milestoneKey(row.user_id, row.threshold)))
  const inserts: { user_id: string; threshold: ExactMilestone }[] = []
  for (const member of members) {
    for (const threshold of thresholdsReached(member.exact_hits)) {
      if (!have.has(milestoneKey(member.user_id, threshold))) {
        inserts.push({ user_id: member.user_id, threshold })
      }
    }
  }
  return inserts
}

function crossedMap(
  rows: ExactMilestoneRow[],
  members: RoundMemberRow[],
  referenceRound: string,
): Map<string, ExactMilestone[]> {
  const map = new Map<string, ExactMilestone[]>()
  for (const member of members) {
    map.set(member.user_id, crossedForReference(rows, member.user_id, referenceRound))
  }
  return map
}

/**
 * Grava marcos na primeira observação e devolve o mapa de destaque da rodada.
 *
 * Sem rodada de referência o chamador não entra aqui. A inicialização é
 * adquirida com `INSERT ... ON CONFLICT DO NOTHING` no marcador do grupo: só
 * quem recebe `changes > 0` faz o backfill com `round` nulo. Quem perde segue
 * o caminho de grupo já inicializado e grava limiares novos com a rodada de
 * referência. A chave primária com `ON CONFLICT DO NOTHING` evita duas
 * leituras concorrentes gravarem o mesmo marco com rodadas diferentes; a
 * releitura decide o que destacar. Falha de escrita no D1 é registrada e a
 * resposta usa só as linhas já confirmadas no banco.
 */
export async function recordExactMilestones(
  db: D1Database,
  groupId: string,
  referenceRound: string,
  members: RoundMemberRow[],
): Promise<Map<string, ExactMilestone[]>> {
  try {
    return await writeExactMilestones(db, groupId, referenceRound, members)
  } catch (error) {
    console.error('[groups] Falha ao gravar exact_milestones do grupo %s:', groupId, error)
    try {
      const existing = await fetchExactMilestones(db, groupId)
      return crossedMap(existing, members, referenceRound)
    } catch (readError) {
      console.error(
        '[groups] Falha ao reler exact_milestones do grupo %s após erro de gravação:',
        groupId,
        readError,
      )
      return crossedMap([], members, referenceRound)
    }
  }
}

async function writeExactMilestones(
  db: D1Database,
  groupId: string,
  referenceRound: string,
  members: RoundMemberRow[],
): Promise<Map<string, ExactMilestone[]>> {
  const acquired = await tryAcquireExactMilestonesInit(db, groupId)
  let existing = await fetchExactMilestones(db, groupId)

  if (acquired) {
    const statements = backfillStatements(db, groupId, members)
    if (statements.length > 0) {
      try {
        await db.batch(statements)
      } catch (error) {
        try {
          await releaseExactMilestonesInit(db, groupId)
        } catch (releaseError) {
          console.error(
            '[groups] Falha ao liberar exact_milestones_initialized do grupo %s:',
            groupId,
            releaseError,
          )
        }
        throw error
      }
      existing = await fetchExactMilestones(db, groupId)
    }
    return crossedMap(existing, members, referenceRound)
  }

  const pending = newMilestoneInserts(members, existing)
  if (pending.length > 0) {
    await db.batch(newMilestoneStatements(db, groupId, referenceRound, pending))
    existing = await fetchExactMilestones(db, groupId)
  }

  return crossedMap(existing, members, referenceRound)
}

export async function getRoundStandings(
  db: D1Database,
  groupId: string,
): Promise<RoundStandingsResponse> {
  const preliminary = await fetchRoundPhases(db, groupId)
  const preliminaryRound = pickReferenceRound(preliminary)
  if (preliminaryRound === null) return { round: null, standings: [] }

  const snapshot = await fetchStandingsSnapshot(db, groupId, preliminaryRound)
  if (snapshot.round === null) return { round: null, standings: [] }

  const crossedByUser = await recordExactMilestones(
    db,
    groupId,
    snapshot.round,
    snapshot.members,
  )
  return {
    round: snapshot.round,
    standings: computeRoundStandings(
      snapshot.members,
      computeStreaks(snapshot.phases, snapshot.picks),
      crossedByUser,
    ),
  }
}
