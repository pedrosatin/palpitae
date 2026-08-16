import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMemberPredictions } from './useMemberPredictions'
import { config } from '../../../config'
import type { UserPrediction } from '../types'

describe('useMemberPredictions', () => {
  const mockGroupId = 'group123'
  const mockUserId = 'user456'

  const mockPrediction: UserPrediction = {
    match_id: 'm1',
    predicted_home_score: null,
    predicted_away_score: null,
    points_awarded: null,
    match_status: 'SCHEDULED',
    match_start_time: '2024-01-01T00:00:00Z',
    home_score: null,
    away_score: null,
    round: '1',
    round_label: 'Rodada 1',
    group_name: null,
    home_team_name: 'Home',
    home_team_short_name: 'HOM',
    home_team_logo: '',
    away_team_name: 'Away',
    away_team_short_name: 'AWA',
    away_team_logo: '',
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('initializes with loading state and default values', () => {
    const fetchMock = vi.mocked(fetch).mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useMemberPredictions(mockGroupId, mockUserId))

    expect(result.current.modalLoading).toBe(true)
    expect(result.current.modalPredictions).toEqual([])
    expect(result.current.modalError).toBeNull()
    expect(result.current.modalRoundIndex).toBe(0)
    expect(fetchMock).toHaveBeenCalledWith(
      `${config.apiUrl}/predictions/user?group_id=${mockGroupId}&user_id=${mockUserId}`,
      { credentials: 'include' },
    )
  })

  it('handles successful fetch', async () => {
    const mockResponse = {
      predictions: [mockPrediction],
      default_round: '1',
    }

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    const { result } = renderHook(() => useMemberPredictions(mockGroupId, mockUserId))

    await waitFor(() => {
      expect(result.current.modalLoading).toBe(false)
    })

    expect(result.current.modalError).toBeNull()
    expect(result.current.modalPredictions).toEqual([mockPrediction])
    expect(result.current.modalRoundIndex).toBe(0) // applyDefaultRound finds '1' at index 0 of ['1']
  })

  it('handles API error (!ok)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
    } as Response)

    const { result } = renderHook(() => useMemberPredictions(mockGroupId, mockUserId))

    await waitFor(() => {
      expect(result.current.modalLoading).toBe(false)
    })

    expect(result.current.modalError).toBe('Erro ao carregar palpites')
    expect(result.current.modalPredictions).toEqual([])
  })

  it('handles network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useMemberPredictions(mockGroupId, mockUserId))

    await waitFor(() => {
      expect(result.current.modalLoading).toBe(false)
    })

    expect(result.current.modalError).toBe('Network error')
    expect(result.current.modalPredictions).toEqual([])
  })

  it('skips state updates if unmounted while fetching', async () => {
    let resolveFetch: (val: any) => void
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve
    })

    vi.mocked(fetch).mockReturnValue(fetchPromise as Promise<Response>)

    const { result, unmount } = renderHook(() => useMemberPredictions(mockGroupId, mockUserId))

    expect(result.current.modalLoading).toBe(true)

    // Unmount before the fetch resolves
    unmount()

    // Now resolve the fetch
    resolveFetch!({
      ok: true,
      json: () => Promise.resolve({ predictions: [mockPrediction], default_round: '1' }),
    } as Response)

    // We can't wait for state change easily since we expect NO change,
    // so we wait a tick to ensure promises resolve.
    await new Promise((r) => setTimeout(r, 0))

    // State should not have changed because unmount set mounted = false
    // Note: React might still return the last known state from result.current,
    // but what we really want to ensure is no "act" warnings about updating unmounted components.
    // We can just verify the values haven't updated to the success ones.
    expect(result.current.modalPredictions).toEqual([])
  })
})
