import type { Context } from 'hono'
import { isPilotGroupBlocked } from '../groups/membership'
import { validateJson } from '../http/validateJson'
import { hashUserId, logEvent } from '../observability'
import { enforceDailyWriteBudget } from '../security/limits'
import type { AppContext } from '../types'
import {
  importPredictions,
  type ImportErrorStatus,
  type ImportPredictionsError,
} from './importPredictions'
import {
  type ImportPredictionBody,
  importPredictionSchema,
  mapImportPredictionError,
} from './writeSchemas'

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
 *   503 — controle de requisições indisponível
 */
export const importJsonValidator = validateJson(importPredictionSchema, (data) =>
  mapImportPredictionError(data),
)

export async function handleImportPost(
  c: Context<AppContext, string, { out: { json: ImportPredictionBody } }>,
) {
  const userId = c.get('userId')
  const body = c.req.valid('json')
  const { source_group_id, target_group_id } = body
  const onlyMissing = body.only_missing === true

  const db = c.env.DB
  const result = await importPredictions(
    db,
    {
      userId,
      sourceGroupId: source_group_id,
      targetGroupId: target_group_id,
      onlyMissing,
    },
    {
      isPilotGroupBlocked: (groupId) => isPilotGroupBlocked(c, db, groupId),
      enforceWriteBudget: async (plannedStatements) => {
        const response = await enforceDailyWriteBudget(c, plannedStatements)
        if (!response) return null
        const payload = (await response.json()) as { error?: string }
        return {
          error: payload.error ?? 'Erro de orçamento',
          status: response.status as ImportErrorStatus,
        } satisfies ImportPredictionsError
      },
      logPredictionSaved: async ({ targetGroupId, userId: uid, competitionId, imported }) => {
        logEvent(c.env.AE, 'prediction_saved', {
          blobs: [targetGroupId, '', await hashUserId(uid), 'import', competitionId],
          doubles: [imported],
        })
      },
    },
  )

  if ('error' in result) {
    // 429: `dailyBudgetExceededResponse` já gravou Retry-After em `c`.
    return c.json({ error: result.error }, result.status)
  }

  return c.json(result)
}
