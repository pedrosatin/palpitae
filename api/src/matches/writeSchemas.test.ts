import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'
import {
  mapSyncBodyError,
  SYNC_DATES_MSG,
  SYNC_REQUIRED_MSG,
  SYNC_SEASON_MSG,
  syncBodySchema,
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

describe('syncBodySchema', () => {
  it('aceita competition truthy de outro tipo e matchday sem validação', () => {
    expect(
      syncBodySchema['~standard'].validate({
        competition: { a: 1 },
        season: 2026,
        matchday: 'abc',
      }),
    ).toMatchObject({
      value: { competition: { a: 1 }, season: 2026, matchday: 'abc' },
    })
  })
})

describe('mapSyncBodyError', () => {
  it('prioriza obrigatórios, season numérico e dates', () => {
    expect(mapSyncBodyError({}, issuesOf(syncBodySchema, {}))).toBe(SYNC_REQUIRED_MSG)
    expect(mapSyncBodyError([], issuesOf(syncBodySchema, []))).toBe(SYNC_REQUIRED_MSG)
    expect(mapSyncBodyError(42, issuesOf(syncBodySchema, 42))).toBe(SYNC_REQUIRED_MSG)
    expect(
      mapSyncBodyError(
        { competition: 'WC', season: '2026' },
        issuesOf(syncBodySchema, { competition: 'WC', season: '2026' }),
      ),
    ).toBe(SYNC_SEASON_MSG)
    expect(
      mapSyncBodyError(
        { competition: 'WC', season: 2026, dates: ['2026-01-01'] },
        issuesOf(syncBodySchema, { competition: 'WC', season: 2026, dates: ['2026-01-01'] }),
      ),
    ).toBe(SYNC_DATES_MSG)
    expect(
      mapSyncBodyError(
        { competition: 'WC', season: 'x', dates: [1] },
        issuesOf(syncBodySchema, { competition: 'WC', season: 'x', dates: [1] }),
      ),
    ).toBe(SYNC_SEASON_MSG)
    expect(
      mapSyncBodyError({ dates: [1] }, issuesOf(syncBodySchema, { dates: [1] })),
    ).toBe(SYNC_REQUIRED_MSG)
  })
})
