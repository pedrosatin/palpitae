import { roundLabel } from '../matches/rounds'
import { competitionStatusSql } from './competitionStatus'
import { pendingSummaryBinds, pendingSummarySql } from './pendingPredictions'

/**
 * Consulta de `GET /groups`. Traz os grupos do usuário com os números do card e
 * o resumo dos jogos abertos para o painel, que `pendingSummarySql` calcula numa
 * subquery por grupo. Os jogos ao vivo vêm de outra consulta, em
 * `liveMatches.ts`, que roda em paralelo. O teste de plano em
 * `groupsList.queryPlan.test.ts` protege as leituras de jogos das duas.
 *
 * Sem acesso a pilotos, os grupos de competição piloto ficam de fora.
 */
export function groupsListSql(canSeePilot: boolean): string {
  const pilotFilter = canSeePilot ? '' : "AND (c.visibility IS NULL OR c.visibility != 'pilot')"
  return `
        SELECT
          g.id,
          g.name,
          g.competition_id,
          c.name AS competition_name,
          c.type AS competition_type,
          c.external_id AS competition_code,
          ${competitionStatusSql('g', 'c')} AS competition_status,
          g.owner_user_id AS admin_id,
          g.invite_code,
          g.created_at,
          (
            SELECT COUNT(*)
            FROM group_members gm2
            WHERE gm2.group_id = g.id
          ) AS member_count,
          COALESCE(l.total_points, 0) AS user_points,
          COALESCE(
            (
              SELECT COUNT(*) + 1
              FROM leaderboard l2
              WHERE l2.group_id = g.id
                AND l2.total_points > COALESCE(l.total_points, 0)
            ),
            1
          ) AS user_position,
          ${pendingSummarySql('g')} AS pending_summary
        FROM groups g
        INNER JOIN group_members gm ON g.id = gm.group_id AND gm.user_id = ?
        LEFT JOIN competitions c ON g.competition_id = c.id
        LEFT JOIN leaderboard l ON g.id = l.group_id AND l.user_id = ?
        WHERE g.deleted_at IS NULL
          ${pilotFilter}
        GROUP BY g.id
        ORDER BY g.created_at DESC
        `
}

/** Binds na ordem exigida por `groupsListSql`. */
export function groupsListBinds(nowIso: string, userId: string): string[] {
  return [...pendingSummaryBinds(nowIso, userId), userId, userId]
}

/** Jogo sem palpite que fecha primeiro no grupo, como o painel mostra. */
export type DeadlineMatch = {
  match_id: string
  start_time: string
  round: string
  round_label: string
  home_team: string
  away_team: string
}

/** Rodada e times de `count` jogos, buscados pela chave primária. */
export function deadlineMatchesSql(count: number): string {
  return `SELECT m.id, m.round, ht.name AS home_team, at.name AS away_team
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE m.id IN (${Array<string>(count).fill('?').join(', ')})`
}

/**
 * Rodada e times dos jogos de prazo dos grupos, numa consulta só. Vários grupos
 * do mesmo campeonato costumam apontar o mesmo jogo.
 */
export async function fetchDeadlineMatches(
  db: D1Database,
  matchIds: string[],
): Promise<Map<string, Omit<DeadlineMatch, 'start_time'>>> {
  const byId = new Map<string, Omit<DeadlineMatch, 'start_time'>>()
  const ids = [...new Set(matchIds)]
  if (ids.length === 0) return byId

  const rows = await db
    .prepare(deadlineMatchesSql(ids.length))
    .bind(...ids)
    .all<{ id: string; round: string | null; home_team: string; away_team: string }>()

  for (const row of rows.results) {
    const round = row.round ?? ''
    byId.set(row.id, {
      match_id: row.id,
      round,
      round_label: roundLabel(round),
      home_team: row.home_team,
      away_team: row.away_team,
    })
  }
  return byId
}
