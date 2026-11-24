import { describe, expect, it } from 'vitest'
import { makeMatch } from '../components/matchFixtures'
import type { Prediction } from '../components/MatchCard/types'
import {
  applyPredictionUpdates,
  buildOptimisticPrediction,
  predictionBase,
  recomputeAllClassified,
  rollbackPredictions,
  type PredictionMap,
} from './predictionOptimistic'

function makePrediction(matchId: string, home: number, away: number, overrides: Partial<Prediction> = {}): Prediction {
  return {
    id: `pred-${matchId}`,
    match_id: matchId,
    predicted_home_score: home,
    predicted_away_score: away,
    predicted_penalty_winner: null,
    classified_points: 0,
    predicted_classified: null,
    points_awarded: 0,
    penalty_points: 0,
    locked: 0,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('predictionOptimistic', () => {
  it('gera a chave base com pênalti nulo ou escolhido', () => {
    expect(predictionBase(1, 0, null)).toBe('1:0:null')
    expect(predictionBase(2, 2, 'home')).toBe('2:2:home')
    expect(predictionBase(0, 0, 'away')).toBe('0:0:away')
  })

  it('monta palpite otimista preservando metadados do existente', () => {
    const match = makeMatch({ id: 'm1', decides_on_penalties: true })
    const existing = makePrediction('m1', 1, 0, {
      id: 'p-42',
      points_awarded: 3,
      classified_points: 2,
      penalty_points: 1,
    })

    const built = buildOptimisticPrediction(existing, match, 1, 1, 'away', undefined)

    expect(built).toMatchObject({
      id: 'p-42',
      match_id: 'm1',
      predicted_home_score: 1,
      predicted_away_score: 1,
      predicted_penalty_winner: 'away',
      predicted_classified: 'away',
      points_awarded: 3,
      classified_points: 2,
      penalty_points: 1,
      locked: 0,
    })
  })

  it('aplica atualizações e reverte ida e volta sem mutar o mapa original', () => {
    const matches = [makeMatch({ id: 'm1' }), makeMatch({ id: 'm2' })]
    const original = makePrediction('m1', 1, 0)
    const confirmed: PredictionMap = new Map([['m1', original]])

    const applied = applyPredictionUpdates(
      confirmed,
      [{ matchId: 'm1', home: 3, away: 1, penaltyWinner: null }],
      matches,
    )

    expect(confirmed.get('m1')).toBe(original)
    expect(applied.get('m1')).toMatchObject({
      predicted_home_score: 3,
      predicted_away_score: 1,
    })

    const reverted = rollbackPredictions(applied, ['m1'], confirmed, matches)
    expect(reverted.get('m1')).toEqual(original)
  })

  it('remove a entrada no rollback quando não havia palpite confirmado', () => {
    const matches = [makeMatch({ id: 'm1' }), makeMatch({ id: 'm2' })]
    const confirmed: PredictionMap = new Map([['m2', makePrediction('m2', 2, 1)]])

    const applied = applyPredictionUpdates(
      confirmed,
      [
        { matchId: 'm1', home: 1, away: 0, penaltyWinner: null },
        { matchId: 'm2', home: 0, away: 0, penaltyWinner: null },
      ],
      matches,
    )
    expect(applied.has('m1')).toBe(true)

    const reverted = rollbackPredictions(applied, ['m1'], confirmed, matches)
    expect(reverted.has('m1')).toBe(false)
    expect(reverted.get('m2')).toMatchObject({
      predicted_home_score: 0,
      predicted_away_score: 0,
    })
  })

  it('recomputa classificado em confronto de ida e volta ao aplicar e ao reverter', () => {
    const leg1 = makeMatch({ id: 'leg1', tie_role: 'leg1' })
    const leg2 = makeMatch({
      id: 'leg2',
      tie_role: 'leg2',
      leg1_match_id: 'leg1',
      decides_on_penalties: true,
    })
    const matches = [leg1, leg2]
    const confirmed: PredictionMap = new Map([
      ['leg1', makePrediction('leg1', 0, 2)],
      ['leg2', makePrediction('leg2', 1, 0, { predicted_penalty_winner: 'away', predicted_classified: 'home' })],
    ])

    const applied = applyPredictionUpdates(
      confirmed,
      [{ matchId: 'leg1', home: 2, away: 0, penaltyWinner: null }],
      matches,
    )
    expect(applied.get('leg2')?.predicted_classified).toBe('away')

    const reverted = rollbackPredictions(applied, ['leg1'], confirmed, matches)
    expect(reverted.get('leg2')?.predicted_classified).toBe('home')
  })

  it('recomputeAllClassified limpa o classificado da volta quando a ida sai do mapa', () => {
    const leg1 = makeMatch({ id: 'leg1', tie_role: 'leg1' })
    const leg2 = makeMatch({
      id: 'leg2',
      tie_role: 'leg2',
      leg1_match_id: 'leg1',
      decides_on_penalties: true,
    })
    const map: PredictionMap = new Map([
      ['leg2', makePrediction('leg2', 1, 0, { predicted_classified: 'home' })],
    ])

    const recomputed = recomputeAllClassified(map, [leg1, leg2])
    expect(recomputed.get('leg2')?.predicted_classified).toBeNull()
  })
})
