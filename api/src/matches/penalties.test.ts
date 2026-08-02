import { describe, expect, it } from 'vitest'
import { matchGoesToPenalties, parsePenaltyPhases } from './penalties'

describe('parsePenaltyPhases', () => {
  it('should return empty array for null/undefined/empty string', () => {
    expect(parsePenaltyPhases(null)).toEqual([])
    expect(parsePenaltyPhases(undefined)).toEqual([])
    expect(parsePenaltyPhases('')).toEqual([])
  })

  it('should parse valid JSON array of strings', () => {
    expect(parsePenaltyPhases('["LAST_16", "FINAL"]')).toEqual(['LAST_16', 'FINAL'])
  })

  it('should return empty array for non-array JSON', () => {
    expect(parsePenaltyPhases('{"phase": "FINAL"}')).toEqual([])
    expect(parsePenaltyPhases('"FINAL"')).toEqual([])
    expect(parsePenaltyPhases('123')).toEqual([])
    expect(parsePenaltyPhases('null')).toEqual([])
  })

  it('should return empty array for malformed JSON, caught by catch block', () => {
    expect(parsePenaltyPhases('["LAST_16", "FINAL"')).toEqual([]) // missing closing bracket
    expect(parsePenaltyPhases('invalid-json')).toEqual([])
    expect(parsePenaltyPhases('   ')).toEqual([])
  })

  it('should return empty array for an empty JSON array', () => {
    expect(parsePenaltyPhases('[]')).toEqual([])
  })

  it('should handle mixed elements in array', () => {
    expect(parsePenaltyPhases('["LAST_16", 123, null]')).toEqual(['LAST_16'])
  })
})

describe('matchGoesToPenalties', () => {
  it('should return true if matchPhase is in penaltyPhases', () => {
    expect(matchGoesToPenalties(['LAST_16', 'FINAL'], 'FINAL')).toBe(true)
  })

  it('should return false if matchPhase is not in penaltyPhases', () => {
    expect(matchGoesToPenalties(['LAST_16', 'FINAL'], 'SEMI_FINAL')).toBe(false)
  })

  it('should return false if matchPhase is null', () => {
    expect(matchGoesToPenalties(['LAST_16', 'FINAL'], null)).toBe(false)
  })

  it('should handle empty penaltyPhases', () => {
    expect(matchGoesToPenalties([], 'FINAL')).toBe(false)
  })
})
