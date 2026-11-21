import type { StandardSchemaV1 } from '@standard-schema/spec'
import * as v from 'valibot'

export const SYNC_REQUIRED_MSG = 'competition e season são obrigatórios'
export const SYNC_SEASON_MSG = 'season deve ser um número'
export const SYNC_DATES_MSG = 'dates deve ser uma lista de datas YYYYMMDD'

type Issue = StandardSchemaV1.Issue

/**
 * Corpo de `POST /matches/sync`:
 * `{ competition, season, matchday?, dates? }`.
 * `matchday` é a rodada na football-data; `dates` são YYYYMMDD do scoreboard ESPN.
 *
 * Os campos obrigatórios usam truthiness, então `season: 0` e `competition: ''`
 * recebem a mensagem de obrigatórios. `mapSyncBodyError` define a prioridade
 * entre as mensagens.
 */
const required = v.check((x: unknown) => Boolean(x), SYNC_REQUIRED_MSG)

export const syncBodySchema = v.object(
  {
    competition: v.custom<string>((x) => Boolean(x), SYNC_REQUIRED_MSG),
    season: v.pipe(v.unknown(), required, v.number(SYNC_SEASON_MSG)),
    matchday: v.optional(v.unknown()),
    dates: v.optional(
      v.array(
        v.pipe(v.string(SYNC_DATES_MSG), v.regex(/^\d{8}$/, SYNC_DATES_MSG)),
        SYNC_DATES_MSG,
      ),
    ),
  },
  SYNC_REQUIRED_MSG,
)

export type SyncBody = v.InferOutput<typeof syncBodySchema>

/**
 * Mensagem de 400 do POST /matches/sync. Responde a primeira falha nesta ordem:
 * obrigatórios, season numérico e dates YYYYMMDD. Issue sem mensagem conhecida
 * também responde a mensagem de obrigatórios.
 */
export function mapSyncBodyError(_data: unknown, issues: readonly Issue[]): string {
  for (const issue of issues) {
    if (issue.message === SYNC_REQUIRED_MSG) return SYNC_REQUIRED_MSG
  }
  for (const issue of issues) {
    if (issue.message === SYNC_SEASON_MSG) return SYNC_SEASON_MSG
  }
  for (const issue of issues) {
    if (issue.message === SYNC_DATES_MSG) return SYNC_DATES_MSG
  }
  return SYNC_REQUIRED_MSG
}
