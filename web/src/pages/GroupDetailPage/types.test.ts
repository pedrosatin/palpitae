import { describe, it, expect } from 'vitest'
import { parseTab, DEFAULT_TAB } from './types'

describe('parseTab', () => {
  it('should return the correct tab when a valid tab value is provided', () => {
    expect(parseTab('predictions')).toBe('predictions')
    expect(parseTab('standings')).toBe('standings')
    expect(parseTab('group-picks')).toBe('group-picks')
    expect(parseTab('leaderboard')).toBe('leaderboard')
    expect(parseTab('members')).toBe('members')
  })

  it('should return the DEFAULT_TAB when an invalid tab value is provided', () => {
    expect(parseTab('invalid-tab')).toBe(DEFAULT_TAB)
  })

  it('should return the DEFAULT_TAB when null is provided', () => {
    expect(parseTab(null)).toBe(DEFAULT_TAB)
  })

  it('should return the DEFAULT_TAB when an empty string is provided', () => {
    expect(parseTab('')).toBe(DEFAULT_TAB)
  })
})
