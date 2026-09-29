import { describe, expect, it, vi } from 'vitest'
import { applyDefaultRoundFromMatches } from './competitionMatches'
import * as rounds from './rounds'
import type { Match } from '../components/MatchCard'

describe('applyDefaultRoundFromMatches', () => {
  it('extracts unique rounds and delegates to applyDefaultRound', () => {
    const applyDefaultRoundSpy = vi.spyOn(rounds, 'applyDefaultRound').mockImplementation(() => {})

    const mockMatches = [
      { id: '1', round: 'round1' },
      { id: '2', round: 'round1' },
      { id: '3', round: 'round2' },
    ] as Match[]

    const setRoundIndex = vi.fn()

    applyDefaultRoundFromMatches(mockMatches, 'round2', setRoundIndex)

    expect(applyDefaultRoundSpy).toHaveBeenCalledWith('round2', ['round1', 'round2'], setRoundIndex)

    applyDefaultRoundSpy.mockRestore()
  })
})
