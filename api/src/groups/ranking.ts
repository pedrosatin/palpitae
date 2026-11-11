/**
 * Regras do ranking de um grupo, usadas pela lista de membros, pela posição do
 * usuário, pelo pódio do card e pelo recálculo do `leaderboard`.
 */

/**
 * Participante elegível: tem linha em `group_members` e não está em `group_bans`.
 * `alias` aponta uma tabela com `group_id` e `user_id`.
 */
export function notBannedSql(alias: string): string {
  return `NOT EXISTS (SELECT 1 FROM group_bans b WHERE b.group_id = ${alias}.group_id AND b.user_id = ${alias}.user_id)`
}

/**
 * Ordem do ranking: pontos, placares exatos, entrada mais antiga no grupo e, por
 * último, o id do usuário. No empate total (mesmos pontos e exatos) vale a ordem
 * de entrada. Quem não tem linha no `leaderboard` entra com 0 ponto e 0 exato.
 *
 * `member` é o alias de `group_members` e `board` o do `leaderboard`, que pode
 * vir de `LEFT JOIN`.
 */
export function rankingOrderSql(member = 'gm', board = 'l'): string {
  return `COALESCE(${board}.total_points, 0) DESC, COALESCE(${board}.exact_hits, 0) DESC, ${member}.joined_at ASC, ${member}.user_id ASC`
}

/**
 * Posição de um usuário no ranking do grupo, como subquery escalar. Numera os
 * participantes elegíveis na ordem de `rankingOrderSql`, a mesma numeração da
 * lista de membros. Devolve NULL para quem não tem linha no `leaderboard`: sem
 * apuração não há posição a mostrar. A linha de quem saiu fica no banco e não
 * conta, porque a consulta parte de `group_members`.
 *
 * `groupExpr` e `userExpr` vêm da consulta de fora e não podem usar os aliases
 * `rm` e `rl`.
 */
export function userPositionSql(groupExpr: string, userExpr: string): string {
  return `(
    SELECT position FROM (
      SELECT rm.user_id, rl.user_id AS scored_user_id,
        ROW_NUMBER() OVER (ORDER BY ${rankingOrderSql('rm', 'rl')}) AS position
      FROM group_members rm
      LEFT JOIN leaderboard rl ON rl.group_id = rm.group_id AND rl.user_id = rm.user_id
      WHERE rm.group_id = ${groupExpr} AND ${notBannedSql('rm')}
    )
    WHERE user_id = ${userExpr} AND scored_user_id IS NOT NULL
  )`
}
