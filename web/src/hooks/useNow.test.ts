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

  it('renova a hora no início de um jogo, sem esperar o intervalo', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-14T21:29:50Z'))
    const kickoff = '2026-11-14T21:30:00Z'
    const { result } = renderHook(() => useNow(30_000, [kickoff]))

    act(() => {
      vi.advanceTimersByTime(9_999)
    })
    expect(result.current).toBe(Date.parse('2026-11-14T21:29:50Z'))

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(Date.parse(kickoff))
  })

  it('ignora horários que já passaram', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-14T21:29:50Z'))
    renderHook(() => useNow(30_000, ['2026-11-14T21:00:00Z']))

    // Só o intervalo fica armado.
    expect(vi.getTimerCount()).toBe(1)
  })

  it('limpa o timer do início ao desmontar', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-14T21:29:50Z'))
    const { unmount } = renderHook(() => useNow(30_000, ['2026-11-14T21:30:00Z']))
    expect(vi.getTimerCount()).toBe(2)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('para o relógio ao desmontar', () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useNow(30_000))

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
