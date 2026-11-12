import { act, renderHook, waitFor } from '@testing-library/react'
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

  it('limpa o erro quando a nova carga dá certo', async () => {
    mockApiFetch
      .mockResolvedValueOnce(mockResponse({ error: 'Server Error' }, false))
      .mockResolvedValueOnce(mockResponse({ groups: mockGroups, matched_invite_group_id: null }))

    const { result } = renderHook(() => useDashboardGroups({ userId: 'u1' }), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    })
    await waitFor(() => expect(result.current.error).toBe('Falha ao carregar grupos'))

    act(() => result.current.fetchGroups(true))
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.groups).toEqual(mockGroups)
  })

  it('descarta a resposta de uma carga anterior que chega por último', async () => {
    let resolveOld!: (res: Response) => void
    mockApiFetch
      .mockReturnValueOnce(new Promise<Response>((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce(mockResponse({ groups: mockGroups, matched_invite_group_id: null }))

    const { result } = renderHook(() => useDashboardGroups({ userId: 'u1' }), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    })
    act(() => result.current.fetchGroups(true))
    await waitFor(() => expect(result.current.groups).toEqual(mockGroups))

    await act(async () => {
      resolveOld(mockResponse({ groups: [], matched_invite_group_id: null }))
    })
    expect(result.current.groups).toEqual(mockGroups)
    expect(result.current.loading).toBe(false)
  })

  it('não abre o convite que saiu da URL enquanto a lista carregava', async () => {
    let resolveList!: (res: Response) => void
    mockApiFetch.mockReturnValueOnce(new Promise<Response>((resolve) => (resolveList = resolve)))

    const { result, rerender } = renderHook(
      ({ invite }: { invite?: string }) =>
        useDashboardGroups({ userId: 'u1', normalizedPendingInvite: invite }),
      {
        initialProps: { invite: 'ABCD-EF23' } as { invite?: string },
        wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
      },
    )
    rerender({ invite: undefined })

    await act(async () => {
      resolveList(mockResponse({ groups: mockGroups, matched_invite_group_id: null }))
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.joinOpen).toBe(false)
    expect(result.current.groups).toEqual(mockGroups)
    // A lista já carregada vale sem o convite: tirar o código da URL não refaz a busca.
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
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
    expect(result.current.matchedInviteGroupId).toBe('g1')
  })

  it('ignores matched_invite_group_id when there is no pending invite', async () => {
    mockApiFetch.mockResolvedValueOnce(
      mockResponse({ groups: mockGroups, matched_invite_group_id: 'g1' }),
    )

    const { result } = renderHook(() => useDashboardGroups({ userId: 'u1' }), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.matchedInviteGroupId).toBeNull()
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
