import { describe, expect, it } from 'vitest'
import { resolveTieRole, TieMatch } from './ties'

describe('resolveTieRole', () => {
  const createMatch = (overrides: Partial<TieMatch>): TieMatch => ({
    id: 'm1',
    competition_id: 'c1',
    phase: 'EIGHTH_FINALS',
    home_team_id: 't1',
    away_team_id: 't2',
    start_time: '2023-01-01T20:00:00Z',
    leg: null,
    ...overrides,
  })

  it('returns leg1 if match.leg is 1', () => {
    const match = createMatch({ leg: 1 })
    expect(resolveTieRole(match, null)).toBe('leg1')
    expect(resolveTieRole(match, createMatch({ id: 'm2' }))).toBe('leg1')
  })

  it('returns leg2 if match.leg is 2', () => {
    const match = createMatch({ leg: 2 })
    expect(resolveTieRole(match, null)).toBe('leg2')
    expect(resolveTieRole(match, createMatch({ id: 'm2' }))).toBe('leg2')
  })

  it('returns single if match has no leg and no partner', () => {
    const match = createMatch({ leg: null })
    expect(resolveTieRole(match, null)).toBe('single')
  })

  it('returns leg1 if match start_time is earlier than partner start_time', () => {
    const match = createMatch({ leg: null, start_time: '2023-01-01T20:00:00Z' })
    const partner = createMatch({ id: 'm2', leg: null, start_time: '2023-01-08T20:00:00Z' })
    expect(resolveTieRole(match, partner)).toBe('leg1')
  })

  it('returns leg2 if match start_time is later than partner start_time', () => {
    const match = createMatch({ leg: null, start_time: '2023-01-08T20:00:00Z' })
    const partner = createMatch({ id: 'm2', leg: null, start_time: '2023-01-01T20:00:00Z' })
    expect(resolveTieRole(match, partner)).toBe('leg2')
  })

  it('returns leg1 if start_times are equal and match id is less than partner id', () => {
    const match = createMatch({ id: 'a', leg: null, start_time: '2023-01-01T20:00:00Z' })
    const partner = createMatch({ id: 'b', leg: null, start_time: '2023-01-01T20:00:00Z' })
    expect(resolveTieRole(match, partner)).toBe('leg1')
  })

  it('returns leg2 if start_times are equal and match id is greater than partner id', () => {
    const match = createMatch({ id: 'b', leg: null, start_time: '2023-01-01T20:00:00Z' })
    const partner = createMatch({ id: 'a', leg: null, start_time: '2023-01-01T20:00:00Z' })
    expect(resolveTieRole(match, partner)).toBe('leg2')
  })
})
