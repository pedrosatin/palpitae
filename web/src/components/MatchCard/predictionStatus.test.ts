import { describe, expect, it } from 'vitest'
import { predictionStatus } from './predictionStatus'
import type { Prediction } from './types'

const saved: Prediction = {
  id: 'p1',
  match_id: 'm1',
  predicted_home_score: 2,
  predicted_away_score: 2,
  predicted_penalty_winner: 'home',
  points_awarded: 0,
  locked: 0,
  updated_at: '',
}

const base = { penaltyWinner: null, showPenaltyPicker: false } as const

describe('predictionStatus', () => {
  it('sem palpite e campos vazios é "empty"', () => {
    expect(predictionStatus({ ...base, prediction: undefined, home: '', away: '' })).toBe('empty')
  })

  it('sem palpite, um campo preenchido já é "dirty"', () => {
    expect(predictionStatus({ ...base, prediction: undefined, home: '1', away: '' })).toBe('dirty')
  })

  it('palpite salvo com os mesmos campos é "saved"', () => {
    expect(predictionStatus({ ...base, prediction: saved, home: '2', away: '2' })).toBe('saved')
  })

  it('palpite salvo 0×0 com um campo apagado é "dirty"', () => {
    const zero = { ...saved, predicted_home_score: 0, predicted_away_score: 0 }
    expect(predictionStatus({ ...base, prediction: zero, home: '', away: '0' })).toBe('dirty')
  })

  it('pênalti trocado conta só com a escolha na tela', () => {
    const input = { prediction: saved, home: '2', away: '2', penaltyWinner: 'away' as const }
    expect(predictionStatus({ ...input, showPenaltyPicker: true })).toBe('dirty')
    expect(predictionStatus({ ...input, showPenaltyPicker: false })).toBe('saved')
  })

  it('palpite salvo sem pênalti que passou a pedir a escolha é "penalty"', () => {
    const noPenalty = { ...saved, predicted_penalty_winner: null }
    const input = { prediction: noPenalty, home: '2', away: '2', penaltyWinner: null }
    expect(predictionStatus({ ...input, showPenaltyPicker: true })).toBe('penalty')
    expect(predictionStatus({ ...input, showPenaltyPicker: false })).toBe('saved')
  })

  it('sem palpite, empate com a escolha na tela e sem vencedor é "penalty"', () => {
    const input = { prediction: undefined, home: '1', away: '1', penaltyWinner: null }
    expect(predictionStatus({ ...input, showPenaltyPicker: true })).toBe('penalty')
  })
})
