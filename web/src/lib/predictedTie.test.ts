import { describe, expect, it } from 'vitest'
import { makeMatch } from '../components/matchFixtures'
import { collectRoundDrafts } from './predictionDrafts'
import {
  needsPenaltyPick,
  predictedClassified,
  predictedTieScore,
} from './predictedTie'
import type { Prediction } from '../components/MatchCard'

describe('salvar ida e volta no mesmo lote', () => {
  it('usa a ida em edição mesmo quando a volta vem antes no lote', () => {
    const ida = makeMatch({ id: 'ida', tie_role: 'leg1', decides_on_penalties: false })
    const volta = makeMatch({
      id: 'volta',
      tie_role: 'leg2',
      leg1_match_id: 'ida',
      decides_on_penalties: true,
    })
    const predictions = new Map<string, Prediction>()
    const drafts = new Map([
      ['ida', { home: '2', away: '0' }],
      ['volta', { home: '2', away: '0' }],
    ])
    const pending = collectRoundDrafts({
      roundMatches: [volta, ida],
      drafts,
      predictions,
      penaltyDrafts: new Map([['volta', 'home']]),
    })
    expect(pending).toHaveLength(2)
    expect(pending[0]).toMatchObject({ match_id: 'volta', predicted_penalty_winner: 'home' })
    expect(
      collectRoundDrafts({
        roundMatches: [volta, ida],
        drafts,
        predictions,
        penaltyDrafts: new Map(),
      }),
    ).toHaveLength(1)
  })
})

describe('predictedClassified sem tie_role', () => {
  it('classifica pelo placar quando a fase decide nos pênaltis', () => {
    const match = makeMatch({ decides_on_penalties: true })
    expect(predictedClassified(match, 2, 1, null)).toBe('home')
    expect(predictedClassified(match, 1, 2, null)).toBe('away')
  })

  it('usa o vencedor dos pênaltis no empate', () => {
    const match = makeMatch({ decides_on_penalties: true })
    expect(predictedClassified(match, 1, 1, 'home')).toBe('home')
    expect(predictedClassified(match, 1, 1, 'away')).toBe('away')
    expect(predictedClassified(match, 1, 1, null)).toBeNull()
  })

  it('não classifica quando a fase não decide nos pênaltis', () => {
    const match = makeMatch({ decides_on_penalties: false })
    expect(predictedClassified(match, 2, 0, null)).toBeNull()
  })
})

describe('needsPenaltyPick sem tie_role', () => {
  it('pede pênalti no empate quando a fase decide nos pênaltis', () => {
    const match = makeMatch({ decides_on_penalties: true })
    expect(needsPenaltyPick(match, 1, 1)).toBe(true)
    expect(needsPenaltyPick(match, 2, 1)).toBe(false)
  })

  it('não pede quando a fase não decide nos pênaltis', () => {
    const match = makeMatch({ decides_on_penalties: false })
    expect(needsPenaltyPick(match, 1, 1)).toBe(false)
  })
})

describe('predictedTieScore sem tie_role', () => {
  it('devolve o placar do jogo', () => {
    const match = makeMatch({ decides_on_penalties: true })
    expect(predictedTieScore(match, 2, 1)).toEqual({ home: 2, away: 1 })
  })
})
