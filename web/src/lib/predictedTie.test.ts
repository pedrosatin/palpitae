import { describe, expect, it } from 'vitest'
import { makeMatch } from '../components/matchFixtures'
import { collectRoundDrafts } from './predictionDrafts'
import { predictedTieScore, needsPenaltyPick, predictedClassified } from './predictedTie'
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

describe('predictedTieScore', () => {
  it('returns just home and away if not leg2', () => {
    const match = makeMatch({ tie_role: 'leg1' })
    expect(predictedTieScore(match, 2, 1)).toEqual({ home: 2, away: 1 })
    expect(
      predictedTieScore(match, 2, 1, { predicted_home_score: 3, predicted_away_score: 0 } as any),
    ).toEqual({ home: 2, away: 1 })
  })

  it('returns null if leg2 but leg1 prediction is missing', () => {
    const match = makeMatch({ tie_role: 'leg2' })
    expect(predictedTieScore(match, 2, 1)).toBeNull()
  })

  it('calculates aggregate correctly for leg2', () => {
    const match = makeMatch({ tie_role: 'leg2' })
    // leg2 home is leg1 away. leg2 away is leg1 home
    const leg1 = { predicted_home_score: 2, predicted_away_score: 1 } as any
    // leg2 score: home 1, away 1
    // total: leg2_home(1) + leg1_away(1) = 2. leg2_away(1) + leg1_home(2) = 3.
    expect(predictedTieScore(match, 1, 1, leg1)).toEqual({ home: 2, away: 3 })
  })
})

describe('needsPenaltyPick', () => {
  it('returns false if match does not decide on penalties or is leg1', () => {
    const match1 = makeMatch({ decides_on_penalties: false, tie_role: undefined })
    expect(needsPenaltyPick(match1, 1, 1)).toBe(false)
    const match2 = makeMatch({ decides_on_penalties: true, tie_role: 'leg1' })
    expect(needsPenaltyPick(match2, 1, 1)).toBe(false)
  })

  it('returns false if score is not tied', () => {
    const match = makeMatch({ decides_on_penalties: true, tie_role: undefined })
    expect(needsPenaltyPick(match, 2, 1)).toBe(false)
  })

  it('returns true if score is tied', () => {
    const match = makeMatch({ decides_on_penalties: true, tie_role: undefined })
    expect(needsPenaltyPick(match, 1, 1)).toBe(true)
  })

  it('returns true if aggregate score is tied for leg2', () => {
    const match = makeMatch({ decides_on_penalties: true, tie_role: 'leg2' })
    const leg1 = { predicted_home_score: 1, predicted_away_score: 2 } as any
    // leg2 score: home 1, away 0
    // total: home: 1 + 2 = 3. away: 0 + 1 = 1 -> NOT TIED
    expect(needsPenaltyPick(match, 1, 0, leg1)).toBe(false)

    // total: home 1+2 = 3. away: 2+1=3 -> TIED
    expect(needsPenaltyPick(match, 1, 2, leg1)).toBe(true)
  })

  it('returns false for leg2 if leg1 is missing', () => {
    const match = makeMatch({ decides_on_penalties: true, tie_role: 'leg2' })
    expect(needsPenaltyPick(match, 1, 1)).toBe(false)
  })
})

describe('predictedClassified', () => {
  it('returns null if leg1 or does not decide on penalties', () => {
    const match1 = makeMatch({ tie_role: 'leg1' })
    expect(predictedClassified(match1, 2, 0, null)).toBeNull()
    const match2 = makeMatch({ tie_role: undefined, decides_on_penalties: false })
    expect(predictedClassified(match2, 2, 0, null)).toBeNull()
  })

  it('returns null if predictedTieScore returns null', () => {
    const match = makeMatch({ tie_role: 'leg2', decides_on_penalties: true })
    expect(predictedClassified(match, 1, 1, null)).toBeNull()
  })

  it('returns home if home wins', () => {
    const match = makeMatch({ tie_role: undefined, decides_on_penalties: true })
    expect(predictedClassified(match, 2, 1, null)).toBe('home')
  })

  it('returns away if away wins', () => {
    const match = makeMatch({ tie_role: undefined, decides_on_penalties: true })
    expect(predictedClassified(match, 1, 2, null)).toBe('away')
  })

  it('returns winner if tied', () => {
    const match = makeMatch({ tie_role: undefined, decides_on_penalties: true })
    expect(predictedClassified(match, 1, 1, 'home')).toBe('home')
    expect(predictedClassified(match, 1, 1, 'away')).toBe('away')
    expect(predictedClassified(match, 1, 1, null)).toBeNull()
  })
})
