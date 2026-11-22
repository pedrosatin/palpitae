import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { useRoundNav } from './useRoundNav'
import * as ga from '../analytics/ga'

vi.mock('../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

const mockTrackEvent = vi.mocked(ga.trackEvent)

const EVENTS = { prev: 'click_test_anterior', next: 'click_test_proxima' }

function useHarness(roundKeys: string[], initialIndex: number) {
  const [index, setIndex] = useState(initialIndex)
  return { index, ...useRoundNav(roundKeys, index, setIndex, EVENTS) }
}

describe('useRoundNav', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear()
  })

  it('avança e volta registrando a rodada de destino', () => {
    const { result } = renderHook(() => useHarness(['1', '2', '3'], 1))

    act(() => result.current.next())
    expect(mockTrackEvent).toHaveBeenLastCalledWith('click_test_proxima', { round: '3' })
    expect(result.current.index).toBe(2)

    act(() => result.current.prev())
    expect(mockTrackEvent).toHaveBeenLastCalledWith('click_test_anterior', { round: '2' })
    expect(result.current.index).toBe(1)
  })

  it('para nas pontas e registra a própria rodada', () => {
    const { result } = renderHook(() => useHarness(['1', '2'], 0))

    act(() => result.current.prev())
    expect(mockTrackEvent).toHaveBeenLastCalledWith('click_test_anterior', { round: '1' })
    expect(result.current.index).toBe(0)

    act(() => result.current.next())
    act(() => result.current.next())
    expect(mockTrackEvent).toHaveBeenLastCalledWith('click_test_proxima', { round: '2' })
    expect(result.current.index).toBe(1)
  })
})
