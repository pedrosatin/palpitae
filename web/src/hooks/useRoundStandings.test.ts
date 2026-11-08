import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiFetch } from '../lib/api'
import { useRoundStandings } from './useRoundStandings'

vi.mock('../lib/api', () => ({
  apiFetch: vi.fn(),
}))

const mockApiFetch = vi.mocked(apiFetch)

function mockResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response
}

describe('useRoundStandings', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
  })

  it('carrega a rodada do grupo', async () => {
    const standings = [{ user_id: 'u1', round_points: 7, position_change: 2 }]
    mockApiFetch.mockResolvedValueOnce(mockResponse({ round: '34', standings }))

    const { result } = renderHook(() => useRoundStandings('g1'))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.round).toBe('34')
    expect(result.current.standings).toEqual(standings)
    expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/groups/g1/round-standings'))
  })

  it('trata resposta de erro como grupo sem rodada', async () => {
    mockApiFetch.mockResolvedValueOnce(mockResponse({ error: 'x' }, false))

    const { result } = renderHook(() => useRoundStandings('g1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.round).toBeNull()
    expect(result.current.standings).toEqual([])
  })

  it('trata falha de rede como grupo sem rodada', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('offline'))

    const { result } = renderHook(() => useRoundStandings('g1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.round).toBeNull()
  })

  it('descarta a resposta de um grupo anterior', async () => {
    let resolveOld: (r: Response) => void = () => {}
    mockApiFetch.mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
    mockApiFetch.mockReturnValueOnce(new Promise(() => {}))

    const { result, rerender } = renderHook(({ id }) => useRoundStandings(id), {
      initialProps: { id: 'antigo' },
    })
    rerender({ id: 'novo' })

    await act(async () => {
      resolveOld(
        mockResponse({
          round: '9',
          standings: [{ user_id: 'u1', round_points: 3, position_change: 1 }],
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(result.current.loading).toBe(true)
    expect(result.current.round).toBeNull()
    expect(result.current.standings).toEqual([])
  })
})
