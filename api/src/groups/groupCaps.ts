/**
 * Tetos de grupos por usuário. Decisão do operador em 13/11/2026, registrada em
 * `.scratch/seguranca-2026-11/spec.md` ("Tetos de grupos") e em `docs/security.md`.
 * Eles limitam o custo de `GET /groups`, das escritas em lote e do cron de
 * pontuação. Na data da decisão, o maior uso em produção era de 4 grupos criados
 * e 22 participações.
 */

/** Grupos não excluídos que um usuário pode ter criado. */
export const MAX_ACTIVE_GROUPS_OWNED = 20

/** Grupos não excluídos de que um usuário pode participar, contando os que criou. */
export const MAX_ACTIVE_MEMBERSHIPS = 50

export const OWNED_CAP_ERROR = `Você já tem ${MAX_ACTIVE_GROUPS_OWNED} grupos criados. Exclua um para criar outro.`
export const JOIN_MEMBERSHIP_CAP_ERROR = `Você já participa de ${MAX_ACTIVE_MEMBERSHIPS} grupos. Saia de um para entrar em outro.`
export const CREATE_MEMBERSHIP_CAP_ERROR = `Você já participa de ${MAX_ACTIVE_MEMBERSHIPS} grupos. Saia de um para criar outro.`

/**
 * Contagem das participações ativas de um usuário, como subquery escalar com um
 * bind (o id do usuário). Parte de `group_members` pelo índice
 * `idx_group_members_user`. Participação removida não tem linha, e a de grupo
 * excluído sai pelo `deleted_at`.
 *
 * Entra no `WHERE` do `INSERT` que cria o grupo ou a participação: uma contagem
 * num `SELECT` separado deixaria dois pedidos simultâneos passarem do teto.
 */
export const ACTIVE_MEMBERSHIPS_COUNT_SQL = `(
  SELECT COUNT(*) FROM group_members cap_gm
    JOIN groups cap_g ON cap_g.id = cap_gm.group_id
   WHERE cap_gm.user_id = ? AND cap_g.deleted_at IS NULL)`

/**
 * Contagem dos grupos ativos criados por um usuário, com um bind (o id do
 * usuário). O dono sempre tem linha em `group_members` e não consegue sair do
 * próprio grupo, então a contagem parte das participações dele, pelo mesmo
 * índice, em vez de varrer `groups`, que não tem índice por `owner_user_id`.
 */
export const ACTIVE_GROUPS_OWNED_COUNT_SQL = `(
  SELECT COUNT(*) FROM group_members cap_gm
    JOIN groups cap_g ON cap_g.id = cap_gm.group_id
   WHERE cap_gm.user_id = ? AND cap_g.owner_user_id = cap_gm.user_id
     AND cap_g.deleted_at IS NULL)`
