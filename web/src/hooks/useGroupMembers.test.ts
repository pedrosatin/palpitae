import { act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiFetch } from '../lib/api'
import { renderHookWithQuery } from '../test-utils'
import { useGroupMembers, type GroupMember } from './useGroupMembers'

vi.mock('../lib/api', () => ({
  apiFetch: vi.fn(),
}))

const mockApiFetch = vi.mocked(apiFetch)

function mockResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response
}

const members: GroupMember[] = [
  {
    user_id: 'u1',
    display_name: 'Pedro',
    avatar_url: null,
    role: 'owner',
    joined_at: '2026-01-01T00:00:00Z',
    total_points: 20,
    exact_hits: 3,
  },
]

describe('useGroupMembers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches members for the given group', async () => {
    mockApiFetch.mockResolvedValueOnce(mockResponse({ members }))

    const { result } = renderHookWithQuery(() => useGroupMembers('g1'))

    expect(result.current.loading).toBe(true)
    expect(result.current.members).toEqual([])

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.members).toEqual(members)
    expect(result.current.error).toBeNull()
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/groups/g1/members'),
      expect.anything(),
    )
  })

  it('surfaces API failures as error', async () => {
    mockApiFetch.mockResolvedValueOnce(mockResponse({}, false))

    const { result } = renderHookWithQuery(() => useGroupMembers('g1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.members).toEqual([])
    expect(result.current.error).toBe('Erro ao carregar membros')
  })

  it('exposes setMembers for local list updates', async () => {
    mockApiFetch.mockResolvedValueOnce(mockResponse({ members }))

    const { result } = renderHookWithQuery(() => useGroupMembers('g1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setMembers((prev) => prev.filter((m) => m.user_id !== 'u1'))
    })

    await waitFor(() => {
      expect(result.current.members).toEqual([])
    })
  })

  it('refetch falho mantém a lista e não expõe erro', async () => {
    mockApiFetch
      .mockResolvedValueOnce(mockResponse({ members }))
      .mockResolvedValueOnce(mockResponse({}, false))

    const { result } = renderHookWithQuery(() => useGroupMembers('g1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.members).toEqual(members)
    expect(result.current.error).toBeNull()

    await act(async () => {
      await result.current.refetch()
    })

    expect(result.current.members).toEqual(members)
    expect(result.current.error).toBeNull()
  })
})

describe('useGroupMembers, resposta fora do formato', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['sem a lista', {}],
    ['lista que não é array', { members: 'x' }],
    ['membro sem nome', { members: [{ user_id: 'u1', total_points: 0 }] }],
  ])('%s vira erro e mantém a lista vazia', async (_case, body) => {
    mockApiFetch.mockResolvedValueOnce(mockResponse(body))

    const { result } = renderHookWithQuery(() => useGroupMembers('g1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.members).toEqual([])
    expect(result.current.error).toBe('Resposta inesperada do servidor. Tente novamente.')
  })
})
