import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoundStatusFields } from '../../../lib/dashboardStatus'
import { useStatusClock } from './useStatusClock'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const group = (startTime: string): RoundStatusFields => ({
  id: 'g',
  name: 'Grupo',
  pending_predictions: 1,
  next_deadline: {
    match_id: 'm',
    start_time: startTime,
    round: '35',
    round_label: 'Rodada 35',
    home_team: 'Mirassol',
    away_team: 'Atlético-MG',
  },
  next_match_at: startTime,
})

describe('useStatusClock', () => {
  function setup(refresh: () => Promise<RoundStatusFields[] | null>) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-12T15:00:00Z'))
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const groups = [group('2026-11-12T15:01:00Z')]
    return renderHook(() => useStatusClock(groups, refresh))
  }

  it('busca falha: não tenta de novo', async () => {
    const refresh = vi.fn(async () => null)
    setup(refresh)
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('sair do painel cancela a busca agendada', async () => {
    const refresh = vi.fn(async () => null)
    const { unmount } = setup(refresh)
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(refresh).not.toHaveBeenCalled()
  })
})
