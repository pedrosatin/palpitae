import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useGroupDetail } from './hooks'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn(),
}))

const mockApiFetch = vi.mocked(apiFetch)

function mockResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response
}

const mockGroup = {
  id: 'g1',
  name: 'Group 1',
  competition_id: 'c1',
  competition_name: 'Competition 1',
  competition_type: 'league',
  is_admin: true,
  invite_code: 'code1',
  created_at: '2023-01-01T00:00:00Z',
  points_exact: 3,
  points_winner: 1,
  predictions_visibility: 'always',
  member_count: 1,
  user_position: 1,
  user_points: 0,
  exact_hits: 0,
}

describe('useGroupDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initially returns loading state and fetches group successfully', async () => {
    mockApiFetch.mockResolvedValueOnce(
      mockResponse({
        group: mockGroup,
      }),
    )

    const { result } = renderHook(() => useGroupDetail('g1'))

    expect(result.current.loading).toBe(true)
    expect(result.current.group).toBeNull()
    expect(result.current.error).toBeNull()

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.group).toEqual(mockGroup)
    expect(result.current.error).toBeNull()
    expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/groups/g1'))
  })

  it('handles API errors correctly when ok is false', async () => {
    mockApiFetch.mockResolvedValueOnce(mockResponse({ error: 'Not Found' }, false))

    const { result } = renderHook(() => useGroupDetail('g1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.group).toBeNull()
    expect(result.current.error).toBe('Grupo não encontrado')
  })

  it('handles network errors correctly', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useGroupDetail('g1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.group).toBeNull()
    expect(result.current.error).toBe('Network error')
  })

  it('does nothing if groupId is undefined', () => {
    const { result } = renderHook(() => useGroupDetail(undefined))

    expect(result.current.loading).toBe(true)
    expect(result.current.group).toBeNull()
    expect(result.current.error).toBeNull()
    expect(mockApiFetch).not.toHaveBeenCalled()
  })
})
