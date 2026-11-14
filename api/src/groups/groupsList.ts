import { openRoundsSql, roundRuleBinds } from '../matches/defaultRound'
import { roundAgreement, roundLabel, type RoundAgreement } from '../matches/rounds'
import { competitionStatusSql } from './competitionStatus'
import { pendingSummaryBinds, pendingSummarySql } from './pendingPredictions'
import { notBannedSql, userPositionSql } from './ranking'

/**
 * Consulta de `GET /groups`. Traz os grupos do usuário com os números do card e
 * o resumo dos jogos abertos para o painel. Uma CTE separa as competições
 * distintas do usuário para calcular o status da competição e as rodadas
 * abertas uma vez por competição, em vez de repetir por grupo. A consulta
 * principal lê `user_groups` e junta `competition_info` pela competição.
 * Membros, posição e pendências continuam calculados por grupo.
 * Os jogos ao vivo vêm de outra consulta em `liveMatches.ts`, que roda em
 * paralelo. O teste de plano em `groupsList.queryPlan.test.ts` protege as
 * leituras de jogos das duas.
 *
 * Sem acesso a pilotos, os grupos de competição piloto ficam de fora. Banido com
 * linha residual em `group_members` não vê o grupo nem entra em `member_count`.
 */
export function groupsListSql(canSeePilot: boolean): string {
  const pilotFilter = canSeePilot ? '' : "AND (c.visibility IS NULL OR c.visibility != 'pilot')"
  return `
        WITH user_groups AS MATERIALIZED (
          SELECT
            g.id,
            g.name,
            g.competition_id,
            c.name AS competition_name,
            c.type AS competition_type,
            c.external_id AS competition_code,
            c.penalty_phases,
            c.status AS raw_competition_status,
            c.provider AS competition_provider,
            g.owner_user_id AS admin_id,
            g.points_exact,
            g.invite_code,
            g.created_at,
            gm.user_id,
            COALESCE(l.total_points, 0) AS user_points
          FROM groups g
          INNER JOIN group_members gm ON g.id = gm.group_id AND gm.user_id = ?
          LEFT JOIN competitions c ON g.competition_id = c.id
          LEFT JOIN leaderboard l ON g.id = l.group_id AND l.user_id = ?
          WHERE g.deleted_at IS NULL AND ${notBannedSql('gm')}
            ${pilotFilter}
        ),
        user_competitions AS (
          SELECT DISTINCT
            competition_id,
            competition_type AS type,
            competition_provider AS provider,
            raw_competition_status AS status
          FROM user_groups
        ),
        competition_info AS MATERIALIZED (
          SELECT
            uc.competition_id,
            ${competitionStatusSql('uc', 'uc', 'uc.competition_id')} AS competition_status,
            (
              SELECT json_group_array(json_object('round', orr.round, 'position', orr.position))
              FROM (${openRoundsSql('uc.competition_id', 'mr')}) orr
            ) AS open_rounds_json
          FROM user_competitions uc
        )
        SELECT
          g.id,
          g.name,
          g.competition_id,
          g.competition_name,
          g.competition_type,
          g.competition_code,
          g.penalty_phases,
          ci.competition_status,
          g.admin_id,
          g.points_exact,
          g.invite_code,
          g.created_at,
          (
            SELECT COUNT(*)
            FROM group_members gm2
            WHERE gm2.group_id = g.id AND ${notBannedSql('gm2')}
          ) AS member_count,
          g.user_points,
          ${userPositionSql('g.id', 'g.user_id')} AS user_position,
          ${pendingSummarySql('g', 'g', 'ci.open_rounds_json')} AS pending_summary
        FROM user_groups g
        LEFT JOIN competition_info ci ON ci.competition_id = g.competition_id
        ORDER BY g.created_at DESC, g.id DESC
        `
}

/** Binds na ordem exigida por `groupsListSql`. */
export function groupsListBinds(nowIso: string, userId: string): string[] {
  return [
    userId,
    userId,
    ...roundRuleBinds(nowIso),
    ...pendingSummaryBinds(nowIso, userId),
  ]
}

/** Jogo sem palpite que fecha primeiro no grupo, como o painel mostra. */
export type DeadlineMatch = {
  match_id: string
  start_time: string
  round: string
  round_label: string
  /** Concordância de `round_label`; null quando a rodada é desconhecida e o rótulo vem cru. */
  round_agreement: RoundAgreement | null
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
      round_agreement: roundAgreement(round),
      home_team: row.home_team,
      away_team: row.away_team,
    })
  }
  return byId
}
