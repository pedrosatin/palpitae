import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeMatch } from './matchFixtures'

describe('makeMatch', () => {
  const MOCK_TIME = new Date('2024-01-01T12:00:00Z').getTime()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(MOCK_TIME)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns default match properties when no overrides provided', () => {
    const match = makeMatch()

    expect(match).toEqual(expect.objectContaining({
      id: 'm1',
      status: 'scheduled',
      home_score: null,
      away_score: null,
      phase: 'group',
      round: '1',
      round_label: 'Rodada 1',
      group_name: null,
      home_team_id: 'ht-1',
      home_team_name: 'Brasil',
      home_team_short_name: 'BRA',
      home_team_logo: '/bra.png',
      away_team_id: 'at-1',
      away_team_name: 'Argentina',
      away_team_short_name: 'ARG',
      away_team_logo: '/arg.png',
    }))
  })

  it('calculates default start_time as 1 hour in the future when scheduled', () => {
    const match = makeMatch()
    const oneHourLater = new Date(MOCK_TIME + 3_600_000).toISOString()
    expect(match.start_time).toBe(oneHourLater)
  })

  it('calculates default start_time as 1 hour in the past when finished', () => {
    const match = makeMatch({ status: 'finished' })
    const oneHourBefore = new Date(MOCK_TIME - 3_600_000).toISOString()
    expect(match.start_time).toBe(oneHourBefore)
  })

  it('allows overriding start_time explicitly', () => {
    const customTime = '2024-12-31T23:59:59Z'
    const match = makeMatch({ start_time: customTime })
    expect(match.start_time).toBe(customTime)
  })

  it('allows overriding scalar properties', () => {
    const match = makeMatch({
      id: 'custom-id',
      home_team_name: 'Custom Home',
      away_team_short_name: 'CUS'
    })

    expect(match.id).toBe('custom-id')
    expect(match.home_team_name).toBe('Custom Home')
    expect(match.away_team_short_name).toBe('CUS')
  })

  it('derives round_label from an overridden round', () => {
    const match = makeMatch({ round: '5' })
    expect(match.round).toBe('5')
    expect(match.round_label).toBe('Rodada 5')
  })

  it('allows explicit override of round_label independently of round', () => {
    const match = makeMatch({ round: '2', round_label: 'Semifinal' })
    expect(match.round).toBe('2')
    expect(match.round_label).toBe('Semifinal')
  })
})
