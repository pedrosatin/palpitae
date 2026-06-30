import { describe, expect, it, vi } from 'vitest'
import { applyDefaultRound } from './rounds'

describe('rounds', () => {
  describe('applyDefaultRound', () => {
    it('sets the round index when defaultRound is found in the rounds array', () => {
      const setRoundIndex = vi.fn()
      applyDefaultRound('round2', ['round1', 'round2', 'round3'], setRoundIndex)
      expect(setRoundIndex).toHaveBeenCalledWith(1)
      expect(setRoundIndex).toHaveBeenCalledTimes(1)
    })

    it('sets the round index to the last round when defaultRound is not found in the rounds array', () => {
      const setRoundIndex = vi.fn()
      applyDefaultRound('round4', ['round1', 'round2', 'round3'], setRoundIndex)
      expect(setRoundIndex).toHaveBeenCalledWith(2)
      expect(setRoundIndex).toHaveBeenCalledTimes(1)
    })

    it('sets the round index to the last round when defaultRound is null', () => {
      const setRoundIndex = vi.fn()
      applyDefaultRound(null, ['round1', 'round2', 'round3'], setRoundIndex)
      expect(setRoundIndex).toHaveBeenCalledWith(2)
      expect(setRoundIndex).toHaveBeenCalledTimes(1)
    })

    it('sets the round index to the last round when defaultRound is undefined', () => {
      const setRoundIndex = vi.fn()
      applyDefaultRound(undefined, ['round1', 'round2', 'round3'], setRoundIndex)
      expect(setRoundIndex).toHaveBeenCalledWith(2)
      expect(setRoundIndex).toHaveBeenCalledTimes(1)
    })

    it('sets the round index to -1 when defaultRound is not null but rounds is empty', () => {
      const setRoundIndex = vi.fn()
      applyDefaultRound('round1', [], setRoundIndex)
      expect(setRoundIndex).toHaveBeenCalledWith(-1)
      expect(setRoundIndex).toHaveBeenCalledTimes(1)
    })

    it('does not call setRoundIndex when defaultRound is null and rounds is empty', () => {
      const setRoundIndex = vi.fn()
      applyDefaultRound(null, [], setRoundIndex)
      expect(setRoundIndex).not.toHaveBeenCalled()
    })
  })
})
