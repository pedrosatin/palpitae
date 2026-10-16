import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { useDashboardGroups } from './useDashboardGroups'
import { apiFetch } from '../../../lib/api'
import { invalidateApiCache } from '../../../lib/api-cache'

vi.mock('../../../lib/api', () => ({
  apiFetch: vi.fn(),
}))

const mockApiFetch = vi.mocked(apiFetch)

function mockResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response
}

const mockGroups = [
  {
    id: 'g1',
    name: 'Group 1',
    description: '',
    invite_code: 'code1',
    owner_id: 'u1',
    created_at: '',
    role: 'owner',
    user_points: 0,
    member_count: 1,
    recent_members: [],
  },
]

describe('useDashboardGroups', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockApiFetch.mockReset()
    invalidateApiCache()
  })

  it('fetches and returns groups successfully', async () => {
    mockApiFetch.mockResolvedValueOnce(
      mockResponse({
        groups: mockGroups,
        matched_invite_group_id: null,
      }),
    )

    const { result } = renderHook(() => useDashboardGroups({ userId: 'u1' }), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    })

    expect(result.current.loading).toBe(true)
    expect(result.current.groups).toEqual([])

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.groups).toEqual(mockGroups)
    expect(result.current.error).toBeNull()
    expect(result.current.joinOpen).toBe(false)
    expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/groups'), {
      cache: 'no-store',
    })
  })

  it('isolates cached groups between accounts while reusing them within one account', async () => {
    mockApiFetch.mockResolvedValueOnce(
      mockResponse({ groups: mockGroups, matched_invite_group_id: null }),
    )
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter>{children}</MemoryRouter>
    )
    const first = renderHook(() => useDashboardGroups({ userId: 'u1' }), { wrapper })
    await waitFor(() => expect(first.result.current.groups).toEqual(mockGroups))
    first.unmount()

    const sameAccount = renderHook(() => useDashboardGroups({ userId: 'u1' }), { wrapper })
    await waitFor(() => expect(sameAccount.result.current.groups).toEqual(mockGroups))
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
    sameAccount.unmount()

    mockApiFetch.mockResolvedValueOnce(mockResponse({ groups: [], matched_invite_group_id: null }))
    const second = renderHook(() => useDashboardGroups({ userId: 'u2' }), { wrapper })
    await waitFor(() => expect(second.result.current.loading).toBe(false))
    expect(second.result.current.groups).toEqual([])
    expect(mockApiFetch).toHaveBeenCalledTimes(2)
  })

  it('handles API errors correctly', async () => {
    mockApiFetch.mockResolvedValueOnce(mockResponse({ error: 'Server Error' }, false))

    const { result } = renderHook(() => useDashboardGroups({ userId: 'u1' }), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.groups).toEqual([])
    expect(result.current.error).toBe('Falha ao carregar grupos')
  })

  it('sets joinOpen to true if normalizedPendingInvite has no matched group', async () => {
    mockApiFetch.mockResolvedValueOnce(
      mockResponse({
        groups: mockGroups,
        matched_invite_group_id: null,
      }),
    )

    const { result } = renderHook(
      () => useDashboardGroups({ userId: 'u1', normalizedPendingInvite: 'some-code' }),
      {
        wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
      },
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.joinOpen).toBe(true)
    expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('invite_code=some-code'), {
      cache: 'no-store',
    })
  })

  it('sets joinOpen to false if normalizedPendingInvite has a matched group', async () => {
    mockApiFetch.mockResolvedValueOnce(
      mockResponse({
        groups: mockGroups,
        matched_invite_group_id: 'g1',
      }),
    )

    const { result } = renderHook(
      () => useDashboardGroups({ userId: 'u1', normalizedPendingInvite: 'some-code' }),
      {
        wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
      },
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.joinOpen).toBe(false)
  })

  it('forces refresh when location.state.refreshGroups is true', async () => {
    mockApiFetch.mockResolvedValue(
      mockResponse({
        groups: mockGroups,
        matched_invite_group_id: null,
      }),
    )

    const { result } = renderHook(() => useDashboardGroups({ userId: 'u1' }), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={[{ pathname: '/', state: { refreshGroups: true } }]}>
          {children}
        </MemoryRouter>
      ),
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cache: 'no-store' }),
    )
  })
})
