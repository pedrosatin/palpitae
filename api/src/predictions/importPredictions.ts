import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { getGroupMembership, isPilotGroupBlocked } from '../groups/membership'
import { notBannedSql } from '../groups/ranking'
import { INVALID_BODY, readJsonObject } from '../http/jsonBody'
import { lockedSql, SQL_NOW } from '../matches/locking'
import { hashUserId, logEvent } from '../observability'
import { enforceDailyWriteBudget } from '../security/limits'
import type { AppContext } from '../types'
import { acceptsFrom, type CopyGroup, MAX_BATCH_STATEMENTS, planCopy } from './replicate'

/** Jogos abertos palpitados pelo usuário em outros grupos ativos do mesmo campeonato. */
export async function fetchImportSources(
  db: D1Database,
  userId: string,
  groupId: string,
  now: string,
): Promise<Record<string, string[]>> {
  const rows = await db
    .prepare(
      `SELECT p.group_id, p.match_id
       FROM predictions p
       JOIN matches m ON m.id = p.match_id
       JOIN groups g ON g.id = p.group_id AND g.deleted_at IS NULL
       JOIN group_members gm ON gm.group_id = p.group_id AND gm.user_id = p.user_id
       WHERE p.user_id = ? AND p.group_id != ?
         AND g.competition_id = (SELECT competition_id FROM groups WHERE id = ?)
         AND ${notBannedSql('p')}
         AND NOT ${lockedSql()}`,
    )
    .bind(userId, groupId, groupId, now)
    .all<{ group_id: string; match_id: string }>()
  const sources: Record<string, string[]> = {}
  for (const r of rows.results) (sources[r.group_id] ??= []).push(r.match_id)
  return sources
}

export async function verifyGroupsForImport(
  db: D1Database,
  userId: string,
  sourceGroupId: string,
  targetGroupId: string,
): Promise<
  { error: string; status: ContentfulStatusCode } | { source: CopyGroup; target: CopyGroup }
> {
  // Verify user is an active member of both groups (same rule as every group route)
  const [sourceMembership, targetMembership] = await Promise.all([
    getGroupMembership(db, sourceGroupId, userId),
    getGroupMembership(db, targetGroupId, userId),
  ])

  if (!sourceMembership) {
    return { error: 'Acesso negado ao grupo de origem', status: 403 }
  }

  if (!targetMembership) {
    return { error: 'Acesso negado ao grupo de destino', status: 403 }
  }

  // Verify both groups belong to the same competition
  const groupSql = `SELECT id, competition_id, points_exact FROM groups WHERE id = ? AND deleted_at IS NULL`
  const [source, target] = await Promise.all([
    db.prepare(groupSql).bind(sourceGroupId).first<CopyGroup>(),
    db.prepare(groupSql).bind(targetGroupId).first<CopyGroup>(),
  ])

  if (!source || !target) {
    return { error: 'Grupo não encontrado', status: 404 }
  }

  if (source.competition_id !== target.competition_id) {
    return { error: 'Os grupos pertencem a campeonatos diferentes', status: 422 }
  }

  if (!acceptsFrom(source, target)) {
    return {
      error:
        'O grupo de origem palpita só o vencedor, e este grupo pontua o placar exato. Importe de um grupo com placar.',
      status: 422,
    }
  }

  return { source, target }
}

/**
 * POST /predictions/import
 *
 * Copia os palpites do usuário de um grupo para outro do mesmo campeonato, com
 * as regras de `POST /predictions/replicate` (`planCopy`):
 *   - origem "só vencedor" não grava em destino que pontua placar exato (422);
 *   - destino "só vencedor" recebe o resultado do placar (1x0, 0x0 ou 0x1);
 *   - jogo travado não é copiado e entra em `locked_skipped`. A escrita confere o
 *     travamento de novo, com o relógio do banco;
 *   - `imported` conta o que ficou no destino: o palpite gravado e o que já era igual.
 *     O jogo que a escrita recusou sai da conta, e a importação só fica marcada como
 *     concluída se `imported` for maior que zero;
 *   - o vencedor dos pênaltis da volta sai do agregado que o destino vai ter;
 *   - o palpite do destino que já é igual não é regravado.
 * O palpite que o destino já tinha é substituído, salvo com `only_missing`, que
 * só preenche os jogos sem palpite no destino.
 *
 * Body: { source_group_id, target_group_id, only_missing? }
 *
 * Response: { ok: true, imported: number, locked_skipped: number }
 *
 * Errors:
 *   400 — campos ausentes, inválidos ou acima de 1000 instruções planejadas
 *   403 — usuário fora de um dos grupos
 *   404 — grupo não encontrado
 *   422 — grupos de campeonatos diferentes, ou origem "só vencedor" com destino de placar exato
 *   429 — orçamento diário de escrita excedido
 */
