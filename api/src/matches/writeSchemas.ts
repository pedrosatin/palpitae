import type { StandardSchemaV1 } from '@standard-schema/spec'
import * as v from 'valibot'

export const SYNC_REQUIRED_MSG = 'competition e season são obrigatórios'
export const SYNC_SEASON_MSG = 'season deve ser um número'
export const SYNC_DATES_MSG = 'dates deve ser uma lista de datas YYYYMMDD'

type Issue = StandardSchemaV1.Issue

type SyncFields = {
  competition?: unknown
  season?: unknown
  matchday?: unknown
  dates?: unknown
}

/**
 * Espelha o acesso a campos da base: objeto e lista expõem propriedades;
 * `null` e valor solto viram `{}` e caem na mensagem de obrigatórios.
 */
function asSyncFields(raw: unknown): SyncFields {
  if (raw !== null && typeof raw === 'object') return raw as SyncFields
  return {}
}

function isValidDatesList(dates: unknown): dates is string[] {
  return (
    Array.isArray(dates) &&
    dates.every((d): d is string => typeof d === 'string' && /^\d{8}$/.test(d))
  )
}

/**
 * Corpo de `POST /matches/sync`:
 * `{ competition, season, matchday?, dates? }`.
 * `matchday` é a rodada na football-data; `dates` são YYYYMMDD do scoreboard ESPN.
 *
 * A ordem das checagens replica `validateSyncParams`: obrigatórios com a mesma
 * regra de truthiness, então `season: 0` falha aqui; depois tipo de `season` e
 * formato de `dates`.
 */
export const syncBodySchema = v.pipe(
  v.unknown(),
  v.transform(asSyncFields),
  v.check((body) => Boolean(body.competition) && Boolean(body.season), SYNC_REQUIRED_MSG),
  v.check((body) => typeof body.season === 'number', SYNC_SEASON_MSG),
  v.check(
    (body) => body.dates === undefined || isValidDatesList(body.dates),
    SYNC_DATES_MSG,
  ),
  v.transform((body) => ({
    competition: body.competition as string,
    season: body.season as number,
    matchday: body.matchday as number | undefined,
    dates: body.dates as string[] | undefined,
  })),
)

export type SyncBody = v.InferOutput<typeof syncBodySchema>

/**
 * Mensagem de 400 do POST /matches/sync. Responde a primeira falha nesta ordem:
 * obrigatórios, season numérico e dates YYYYMMDD.
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
