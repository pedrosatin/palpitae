import { act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderHookWithQuery } from '../test-utils'
import { adminQueryKey, useAdminLoad, type AdminLoad } from './useAdminLoad'

type Snapshot = { days: number }

describe('useAdminLoad', () => {
  it('inclui o período na chave da query', () => {
    expect(adminQueryKey('metrics', 7)).toEqual(['admin', 'metrics', 7])
    expect(adminQueryKey('metrics', 7)).not.toEqual(adminQueryKey('metrics', 30))
    expect(adminQueryKey('radar', 30)).not.toEqual(adminQueryKey('metrics', 30))
  })

  it('trocar o filtro cancela a busca anterior via signal', async () => {
    const signals: AbortSignal[] = []
    let resolveFirst: ((value: AdminLoad<Snapshot>) => void) | undefined

    const load = vi.fn((days: number, signal: AbortSignal) => {
      signals.push(signal)
      if (days === 30) {
        return new Promise<AdminLoad<Snapshot>>((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve({ kind: 'ok', data: { days } } satisfies AdminLoad<Snapshot>)
    })

    const { result, rerender } = renderHookWithQuery(
      ({ days }: { days: number }) => useAdminLoad('metrics', days, load),
      { initialProps: { days: 30 } },
    )

    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    expect(result.current.loading).toBe(true)

    rerender({ days: 7 })

    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(signals[0]?.aborted).toBe(true)

    await act(async () => {
      resolveFirst?.({ kind: 'ok', data: { days: 30 } })
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ days: 7 })
    expect(result.current.error).toBeNull()
  })
})