export async function handleImportPost(c: Context<AppContext>) {
  const userId = c.get('userId')

  type ImportBody = { source_group_id?: string; target_group_id?: string; only_missing?: boolean }
  const body = await readJsonObject<ImportBody>(c)
  if (!body) return c.json({ error: INVALID_BODY }, 400)

  const { source_group_id, target_group_id } = body
  const onlyMissing = body.only_missing === true

  if (!source_group_id || !target_group_id) {
    return c.json({ error: 'source_group_id e target_group_id são obrigatórios' }, 400)
  }

  if (source_group_id === target_group_id) {
    return c.json({ error: 'source_group_id e target_group_id devem ser diferentes' }, 400)
  }

  const db = c.env.DB

  if (
    (await isPilotGroupBlocked(c, db, source_group_id)) ||
    (await isPilotGroupBlocked(c, db, target_group_id))
  ) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  const verified = await verifyGroupsForImport(db, userId, source_group_id, target_group_id)
  if ('error' in verified) {
    return c.json({ error: verified.error }, verified.status)
  }

  const now = new Date().toISOString()
  const plan = await planCopy(db, {
    userId,
    source: verified.source,
    targets: [verified.target],
    matchIds: null,
    onlyMissing,
    now,
  })
  const planned = plan.results[0].saved
  let lockedSkipped = plan.lockedMatches.length

  if (planned === 0) {
    return c.json({ ok: true, imported: 0, locked_skipped: lockedSkipped })
  }

  if (plan.statements.length > MAX_BATCH_STATEMENTS) {
    return c.json({ error: `Máximo de ${MAX_BATCH_STATEMENTS} palpites por requisição` }, 400)
  }

  // O lote leva os palpites e mais a instrução do marcador de importação.
  const budgetError = await enforceDailyWriteBudget(c, plan.statements.length + 1)
  if (budgetError) return budgetError

  // Palpites e marcador no mesmo lote: se um falha, nada fica gravado. O marcador
  // entra se algum palpite já era igual ou se o lote gravou algum, o que deixa
  // no destino uma linha com o `updated_at` deste lote.
  const alreadyEqual = planned - plan.statements.length
  const written = await db.batch([
    ...plan.statements,
    db
      .prepare(`UPDATE group_members SET predictions_import_completed = 1
      WHERE group_id = ? AND user_id = ?
        AND (? > 0 OR EXISTS (
          SELECT 1 FROM predictions p
          WHERE p.user_id = ? AND p.group_id = ? AND p.updated_at = ?))`)
      .bind(target_group_id, userId, alreadyEqual, userId, target_group_id, now),
  ])
  // A escrita recusa o jogo que travou depois do plano e, com `only_missing`, o
  // que o destino palpitou nesse intervalo. Nenhum dos dois foi importado.
  const refused = plan.statementMatches.filter((_, i) => written[i].meta.changes === 0)
  const imported = planned - refused.length
  if (refused.length > 0) {
    const locked = await db
      .prepare(
        `SELECT COUNT(*) AS total FROM matches m
         WHERE m.id IN (SELECT value FROM json_each(?)) AND ${lockedSql('m', SQL_NOW)}`,
      )
      .bind(JSON.stringify(refused))
      .first<{ total: number }>()
    lockedSkipped += locked?.total ?? 0
  }

  if (imported > 0) {
    logEvent(c.env.AE, 'prediction_saved', {
      blobs: [
        target_group_id,
        '',
        await hashUserId(userId),
        'import',
        verified.target.competition_id,
      ],
      doubles: [imported],
    })
  }

  return c.json({
    ok: true,
    imported,
    locked_skipped: lockedSkipped,
  })
}
