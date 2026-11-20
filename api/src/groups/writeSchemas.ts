import type { StandardSchemaV1 } from '@standard-schema/spec'
import * as v from 'valibot'
import { parseGroupName } from './groupName'
import { JOIN_REQUEST_INVALID_LINK } from './joinRequests'

export const CREATE_REQUIRED_MSG = 'Nome e competição são obrigatórios'
export const CREATE_POINTS_MSG = 'Pontuação deve ser inteiro entre 0 e 10'
export const CREATE_EXACT_GE_WINNER_MSG =
  'Pontos por placar exato deve ser maior ou igual a pontos por vencedor'
export const CREATE_SUM_ZERO_MSG = 'Pelo menos um tipo de pontuação deve ser maior que zero'
export const CREATE_VISIBILITY_MSG = 'Visibilidade inválida'
export const JOIN_REQUIRED_MSG = 'Código de convite é obrigatório'
export const PATCH_EMPTY_MSG = 'Informe nome, pontos de classificado ou pedidos pelo link'
export const PATCH_POINTS_MSG = 'Pontos de classificado devem ser um inteiro entre 0 e 10'
export const PATCH_JOIN_FLAG_MSG = 'join_requests_enabled deve ser boolean'

type Issue = StandardSchemaV1.Issue

const pointSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10))

const trimmedNonEmpty = v.pipe(v.string(), v.transform((s) => s.trim()), v.minLength(1))

/**
 * Exige nome não vazio e aplica `parseGroupName`, que normaliza para NFC, tira os
 * espaços das pontas e recusa caractere invisível ou comprimento fora de 2 a 30.
 */
const groupNameSchema = v.pipe(
  v.string(),
  v.check((s) => s.trim().length >= 1),
  v.rawTransform(({ dataset, addIssue, NEVER }) => {
    const parsed = parseGroupName(dataset.value)
    if ('error' in parsed) {
      addIssue({ message: parsed.error })
      return NEVER
    }
    return parsed.name
  }),
)

/**
 * Corpo de `POST /groups`. Com pontos ou visibilidade `null` ou ausentes, o
 * schema aplica o valor padrão.
 */
export const createGroupSchema = v.pipe(
  v.object({
    name: groupNameSchema,
    competition_id: trimmedNonEmpty,
    points_exact: v.nullish(pointSchema),
    points_winner: v.nullish(pointSchema),
    points_penalty: v.nullish(pointSchema),
    points_classified: v.nullish(pointSchema),
    predictions_visibility: v.nullish(v.unknown()),
  }),
  // Exato, vencedor, pênaltis e visibilidade só se definem na criação; o PATCH muda
  // apenas points_classified. points_penalty é bônus somado e fica fora da regra
  // exato≥vencedor.
  v.transform((body) => ({
    ...body,
    points_exact: body.points_exact ?? 3,
    points_winner: body.points_winner ?? 1,
    points_penalty: body.points_penalty ?? 1,
    points_classified: body.points_classified ?? 0,
    predictions_visibility: body.predictions_visibility ?? 'hidden',
  })),
  // points_exact === 0 liga o modo só vencedor (1X2) e sempre passa. Com exato > 0,
  // o placar exato vale pelo menos o mesmo que o vencedor.
  v.check(
    (body) => !(body.points_exact > 0 && body.points_exact < body.points_winner),
    CREATE_EXACT_GE_WINNER_MSG,
  ),
  v.check((body) => body.points_exact + body.points_winner !== 0, CREATE_SUM_ZERO_MSG),
  v.check(
    (body) =>
      body.predictions_visibility === 'hidden' || body.predictions_visibility === 'public',
    CREATE_VISIBILITY_MSG,
  ),
  v.transform((body) => ({
    ...body,
    predictions_visibility: body.predictions_visibility as 'hidden' | 'public',
  })),
)

export type CreateGroupBody = v.InferOutput<typeof createGroupSchema>

/**
 * Mensagem de 400 do POST /groups. Responde a primeira falha nesta ordem:
 * obrigatórios, regra do nome, pontuação 0-10, exato≥vencedor, soma zero e
 * visibilidade.
 */
