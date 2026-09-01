import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useGroupActions, useGroupDetail, useGroupTabs, useTabsOffset } from './hooks'
import { useNavigate, NavigateFunction, MemoryRouter } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { invalidateApiCache } from '../../lib/api-cache'
import { trackEvent } from '../../analytics/ga'
import { useConfirm } from '../../components/ConfirmModal'
import type { User, GroupDetail } from './types'
import React from 'react'

// Mock dependencies
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: vi.fn(),
  }
})

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('../../lib/api-cache', () => ({
  invalidateApiCache: vi.fn(),
}))

vi.mock('../../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('../../components/ConfirmModal', () => ({
  useConfirm: vi.fn(),
}))

const mockUser: User = {
  id: 'u1',
  email: 'test@example.com',
  nickname: 'Test User',
}

describe('useGroupActions', () => {
  let mockNavigate: Mock
  let mockConfirm: Mock
  let mockAlert: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()

    mockNavigate = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(mockNavigate as unknown as NavigateFunction)

    mockConfirm = vi.fn().mockResolvedValue(true)
    vi.mocked(useConfirm).mockReturnValue({
      confirm: mockConfirm as unknown as ReturnType<typeof useConfirm>['confirm'],
      confirmDialog: null as any,
    })

    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: vi.fn(),
    } as unknown as Response)

    mockAlert = vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  describe('leaveGroup', () => {
    it('returns early if groupId is undefined', async () => {
      const { result } = renderHook(() => useGroupActions(undefined, mockUser))

      await act(async () => {
        await result.current.leaveGroup()
      })

      expect(trackEvent).not.toHaveBeenCalled()
      expect(mockConfirm).not.toHaveBeenCalled()
      expect(apiFetch).not.toHaveBeenCalled()
    })

    it('returns early if user cancels confirmation', async () => {
      mockConfirm.mockResolvedValueOnce(false)
      const { result } = renderHook(() => useGroupActions('g1', mockUser))

      await act(async () => {
        await result.current.leaveGroup()
      })

      expect(trackEvent).toHaveBeenCalledWith('click_group_detail_menu_sair')
      expect(mockConfirm).toHaveBeenCalled()
      expect(apiFetch).not.toHaveBeenCalled()
    })

    it('successfully leaves group and navigates away', async () => {
      // Create a promise we can control to test the loading state
      let resolveApi: (val: any) => void
      const apiPromise = new Promise((resolve) => {
        resolveApi = resolve
      })
      vi.mocked(apiFetch).mockReturnValueOnce(apiPromise as Promise<Response>)

      const { result } = renderHook(() => useGroupActions('g1', mockUser))

      let leavePromise: Promise<void>

      act(() => {
        leavePromise = result.current.leaveGroup()
      })

      // Wait for the confirm promise to resolve and state to update
      await waitFor(() => {
        expect(result.current.leaving).toBe(true)
      })

      // Resolve the API call
      act(() => {
        resolveApi({ ok: true, json: vi.fn() })
      })

      await act(async () => {
        await leavePromise
      })

      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/groups/g1/members/u1'), {
        method: 'DELETE',
      })
      expect(invalidateApiCache).toHaveBeenCalledWith('groups:')
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
      expect(result.current.leaving).toBe(false)
    })

    it('handles api error response correctly', async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Custom error message' }),
      } as unknown as Response)

      const { result } = renderHook(() => useGroupActions('g1', mockUser))

      await act(async () => {
        await result.current.leaveGroup()
      })

      expect(mockAlert).toHaveBeenCalledWith('Custom error message')
      expect(mockNavigate).not.toHaveBeenCalled()
      expect(result.current.leaving).toBe(false)
    })

    it('handles generic error correctly', async () => {
      vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Network failure'))

      const { result } = renderHook(() => useGroupActions('g1', mockUser))

      await act(async () => {
        await result.current.leaveGroup()
      })

      expect(mockAlert).toHaveBeenCalledWith('Network failure')
      expect(mockNavigate).not.toHaveBeenCalled()
      expect(result.current.leaving).toBe(false)
    })
  })

  describe('deleteGroup', () => {
    it('returns early if groupId is undefined', async () => {
      const { result } = renderHook(() => useGroupActions(undefined, mockUser))

      await act(async () => {
        await result.current.deleteGroup()
      })

      expect(trackEvent).not.toHaveBeenCalled()
      expect(mockConfirm).not.toHaveBeenCalled()
      expect(apiFetch).not.toHaveBeenCalled()
    })

    it('returns early if user cancels confirmation', async () => {
      mockConfirm.mockResolvedValueOnce(false)
      const { result } = renderHook(() => useGroupActions('g1', mockUser))

      await act(async () => {
        await result.current.deleteGroup()
      })

      expect(trackEvent).toHaveBeenCalledWith('click_group_detail_menu_excluir')
      expect(mockConfirm).toHaveBeenCalled()
      expect(apiFetch).not.toHaveBeenCalled()
    })

    it('successfully deletes group and navigates away', async () => {
      // Create a promise we can control to test the loading state
      let resolveApi: (val: any) => void
      const apiPromise = new Promise((resolve) => {
        resolveApi = resolve
      })
      vi.mocked(apiFetch).mockReturnValueOnce(apiPromise as Promise<Response>)

      const { result } = renderHook(() => useGroupActions('g1', mockUser))

      let deletePromise: Promise<void>

      act(() => {
        deletePromise = result.current.deleteGroup()
      })

      // Wait for the confirm promise to resolve and state to update
      await waitFor(() => {
        expect(result.current.deleting).toBe(true)
      })

      // Resolve the API call
      act(() => {
        resolveApi({ ok: true, json: vi.fn() })
      })

      await act(async () => {
        await deletePromise
      })

      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/groups/g1'), {
        method: 'DELETE',
      })
      expect(invalidateApiCache).toHaveBeenCalledWith('groups:')
      expect(mockNavigate).toHaveBeenCalledWith('/', {
        replace: true,
        state: { refreshGroups: true },
      })
      expect(result.current.deleting).toBe(false)
    })

    it('handles api error response correctly', async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Delete failed' }),
      } as unknown as Response)

      const { result } = renderHook(() => useGroupActions('g1', mockUser))

      await act(async () => {
        await result.current.deleteGroup()
      })

      expect(mockAlert).toHaveBeenCalledWith('Delete failed')
      expect(mockNavigate).not.toHaveBeenCalled()
      expect(result.current.deleting).toBe(false)
    })

    it('handles generic error correctly', async () => {
      vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Network failure'))

      const { result } = renderHook(() => useGroupActions('g1', mockUser))

      await act(async () => {
        await result.current.deleteGroup()
      })

      expect(mockAlert).toHaveBeenCalledWith('Network failure')
      expect(mockNavigate).not.toHaveBeenCalled()
      expect(result.current.deleting).toBe(false)
    })
  })
})

