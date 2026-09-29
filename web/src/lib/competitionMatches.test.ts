import { describe, expect, it, vi, afterEach } from 'vitest'
import { applyDefaultRoundFromMatches } from './competitionMatches'
import { applyDefaultRound } from './rounds'
import type { Match } from '../components/MatchCard'

vi.mock('./rounds', () => ({
  applyDefaultRound: vi.fn()
}))

describe('applyDefaultRoundFromMatches', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('extracts unique rounds in order and calls applyDefaultRound', () => {
    const matches = [
      { round: 'Round 1' },
      { round: 'Round 1' },
      { round: 'Round 2' },
      { round: 'Round 3' },
      { round: 'Round 2' },
    ] as Match[]

    const setRoundIndex = vi.fn()
    applyDefaultRoundFromMatches(matches, 'Round 2', setRoundIndex)

    expect(applyDefaultRound).toHaveBeenCalledWith(
      'Round 2',
      ['Round 1', 'Round 2', 'Round 3'],
      setRoundIndex
    )
  })

  it('handles empty matches array', () => {
    const matches: Match[] = []
    const setRoundIndex = vi.fn()

    applyDefaultRoundFromMatches(matches, null, setRoundIndex)

    expect(applyDefaultRound).toHaveBeenCalledWith(null, [], setRoundIndex)
  })
})
