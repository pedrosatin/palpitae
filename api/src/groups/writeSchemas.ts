import type { StandardSchemaV1 } from '@standard-schema/spec'
import * as v from 'valibot'

export const CREATE_REQUIRED_MSG = 'Nome e competição são obrigatórios'
export const CREATE_POINTS_MSG = 'Pontuação deve ser inteiro entre 0 e 10'
export const CREATE_VISIBILITY_MSG = 'Visibilidade inválida'
export const JOIN_REQUIRED_MSG = 'Código de convite é obrigatório'
export const PATCH_EMPTY_MSG = 'Informe nome, pontos de classificado ou pedidos pelo link'
export const PATCH_POINTS_MSG = 'Pontos de classificado devem ser um inteiro entre 0 e 10'
export const PATCH_JOIN_FLAG_MSG = 'join_requests_enabled deve ser boolean'

type Issue = StandardSchemaV1.Issue

const pointSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10))

const trimmedNonEmpty = v.pipe(v.string(), v.transform((s) => s.trim()), v.minLength(1))

/**
 * Body de `POST /groups`. Pontos e visibilidade `null`/`undefined` caem no default
 * do handler (`??`), como antes do schema.
 */
export const createGroupSchema = v.object({
  name: trimmedNonEmpty,
  competition_id: trimmedNonEmpty,
  points_exact: v.nullish(pointSchema),
  points_winner: v.nullish(pointSchema),
  points_penalty: v.nullish(pointSchema),
  points_classified: v.nullish(pointSchema),
  predictions_visibility: v.nullish(v.picklist(['hidden', 'public'])),
})

export type CreateGroupBody = v.InferOutput<typeof createGroupSchema>

/** Ordem: nome/competição, pontuação, visibilidade. */
export function mapCreateGroupError(_data: unknown, issues: readonly Issue[]): string {
  for (const issue of issues) {
    const key = pathKey(issue)
    if (key === 'name' || key === 'competition_id') return CREATE_REQUIRED_MSG
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
    if (pathKey(issue) === 'predictions_visibility') return CREATE_VISIBILITY_MSG
  }
  return CREATE_REQUIRED_MSG
}

/** Body de `POST /groups/join`. */
export const joinGroupSchema = v.object({
  invite_code: trimmedNonEmpty,
  entry_method: v.optional(v.unknown()),
})

export type JoinGroupBody = v.InferOutput<typeof joinGroupSchema>

export function mapJoinGroupError(_data: unknown, _issues: readonly Issue[]): string {
  return JOIN_REQUIRED_MSG
}

/**
 * Body de `PATCH /groups/:id`. `name` fica `unknown` para o `parseGroupName` do
 * handler preservar a mensagem de comprimento/tipo.
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

/** Ordem: pontuação, flag booleana, corpo vazio. */
export function mapPatchGroupError(_data: unknown, issues: readonly Issue[]): string {
  for (const issue of issues) {
    if (pathKey(issue) === 'points_classified') return PATCH_POINTS_MSG
  }
  for (const issue of issues) {
    if (pathKey(issue) === 'join_requests_enabled') return PATCH_JOIN_FLAG_MSG
  }
  if (issues.length === 1 && issues[0]?.message === PATCH_EMPTY_MSG) {
    return PATCH_EMPTY_MSG
  }
  return PATCH_EMPTY_MSG
}

/**
 * Body de `POST /groups/join-requests`. O formato de `public_id` e o 404
 * "Link do grupo inválido" ficam no handler (`normalizePublicId`).
 */
export const createJoinRequestSchema = v.object({
  public_id: v.optional(v.unknown()),
})

export type CreateJoinRequestBody = v.InferOutput<typeof createJoinRequestSchema>

export function mapCreateJoinRequestError(_data: unknown, _issues: readonly Issue[]): string {
  return 'Link do grupo inválido'
}

function pathKey(issue: Issue, index = 0): string | number | undefined {
  const segment = issue.path?.[index]
  if (segment == null) return undefined
  if (typeof segment === 'object' && segment !== null && 'key' in segment) {
    return segment.key as string | number
  }
  return segment as string | number
}
