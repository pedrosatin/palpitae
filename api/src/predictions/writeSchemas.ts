import type { StandardSchemaV1 } from '@standard-schema/spec'
import * as v from 'valibot'
import { MAX_SCORE } from './scores'

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

type Issue = StandardSchemaV1.Issue

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

/** Mensagem de 400 do PUT singular. Campo ausente tem prioridade sobre placar fora da faixa. */
export function mapPutPredictionError(
  _data: unknown,
  issues: readonly Issue[],
): string {
  for (const issue of issues) {
    const key = pathKey(issue)
    if (key === 'group_id' || key === 'match_id') return PUT_REQUIRED_MSG
    if (
      (key === 'predicted_home_score' || key === 'predicted_away_score') &&
      issueInput(issue) === undefined
    ) {
      return PUT_REQUIRED_MSG
    }
  }
  for (const issue of issues) {
    const key = pathKey(issue)
    if (key === 'predicted_home_score' || key === 'predicted_away_score') {
      return SCORE_RANGE_MSG
    }
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

/** Mensagem de 400 do bulk. Ordem: group_id, lista vazia, teto de 100, item inválido. */
export function mapBulkPredictionError(
  _data: unknown,
  issues: readonly Issue[],
): string {
  for (const issue of issues) {
    if (pathKey(issue) === 'group_id') return BULK_GROUP_MSG
  }
  for (const issue of issues) {
    if (pathKey(issue) !== 'predictions') continue
    if ((issue.path?.length ?? 0) > 1) continue
    if (issueType(issue) === 'max_length') continue
    // Ausente, tipo errado ou lista vazia (array / min_length / object).
    return BULK_EMPTY_MSG
  }
  for (const issue of issues) {
    if (pathKey(issue) === 'predictions' && issueType(issue) === 'max_length') {
      return BULK_MAX_MSG
    }
  }
  for (const issue of issues) {
    if (pathKey(issue) === 'predictions' && (issue.path?.length ?? 0) > 1) {
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

export function mapImportPredictionError(
  _data: unknown,
  issues: readonly Issue[],
): string {
  if (issues.length === 1 && issues[0]?.message === IMPORT_DIFF_MSG) {
    return IMPORT_DIFF_MSG
  }
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

export function mapReplicatePredictionError(
  _data: unknown,
  issues: readonly Issue[],
): string {
  if (issues.length === 1 && issues[0]?.message === REPLICATE_DIFF_MSG) {
    return REPLICATE_DIFF_MSG
  }
  return REPLICATE_REQUIRED_MSG
}

function pathKey(issue: Issue, index = 0): string | number | undefined {
  const segment = issue.path?.[index]
  if (segment == null) return undefined
  if (typeof segment === 'object' && segment !== null && 'key' in segment) {
    return segment.key as string | number
  }
  return segment as string | number
}

function issueType(issue: Issue): string | undefined {
  const type = (issue as unknown as { type?: unknown }).type
  return typeof type === 'string' ? type : undefined
}

function issueInput(issue: Issue): unknown {
  return (issue as unknown as { input?: unknown }).input
}
