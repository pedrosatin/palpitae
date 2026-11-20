import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'
import {
  CREATE_POINTS_MSG,
  CREATE_REQUIRED_MSG,
  CREATE_VISIBILITY_MSG,
  createGroupSchema,
  createJoinRequestSchema,
  JOIN_REQUIRED_MSG,
  joinGroupSchema,
  mapCreateGroupError,
  mapCreateJoinRequestError,
  mapJoinGroupError,
  mapPatchGroupError,
  PATCH_EMPTY_MSG,
  PATCH_JOIN_FLAG_MSG,
  PATCH_POINTS_MSG,
  patchGroupSchema,
} from './writeSchemas'

function issuesOf(
  schema: StandardSchemaV1,
  data: unknown,
): readonly StandardSchemaV1.Issue[] {
  const result = schema['~standard'].validate(data) as {
    issues?: readonly StandardSchemaV1.Issue[]
  }
  return result.issues ?? []
}

describe('mapCreateGroupError', () => {
  it('prioriza obrigatórios, depois pontuação e visibilidade', () => {
    expect(mapCreateGroupError({}, issuesOf(createGroupSchema, {}))).toBe(CREATE_REQUIRED_MSG)
    expect(
      mapCreateGroupError(
        { name: 'G', competition_id: 'c', points_exact: 11 },
        issuesOf(createGroupSchema, { name: 'G', competition_id: 'c', points_exact: 11 }),
      ),
    ).toBe(CREATE_POINTS_MSG)
    expect(
      mapCreateGroupError(
        { name: 'G', competition_id: 'c', predictions_visibility: 'x' },
        issuesOf(createGroupSchema, {
          name: 'G',
          competition_id: 'c',
          predictions_visibility: 'x',
        }),
      ),
    ).toBe(CREATE_VISIBILITY_MSG)
    expect(
      mapCreateGroupError(
        { competition_id: 'c', points_exact: 11, predictions_visibility: 'x' },
        issuesOf(createGroupSchema, {
          competition_id: 'c',
          points_exact: 11,
          predictions_visibility: 'x',
        }),
      ),
    ).toBe(CREATE_REQUIRED_MSG)
  })
})

describe('mapJoinGroupError', () => {
  it('sempre devolve a mensagem de código obrigatório', () => {
    expect(mapJoinGroupError({}, issuesOf(joinGroupSchema, {}))).toBe(JOIN_REQUIRED_MSG)
    expect(
      mapJoinGroupError(
        { invite_code: 1 },
        issuesOf(joinGroupSchema, { invite_code: 1 }),
      ),
    ).toBe(JOIN_REQUIRED_MSG)
  })
})

describe('mapPatchGroupError', () => {
  it('prioriza pontuação, depois flag e corpo vazio', () => {
    expect(mapPatchGroupError({}, issuesOf(patchGroupSchema, {}))).toBe(PATCH_EMPTY_MSG)
    expect(
      mapPatchGroupError(
        { points_classified: 11 },
        issuesOf(patchGroupSchema, { points_classified: 11 }),
      ),
    ).toBe(PATCH_POINTS_MSG)
    expect(
      mapPatchGroupError(
        { join_requests_enabled: 'x' },
        issuesOf(patchGroupSchema, { join_requests_enabled: 'x' }),
      ),
    ).toBe(PATCH_JOIN_FLAG_MSG)
    expect(
      mapPatchGroupError(
        { points_classified: 11, join_requests_enabled: 'x' },
        issuesOf(patchGroupSchema, {
          points_classified: 11,
          join_requests_enabled: 'x',
        }),
      ),
    ).toBe(PATCH_POINTS_MSG)
  })
})

describe('mapCreateJoinRequestError', () => {
  it('devolve a mensagem de link (schema só exige objeto)', () => {
    // Objeto válido não gera issues; o mapper só existe para o contrato do validateJson.
    expect(mapCreateJoinRequestError({}, issuesOf(createJoinRequestSchema, 1))).toBe(
      'Link do grupo inválido',
    )
  })
})