const mockGroup: GroupDetail = {
  id: 'g1',
  name: 'Test Group',
  competition_id: 'c1',
  competition_name: 'Test Comp',
  competition_type: 'league',
  is_admin: true,
  invite_code: 'TEST',
  created_at: '2023-01-01',
  points_exact: 5,
  points_winner: 3,
  predictions_visibility: 'always',
  member_count: 1,
  user_position: 1,
  user_points: 0,
  exact_hits: 0,
}

describe('useGroupTabs', () => {
  it('initializes with default tab if none in URL', () => {
    const { result } = renderHook(() => useGroupTabs(mockGroup), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/'] }, children),
    })

    expect(result.current.activeTab).toBe('predictions')
    expect(result.current.showStandings).toBe(true)
  })

  it('initializes with tab from URL', () => {
    const { result } = renderHook(() => useGroupTabs(mockGroup), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/?tab=leaderboard'] }, children),
    })

    expect(result.current.activeTab).toBe('leaderboard')
  })

  it('falls back to default if standings tab is requested but group competition is not league', () => {
    const nonLeagueGroup = { ...mockGroup, competition_type: 'cup' as any }
    const { result } = renderHook(() => useGroupTabs(nonLeagueGroup), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/?tab=standings'] }, children),
    })

    expect(result.current.activeTab).toBe('predictions')
    expect(result.current.showStandings).toBe(false)
  })

  it('setActiveTab updates URL correctly', () => {
    const { result } = renderHook(() => useGroupTabs(mockGroup), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/'] }, children),
    })

    act(() => {
      result.current.handleTabClick({ preventDefault: vi.fn() } as any, 'leaderboard')
    })

    expect(result.current.activeTab).toBe('leaderboard')
    expect(trackEvent).toHaveBeenCalledWith('click_group_detail_tab', {
      tab: 'leaderboard',
    })
  })

  it('tabHref computes correct links', () => {
    const { result } = renderHook(() => useGroupTabs(mockGroup), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/?tab=leaderboard'] }, children),
    })

    expect(result.current.tabHref('standings')).toBe('?tab=standings')
    expect(result.current.tabHref('predictions')).toBe('.') // DEFAULT_TAB deletes the tab param
  })

  it('does not prevent default or call setActiveTab if modifier key is pressed', () => {
    const { result } = renderHook(() => useGroupTabs(mockGroup), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/'] }, children),
    })

    const preventDefault = vi.fn()

    act(() => {
      result.current.handleTabClick({ preventDefault, ctrlKey: true } as any, 'leaderboard')
    })

    expect(preventDefault).not.toHaveBeenCalled()
    expect(result.current.activeTab).toBe('predictions') // Hasn't changed
  })
})

