import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { isAdminUser } from '../auth/permissions'
import { notBannedSql } from '../groups/ranking'
import { KNOCKOUT_PHASES } from '../matches/rounds'
import { leaderboardRebuildStatements } from '../matches/scoring'
import type { AppContext } from '../types'

/**
 * Procedimentos do operador que apagam dados: exclusão de conta a pedido do titular
 * e remoção de jogo duplicado. Roteiro de uso em `docs/operations/exclusao-conta-jogo.md`.
 *
 * Acesso: só o admin (ver `auth/permissions.ts`). Sem `ADMIN_EMAIL`, tudo responde 403.
 */
export const adminRouter = new Hono<AppContext>()

adminRouter.use('*', requireAuth)

adminRouter.use('*', async (c, next) => {
  if (!isAdminUser(c.get('userIdentity'), c.env)) {
    return c.json({ error: 'Apenas o administrador pode executar esta ação' }, 403)
  }
  await next()
})

/**
 * Candidato a dono do grupo `groups.id` quando a conta `?` sai: o membro ativo de
 * entrada mais antiga, sem contar banidos nem a própria conta. No empate de
 * `joined_at`, vence o menor `user_id`, o mesmo desempate do ranking (ADR-026).
 */
const NEXT_OWNER_SQL = `SELECT gm.user_id FROM group_members gm
  WHERE gm.group_id = groups.id AND gm.user_id <> ?1 AND ${notBannedSql('gm')}
  ORDER BY gm.joined_at, gm.user_id LIMIT 1`

/**
 * DELETE /admin/users/:id
 *
 * Exclui a conta e tudo o que é só dela, numa transação. Cada grupo de que a conta
 * é dona, inclusive os já excluídos, passa ao membro ativo mais antigo. Grupo sem
 * outro membro ativo é apagado, com os palpites e o ranking dele. Depois a conta sai, e as
 * chaves estrangeiras apagam perfil, participações, palpites, ranking, banimentos,
 * palpites de chave e reservas de lembrete. A sessão da conta deixa de valer na
 * próxima requisição, porque a validação exige a conta no banco.
 *
 * Response: { ok, transferred_groups: [{ group_id, new_owner_user_id }], deleted_groups: [id] }
 */
adminRouter.delete('/users/:id', async (c) => {
  const userId = c.req.param('id')
  const db = c.env.DB

  if (userId === c.get('userId')) {
    return c.json({ error: 'O admin não pode excluir a própria conta por esta rota' }, 400)
  }

  const user = await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()
  if (!user) return c.json({ error: 'Conta não encontrada' }, 404)

  const [transferred, deleted] = await db.batch<{ id: string; owner_user_id?: string }>([
    db
      .prepare(
        `UPDATE groups SET owner_user_id = (${NEXT_OWNER_SQL})
          WHERE owner_user_id = ?1 AND (${NEXT_OWNER_SQL}) IS NOT NULL
          RETURNING id, owner_user_id`,
      )
      .bind(userId),
    db.prepare('DELETE FROM groups WHERE owner_user_id = ? RETURNING id').bind(userId),
    // `payments` não tem cascata para `users` e segue sem uso; sai junto para não travar a exclusão.
    db.prepare('DELETE FROM payments WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ])

  return c.json({
    ok: true,
    transferred_groups: transferred.results
      .map((row) => ({ group_id: row.id, new_owner_user_id: row.owner_user_id }))
      .sort((a, b) => a.group_id.localeCompare(b.group_id)),
    deleted_groups: deleted.results.map((row) => row.id).sort(),
  })
})

/**
 * DELETE /admin/matches/:id
 *
 * Remove um jogo, por exemplo um duplicado, e os palpites dele (cascata). Na mesma
 * transação, o ranking de todos os grupos da competição é refeito a partir dos
 * palpites que sobram, e o outro jogo do confronto de mata-mata (mesma fase, mando
 * invertido) volta à fila de pontuação, porque a classificação pode depender do jogo
 * removido. Grupo excluído fica como está, como na pontuação.
 *
 * Response: { ok, match_id, competition_id, groups }
 */
adminRouter.delete('/matches/:id', async (c) => {
  const matchId = c.req.param('id')
  const db = c.env.DB

  const match = await db
    .prepare(
      'SELECT id, competition_id, phase, home_team_id, away_team_id FROM matches WHERE id = ?',
    )
    .bind(matchId)
    .first<{
      id: string
      competition_id: string
      phase: string | null
      home_team_id: string
      away_team_id: string
    }>()
  if (!match) return c.json({ error: 'Jogo não encontrado' }, 404)

  const groups = await db
    .prepare('SELECT id FROM groups WHERE competition_id = ? AND deleted_at IS NULL')
    .bind(match.competition_id)
    .all<{ id: string }>()
  const groupIds = groups.results.map((row) => row.id)

  await db.batch([
    db
      .prepare(
        `UPDATE matches SET scored_at = NULL
          WHERE scored_at IS NOT NULL AND id <> ? AND competition_id = ? AND phase IS ?
            AND phase IN (SELECT value FROM json_each(?))
            AND home_team_id = ? AND away_team_id = ?`,
      )
      .bind(
        match.id,
        match.competition_id,
        match.phase,
        JSON.stringify(KNOCKOUT_PHASES),
        match.away_team_id,
        match.home_team_id,
      ),
    db.prepare('DELETE FROM matches WHERE id = ?').bind(match.id),
    ...leaderboardRebuildStatements(db, groupIds),
  ])

  return c.json({
    ok: true,
    match_id: match.id,
    competition_id: match.competition_id,
    groups: groupIds.length,
  })
})
