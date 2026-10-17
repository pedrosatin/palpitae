import { describe, expect, it } from 'vitest'
import { makeMatch } from '../components/matchFixtures'
import { collectRoundDrafts } from './predictionDrafts'
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
