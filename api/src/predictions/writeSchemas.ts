import * as v from 'valibot'
import { isValidScore, MAX_SCORE } from './scores'

export const PUT_REQUIRED_MSG =
  'group_id, match_id, predicted_home_score e predicted_away_score são obrigatórios'
export const SCORE_RANGE_MSG = `Placar deve ser um inteiro entre 0 e ${MAX_SCORE}`
export const BULK_GROUP_MSG = 'group_id é obrigatório'
export const BULK_EMPTY_MSG = 'predictions deve ser uma lista não-vazia'
export const BULK_MAX_MSG = 'Máximo de 100 palpites por requisição'
export const BULK_ITEM_MSG = `Cada palpite precisa de match_id e placares inteiros entre 0 e ${MAX_SCORE}`
export const IMPORT_REQUIRED_MSG = 'source_group_id e target_group_id são obrigatórios'
export const IMPORT_DIFF_MSG = 'source_group_id e target_group_id devem ser diferentes'
export const REPLICATE_MAX_TARGETS = 10
export const REPLICATE_MAX_MATCHES = 100
export const REPLICATE_REQUIRED_MSG = `source_group_id, target_group_ids (até ${REPLICATE_MAX_TARGETS}) e match_ids (1 a ${REPLICATE_MAX_MATCHES}) são obrigatórios`
export const REPLICATE_DIFF_MSG = 'target_group_ids deve ter ao menos um grupo diferente da origem'

const scoreSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(MAX_SCORE),
)

const nonEmptyString = v.pipe(v.string(), v.minLength(1))

/** Body de `PUT /predictions`. */
export const putPredictionSchema = v.object({
  group_id: nonEmptyString,
  match_id: nonEmptyString,
  predicted_home_score: scoreSchema,
  predicted_away_score: scoreSchema,
  predicted_penalty_winner: v.optional(v.nullable(v.unknown())),
})

export type PutPredictionBody = v.InferOutput<typeof putPredictionSchema>

/** Mensagem de 400 do PUT singular, na mesma ordem das checagens antigas. */
export function mapPutPredictionError(data: unknown): string {
  const body = asRecord(data)
  if (
    !body ||
    !body.group_id ||
    !body.match_id ||
    body.predicted_home_score === undefined ||
    body.predicted_away_score === undefined
  ) {
    return PUT_REQUIRED_MSG
  }
  if (!isValidScore(body.predicted_home_score) || !isValidScore(body.predicted_away_score)) {
    return SCORE_RANGE_MSG
  }
  return PUT_REQUIRED_MSG
}

const bulkItemSchema = v.object({
  match_id: v.string(),
  predicted_home_score: scoreSchema,
  predicted_away_score: scoreSchema,
  predicted_penalty_winner: v.optional(v.nullable(v.unknown())),
})

/** Body de `PUT /predictions/bulk`. */
export const bulkPredictionSchema = v.object({
  group_id: nonEmptyString,
  predictions: v.pipe(v.array(bulkItemSchema), v.minLength(1), v.maxLength(100)),
})

export type BulkPredictionBody = v.InferOutput<typeof bulkPredictionSchema>

/** Mensagem de 400 do bulk, na mesma ordem de `validateBulkPutPayload`. */
export function mapBulkPredictionError(data: unknown): string {
  const body = asRecord(data)
  if (!body?.group_id) return BULK_GROUP_MSG
  if (!Array.isArray(body.predictions) || body.predictions.length === 0) return BULK_EMPTY_MSG
  if (body.predictions.length > 100) return BULK_MAX_MSG
  for (const p of body.predictions) {
    const item = asRecord(p)
    if (
      !item ||
      typeof item.match_id !== 'string' ||
      !isValidScore(item.predicted_home_score) ||
      !isValidScore(item.predicted_away_score)
    ) {
      return BULK_ITEM_MSG
    }
  }
  return BULK_GROUP_MSG
}

/** Body de `POST /predictions/import`. `only_missing` só vale quando é `true`. */
export const importPredictionSchema = v.pipe(
  v.object({
    source_group_id: nonEmptyString,
    target_group_id: nonEmptyString,
    only_missing: v.optional(v.unknown()),
  }),
  v.check((body) => body.source_group_id !== body.target_group_id, IMPORT_DIFF_MSG),
)

export type ImportPredictionBody = v.InferOutput<typeof importPredictionSchema>

export function mapImportPredictionError(data: unknown): string {
  const body = asRecord(data)
  if (!body?.source_group_id || !body?.target_group_id) return IMPORT_REQUIRED_MSG
  if (body.source_group_id === body.target_group_id) return IMPORT_DIFF_MSG
  return IMPORT_REQUIRED_MSG
}

function uniqueNonEmptyStrings(max: number) {
  return v.pipe(
    v.array(nonEmptyString),
    v.transform((items) => Array.from(new Set(items))),
    v.maxLength(max),
  )
}

/**
 * Body de `POST /predictions/replicate`. A lista de destinos sai sem a origem;
 * lista vazia depois disso falha com `REPLICATE_DIFF_MSG`.
 */
export const replicatePredictionSchema = v.pipe(
  v.object({
    source_group_id: nonEmptyString,
    target_group_ids: uniqueNonEmptyStrings(REPLICATE_MAX_TARGETS),
    match_ids: v.pipe(uniqueNonEmptyStrings(REPLICATE_MAX_MATCHES), v.minLength(1)),
  }),
  v.check(
    (body) => body.target_group_ids.some((id) => id !== body.source_group_id),
    REPLICATE_DIFF_MSG,
  ),
  v.transform((body) => ({
    source_group_id: body.source_group_id,
    target_group_ids: body.target_group_ids.filter((id) => id !== body.source_group_id),
    match_ids: body.match_ids,
  })),
)

export type ReplicatePredictionBody = v.InferOutput<typeof replicatePredictionSchema>

export function mapReplicatePredictionError(data: unknown): string {
  const body = asRecord(data)
  if (!body) return REPLICATE_REQUIRED_MSG

  const sourceGroupId = body.source_group_id
  const targetIds = stringList(body.target_group_ids, REPLICATE_MAX_TARGETS)
  const matchIds = stringList(body.match_ids, REPLICATE_MAX_MATCHES)
  if (
    typeof sourceGroupId !== 'string' ||
    sourceGroupId.length === 0 ||
    !targetIds ||
    !matchIds ||
    matchIds.length === 0
  ) {
    return REPLICATE_REQUIRED_MSG
  }
  if (targetIds.filter((id) => id !== sourceGroupId).length === 0) {
    return REPLICATE_DIFF_MSG
  }
  return REPLICATE_REQUIRED_MSG
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function stringList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) return null
  const unique = Array.from(new Set(value))
  return unique.length > max ? null : unique
}
