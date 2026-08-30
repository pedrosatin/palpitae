import { describe, it, expect } from 'vitest'
import { TABS, DEFAULT_TAB, TAB_LABELS, parseTab } from './types'

describe('GroupDetailPage types', () => {
  it('should define the correct TABS', () => {
    expect(TABS).toEqual(['predictions', 'standings', 'group-picks', 'leaderboard', 'members'])
  })

  it('should define the correct DEFAULT_TAB', () => {
    expect(DEFAULT_TAB).toBe('predictions')
  })

  it('should define the correct TAB_LABELS', () => {
    expect(TAB_LABELS).toEqual({
      predictions: 'Palpitar',
      standings: 'Tabela',
      'group-picks': 'Grupo',
      leaderboard: 'Ranking',
      members: 'Membros',
    })
  })

  describe('parseTab', () => {
    it('should return the passed tab if valid', () => {
      expect(parseTab('standings')).toBe('standings')
      expect(parseTab('members')).toBe('members')
    })

    it('should return the default tab if passed null', () => {
      expect(parseTab(null)).toBe('predictions')
    })

    it('should return the default tab if passed an invalid tab', () => {
      expect(parseTab('invalid_tab')).toBe('predictions')
    })
  })
})
