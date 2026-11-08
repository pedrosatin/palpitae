import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNow } from './useNow'

afterEach(() => vi.useRealTimers())

describe('useNow', () => {
  it('renova a hora a cada intervalo', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'))
    const { result } = renderHook(() => useNow(30_000))
    const first = result.current

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(result.current - first).toBe(30_000)
  })

  it('para o relógio ao desmontar', () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useNow(30_000))

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
