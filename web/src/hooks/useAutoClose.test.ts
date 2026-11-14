import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOOLTIP_TIMEOUT_MS, useAutoClose } from './useAutoClose'

describe('useAutoClose', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fecha após o tempo configurado quando está aberto', () => {
    vi.useFakeTimers()
    const close = vi.fn()

    renderHook(() => useAutoClose(true, close, TOOLTIP_TIMEOUT_MS))

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_TIMEOUT_MS - 1)
    })
    expect(close).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('não agenda fechamento quando está fechado', () => {
    vi.useFakeTimers()
    const close = vi.fn()

    renderHook(() => useAutoClose(false, close, TOOLTIP_TIMEOUT_MS))

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_TIMEOUT_MS)
    })
    expect(close).not.toHaveBeenCalled()
  })

  it('reinicia o timer ao fechar e abrir novamente', () => {
    vi.useFakeTimers()
    const close = vi.fn()

    const { rerender } = renderHook(({ open }) => useAutoClose(open, close, TOOLTIP_TIMEOUT_MS), {
      initialProps: { open: true },
    })

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_TIMEOUT_MS - 100)
    })
    rerender({ open: false })
    rerender({ open: true })

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_TIMEOUT_MS - 100)
    })
    expect(close).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('mantém o timer em andamento quando o callback muda ao re-renderizar', () => {
    vi.useFakeTimers()
    const firstClose = vi.fn()
    const secondClose = vi.fn()

    const { rerender } = renderHook(({ close }) => useAutoClose(true, close, TOOLTIP_TIMEOUT_MS), {
      initialProps: { close: firstClose },
    })

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_TIMEOUT_MS - 500)
    })
    rerender({ close: secondClose })

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(firstClose).not.toHaveBeenCalled()
    expect(secondClose).toHaveBeenCalledTimes(1)
  })

  it('cancela o timer ao desmontar', () => {
    vi.useFakeTimers()
    const close = vi.fn()

    const { unmount } = renderHook(() => useAutoClose(true, close, TOOLTIP_TIMEOUT_MS))
    unmount()

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_TIMEOUT_MS)
    })
    expect(close).not.toHaveBeenCalled()
  })
})
