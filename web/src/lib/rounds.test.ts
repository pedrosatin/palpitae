import { describe, expect, it, vi } from 'vitest'
import { applyDefaultRound, isGroupStageRound } from './rounds'

describe('rounds', () => {
  describe('isGroupStageRound', () => {
    it('returns true for numeric strings', () => {
      expect(isGroupStageRound('1')).toBe(true)
      expect(isGroupStageRound('38')).toBe(true)
      expect(isGroupStageRound('0')).toBe(true)
    })

    it('returns false for non-numeric strings', () => {
      expect(isGroupStageRound('Round of 16')).toBe(false)
      expect(isGroupStageRound('Quarter-finals')).toBe(false)
      expect(isGroupStageRound('Final')).toBe(false)
      expect(isGroupStageRound('1a')).toBe(false)
      expect(isGroupStageRound('a1')).toBe(false)
    })

    it('returns false for empty strings or strings with whitespace', () => {
      expect(isGroupStageRound('')).toBe(false)
      expect(isGroupStageRound(' ')).toBe(false)
      expect(isGroupStageRound(' 1 ')).toBe(false)
    })
  })

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
