import { getGroupMembership } from '../groups/membership'
import { notBannedSql } from '../groups/ranking'
import { lockedSql, SQL_NOW } from '../matches/locking'
import { acceptsFrom, type CopyGroup, MAX_BATCH_STATEMENTS, planCopy } from './replicate'

/** Status HTTP que o adapter mapeia a partir de erros de domínio. */
export type ImportErrorStatus = 400 | 403 | 404 | 422 | 429 | 503

export type ImportPredictionsInput = {
  userId: string
  sourceGroupId: string
  targetGroupId: string
  onlyMissing: boolean
  /** Relógio do plano; a escrita confere o travamento de novo com o relógio do banco. */
  now?: string
}

export type ImportPredictionsError = {
  error: string
  status: ImportErrorStatus
}

export type ImportPredictionsSuccess = {
  ok: true
  imported: number
  locked_skipped: number
}

export type ImportPredictionsResult = ImportPredictionsSuccess | ImportPredictionsError

/**
 * Dependências de infraestrutura que o domínio não pode importar do Hono:
 * bloqueio de grupo piloto, orçamento diário de escrita e telemetria.
 */
export type ImportPredictionsDeps = {
  isPilotGroupBlocked: (groupId: string) => Promise<boolean>
  enforceWriteBudget: (plannedStatements: number) => Promise<ImportPredictionsError | null>
  logPredictionSaved?: (args: {
    targetGroupId: string
    userId: string
    competitionId: string
    imported: number
  }) => void | Promise<void>
}

/**
 * Jogos abertos palpitados pelo usuário em outros grupos ativos do mesmo
 * campeonato. Exclui origens que `acceptsFrom` recusa para o grupo alvo (origem
 * só vencedor → destino de placar exato), alinhado ao filtro do web.
 */
export async function fetchImportSources(
  db: D1Database,
  userId: string,
  groupId: string,
  now: string,
): Promise<Record<string, string[]>> {
  const target = await db
    .prepare(
      `SELECT id, competition_id, points_exact FROM groups WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(groupId)
    .first<CopyGroup>()
  if (!target) return {}

  const rows = await db
    .prepare(
      `SELECT p.group_id, p.match_id, g.competition_id, g.points_exact
       FROM predictions p
       JOIN matches m ON m.id = p.match_id
       JOIN groups g ON g.id = p.group_id AND g.deleted_at IS NULL
       JOIN group_members gm ON gm.group_id = p.group_id AND gm.user_id = p.user_id
       WHERE p.user_id = ? AND p.group_id != ?
         AND g.competition_id = ?
         AND ${notBannedSql('p')}
         AND NOT ${lockedSql()}`,
    )
    .bind(userId, groupId, target.competition_id, now)
    .all<{ group_id: string; match_id: string; competition_id: string; points_exact: number }>()
  const sources: Record<string, string[]> = {}
  for (const r of rows.results) {
    const source: CopyGroup = {
      id: r.group_id,
      competition_id: r.competition_id,
      points_exact: r.points_exact,
    }
    if (!acceptsFrom(source, target)) continue
    ;(sources[r.group_id] ??= []).push(r.match_id)
  }
  return sources
}

async function verifyGroupsForImport(
  db: D1Database,
  userId: string,
  sourceGroupId: string,
  targetGroupId: string,
): Promise<ImportPredictionsError | { source: CopyGroup; target: CopyGroup }> {
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
 * Importa os palpites do usuário de um grupo para outro do mesmo campeonato.
 * Encapsula verify → planCopy → batch com marcador. Sem Context do Hono: o
 * adapter HTTP monta `deps` e mapeia o resultado para status e JSON.
 */
export async function importPredictions(
  db: D1Database,
  input: ImportPredictionsInput,
  deps: ImportPredictionsDeps,
): Promise<ImportPredictionsResult> {
  const { userId, sourceGroupId, targetGroupId, onlyMissing } = input

  if (
    (await deps.isPilotGroupBlocked(sourceGroupId)) ||
    (await deps.isPilotGroupBlocked(targetGroupId))
  ) {
    return { error: 'Grupo não encontrado', status: 404 }
  }

  const verified = await verifyGroupsForImport(db, userId, sourceGroupId, targetGroupId)
  if ('error' in verified) return verified

  const now = input.now ?? new Date().toISOString()
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
    return { ok: true, imported: 0, locked_skipped: lockedSkipped }
  }

  if (plan.statements.length > MAX_BATCH_STATEMENTS) {
    return {
      error: `Máximo de ${MAX_BATCH_STATEMENTS} palpites por requisição`,
      status: 400,
    }
  }

  // O lote leva os palpites e mais a instrução do marcador de importação.
  const budgetError = await deps.enforceWriteBudget(plan.statements.length + 1)
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
      .bind(targetGroupId, userId, alreadyEqual, userId, targetGroupId, now),
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

  if (imported > 0 && deps.logPredictionSaved) {
    await deps.logPredictionSaved({
      targetGroupId,
      userId,
      competitionId: verified.target.competition_id,
      imported,
    })
  }

  return {
    ok: true,
    imported,
    locked_skipped: lockedSkipped,
  }
}
