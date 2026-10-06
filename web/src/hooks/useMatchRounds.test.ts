import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { useMatchRounds } from './useMatchRounds'
import * as ga from '../analytics/ga'
import { makeMatch } from '../components/matchFixtures'

vi.mock('../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

const mockTrackEvent = vi.mocked(ga.trackEvent)

const EVENTS = {
  prev: 'click_test_rodada_anterior',
  next: 'click_test_proxima_rodada',
}

function useHarness(matches: ReturnType<typeof makeMatch>[], initialIndex = 0) {
  const [roundIndex, setRoundIndex] = useState(initialIndex)
  return useMatchRounds(matches, roundIndex, setRoundIndex, EVENTS)
}

describe('useMatchRounds', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear()
  })

  it('groups matches by round and exposes the selected slice', () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1' }),
      makeMatch({ id: 'm2', round: '2' }),
      makeMatch({ id: 'm3', round: '1' }),
    ]

    const { result } = renderHook(() => useHarness(matches))

    expect(result.current.roundKeys).toEqual(['1', '2'])
    expect(result.current.selectedRound).toBe('1')
    expect(result.current.roundMatches.map((m) => m.id)).toEqual(['m1', 'm3'])
    expect(result.current.labelFor('2')).toBe('Rodada 2')
  })

  it('leaves postponed matches already seen started out of the open-pick hint', () => {
    const { result } = renderHook(() =>
      useHarness([
        makeMatch({ id: 'm1', round: '1', postponed: 1, locked_at: '2026-08-01T20:00:00Z' }),
        makeMatch({ id: 'm2', round: '1', postponed: 1 }),
        makeMatch({ id: 'm3', round: '2', postponed: 1, locked_at: '2026-08-01T20:00:00Z' }),
      ]),
    )
    expect(result.current.postponedByRound.get('1')).toBe(1)
    expect(result.current.postponedByRound.has('2')).toBe(false)
  })

  it('counts postponed matches per round', () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', postponed: 1 }),
      makeMatch({ id: 'm2', round: '1' }),
      makeMatch({ id: 'm3', round: '2', postponed: true }),
    ]

    const { result } = renderHook(() => useHarness(matches))

    expect(result.current.postponedByRound.get('1')).toBe(1)
    expect(result.current.postponedByRound.get('2')).toBe(1)
    expect(result.current.postponedByRound.has('3')).toBe(false)
  })

  it('navigates with the configured analytics events', () => {
    const matches = [makeMatch({ id: 'm1', round: '1' }), makeMatch({ id: 'm2', round: '2' })]

    const { result } = renderHook(() => useHarness(matches))

    act(() => {
      result.current.next()
    })
    expect(result.current.selectedRound).toBe('2')
    expect(mockTrackEvent).toHaveBeenCalledWith('click_test_proxima_rodada', { round: '2' })

    act(() => {
      result.current.prev()
    })
    expect(result.current.selectedRound).toBe('1')
    expect(mockTrackEvent).toHaveBeenCalledWith('click_test_rodada_anterior', { round: '1' })
  })

  it('clamps index when matches become empty', () => {
    const { result } = renderHook(() => useHarness([]))

    expect(result.current.roundKeys).toEqual([])
    expect(result.current.roundMatches).toEqual([])
    expect(result.current.safeIndex).toBe(-1)
  })
})
