import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'
import { isValidScore, MAX_SCORE } from './scores'
import {
  BULK_EMPTY_MSG,
  BULK_GROUP_MSG,
  BULK_ITEM_MSG,
  BULK_MAX_MSG,
  bulkPredictionSchema,
  IMPORT_DIFF_MSG,
  IMPORT_REQUIRED_MSG,
  importPredictionSchema,
  mapBulkPredictionError,
  mapImportPredictionError,
  mapPutPredictionError,
  mapReplicatePredictionError,
  PUT_REQUIRED_MSG,
  putPredictionSchema,
  REPLICATE_DIFF_MSG,
  REPLICATE_REQUIRED_MSG,
  replicatePredictionSchema,
  SCORE_RANGE_MSG,
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

describe('scores', () => {
  it('aceita inteiros na faixa e recusa o resto', () => {
    expect(isValidScore(0)).toBe(true)
    expect(isValidScore(MAX_SCORE)).toBe(true)
    expect(isValidScore(-1)).toBe(false)
    expect(isValidScore(MAX_SCORE + 1)).toBe(false)
    expect(isValidScore(1.5)).toBe(false)
    expect(isValidScore('1')).toBe(false)
    expect(isValidScore(null)).toBe(false)
  })
})

describe('mapPutPredictionError', () => {
  it('prioriza campos obrigatórios e depois a faixa do placar', () => {
    expect(mapPutPredictionError(null, issuesOf(putPredictionSchema, null))).toBe(
      PUT_REQUIRED_MSG,
    )
    expect(mapPutPredictionError({}, issuesOf(putPredictionSchema, {}))).toBe(PUT_REQUIRED_MSG)
    expect(
      mapPutPredictionError(
        {
          group_id: 'g',
          match_id: 'm',
          predicted_home_score: -1,
          predicted_away_score: 0,
        },
        issuesOf(putPredictionSchema, {
          group_id: 'g',
          match_id: 'm',
          predicted_home_score: -1,
          predicted_away_score: 0,
        }),
      ),
    ).toBe(SCORE_RANGE_MSG)
  })
})

describe('mapBulkPredictionError', () => {
  it('segue a ordem group_id, lista, teto e item', () => {
    expect(mapBulkPredictionError({}, issuesOf(bulkPredictionSchema, {}))).toBe(BULK_GROUP_MSG)
    expect(
      mapBulkPredictionError(
        { group_id: 'g', predictions: [] },
        issuesOf(bulkPredictionSchema, { group_id: 'g', predictions: [] }),
      ),
    ).toBe(BULK_EMPTY_MSG)
    const overMax = {
      group_id: 'g',
      predictions: Array.from({ length: 101 }, (_, i) => ({
        match_id: `m${i}`,
        predicted_home_score: 1,
        predicted_away_score: 0,
      })),
    }
    expect(mapBulkPredictionError(overMax, issuesOf(bulkPredictionSchema, overMax))).toBe(
      BULK_MAX_MSG,
    )
    const badItem = {
      group_id: 'g',
      predictions: [{ match_id: 1, predicted_home_score: 1, predicted_away_score: 0 }],
    }
    expect(mapBulkPredictionError(badItem, issuesOf(bulkPredictionSchema, badItem))).toBe(
      BULK_ITEM_MSG,
    )
  })
})

describe('mapImportPredictionError', () => {
  it('distingue ausente e grupos iguais', () => {
    expect(
      mapImportPredictionError(
        { source_group_id: 'a' },
        issuesOf(importPredictionSchema, { source_group_id: 'a' }),
      ),
    ).toBe(IMPORT_REQUIRED_MSG)
    expect(
      mapImportPredictionError(
        { source_group_id: 'a', target_group_id: 'a' },
        issuesOf(importPredictionSchema, { source_group_id: 'a', target_group_id: 'a' }),
      ),
    ).toBe(IMPORT_DIFF_MSG)
  })
})

describe('mapReplicatePredictionError', () => {
  it('distingue payload inválido e destinos sem outro grupo', () => {
    expect(mapReplicatePredictionError({}, issuesOf(replicatePredictionSchema, {}))).toBe(
      REPLICATE_REQUIRED_MSG,
    )
    expect(
      mapReplicatePredictionError(
        {
          source_group_id: 'src',
          target_group_ids: ['src'],
          match_ids: ['m1'],
        },
        issuesOf(replicatePredictionSchema, {
          source_group_id: 'src',
          target_group_ids: ['src'],
          match_ids: ['m1'],
        }),
      ),
    ).toBe(REPLICATE_DIFF_MSG)
    const overTargets = {
      source_group_id: 'src',
      target_group_ids: Array.from({ length: 11 }, (_, i) => `g${i}`),
      match_ids: ['m1'],
    }
    expect(
      mapReplicatePredictionError(overTargets, issuesOf(replicatePredictionSchema, overTargets)),
    ).toBe(REPLICATE_REQUIRED_MSG)
  })
})