const mockApiFetch = vi.mocked(apiFetch)
function mockResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response
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

describe('useTabsOffset', () => {
  let mockHeader: HTMLElement
  const originalResizeObserver = window.ResizeObserver

  beforeEach(() => {
    mockHeader = document.createElement('header')
    vi.spyOn(mockHeader, 'clientHeight', 'get').mockReturnValue(100)
    document.body.appendChild(mockHeader)
  })

  afterEach(() => {
    if (document.body.contains(mockHeader)) {
      document.body.removeChild(mockHeader)
    }
    window.ResizeObserver = originalResizeObserver
    vi.restoreAllMocks()
  })

  it('returns 0 if header is not found', () => {
    if (document.body.contains(mockHeader)) {
      document.body.removeChild(mockHeader)
    }
    const { result } = renderHook(() => useTabsOffset())
    expect(result.current).toBe(0)
  })

  it('updates offset initially', () => {
    const { result } = renderHook(() => useTabsOffset())
    expect(result.current).toBe(100)
  })

  it('uses ResizeObserver when available', () => {
    const mockObserve = vi.fn()
    const mockDisconnect = vi.fn()
    window.ResizeObserver = vi.fn().mockImplementation(function(this: any) {
      this.observe = mockObserve
      this.disconnect = mockDisconnect
    }) as unknown as typeof ResizeObserver

    const { unmount } = renderHook(() => useTabsOffset())

    expect(window.ResizeObserver).toHaveBeenCalled()
    expect(mockObserve).toHaveBeenCalledWith(mockHeader)

    unmount()
    expect(mockDisconnect).toHaveBeenCalled()
  })

  it('falls back to window resize event when ResizeObserver is not available', () => {
    // @ts-ignore
    delete (window as any).ResizeObserver

    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const { result, unmount } = renderHook(() => useTabsOffset())

    expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))

    // Trigger resize
    vi.spyOn(mockHeader, 'clientHeight', 'get').mockReturnValue(200)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(result.current).toBe(200)

    unmount()
    expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})