export function mapCreateGroupError(_data: unknown, issues: readonly Issue[]): string {
  for (const issue of issues) {
    const key = pathKey(issue)
    if (key === 'competition_id') return CREATE_REQUIRED_MSG
    if (key === 'name' && issueType(issue) !== 'raw_transform') return CREATE_REQUIRED_MSG
  }
  for (const issue of issues) {
    if (pathKey(issue) === 'name') return issue.message
  }
  for (const issue of issues) {
    const key = pathKey(issue)
    if (
      key === 'points_exact' ||
      key === 'points_winner' ||
      key === 'points_penalty' ||
      key === 'points_classified'
    ) {
      return CREATE_POINTS_MSG
    }
  }
  for (const issue of issues) {
    if (issue.message === CREATE_EXACT_GE_WINNER_MSG) return CREATE_EXACT_GE_WINNER_MSG
  }
  for (const issue of issues) {
    if (issue.message === CREATE_SUM_ZERO_MSG) return CREATE_SUM_ZERO_MSG
  }
  for (const issue of issues) {
    if (issue.message === CREATE_VISIBILITY_MSG) return CREATE_VISIBILITY_MSG
  }
  return CREATE_REQUIRED_MSG
}

/** Corpo de `POST /groups/join`. */
export const joinGroupSchema = v.object({
  invite_code: trimmedNonEmpty,
  entry_method: v.optional(v.unknown()),
})

export type JoinGroupBody = v.InferOutput<typeof joinGroupSchema>

export function mapJoinGroupError(_data: unknown, _issues: readonly Issue[]): string {
  return JOIN_REQUIRED_MSG
}

/**
 * Corpo de `PATCH /groups/:id`. `name` fica `unknown` porque o handler passa o
 * valor a `parseGroupName`, que responde com a mensagem de comprimento também
 * quando o tipo é errado.
 */
export const patchGroupSchema = v.pipe(
  v.object({
    name: v.optional(v.unknown()),
    points_classified: v.optional(pointSchema),
    join_requests_enabled: v.optional(v.boolean()),
  }),
  v.check(
    (body) =>
      body.name !== undefined ||
      body.points_classified !== undefined ||
      body.join_requests_enabled !== undefined,
    PATCH_EMPTY_MSG,
  ),
)

export type PatchGroupBody = v.InferOutput<typeof patchGroupSchema>

/**
 * Responde a primeira falha nesta ordem: `points_classified`,
 * `join_requests_enabled` e corpo sem campo editável.
 */
export function mapPatchGroupError(_data: unknown, issues: readonly Issue[]): string {
  for (const issue of issues) {
    if (pathKey(issue) === 'points_classified') return PATCH_POINTS_MSG
  }
  for (const issue of issues) {
    if (pathKey(issue) === 'join_requests_enabled') return PATCH_JOIN_FLAG_MSG
  }
  return PATCH_EMPTY_MSG
}

/**
 * Corpo de `POST /groups/join-requests`. Tipo errado em `public_id` vira
 * `undefined` e o handler responde 404 com `JOIN_REQUEST_INVALID_LINK`.
 */
export const createJoinRequestSchema = v.object({
  public_id: v.optional(
    v.pipe(
      v.unknown(),
      v.transform((value) => (typeof value === 'string' ? value : undefined)),
    ),
  ),
})

export type CreateJoinRequestBody = v.InferOutput<typeof createJoinRequestSchema>

export function mapCreateJoinRequestError(_data: unknown, _issues: readonly Issue[]): string {
  return JOIN_REQUEST_INVALID_LINK
}

function pathKey(issue: Issue, index = 0): string | number | undefined {
  const segment = issue.path?.[index]
  if (segment == null) return undefined
  if (typeof segment === 'object' && 'key' in segment) {
    return segment.key as string | number
  }
  return segment as string | number
}

function issueType(issue: Issue): string | undefined {
  const type = (issue as unknown as { type?: unknown }).type
  return typeof type === 'string' ? type : undefined
}
