import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useGroupActions } from './hooks'
import { useNavigate, NavigateFunction } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { invalidateApiCache } from '../../lib/api-cache'
import { trackEvent } from '../../analytics/ga'
import { useConfirm } from '../../components/ConfirmModal'
import type { User } from './types'

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

    vi.mocked(apiFetch).mockResolvedValue({ ok: true, json: vi.fn() } as unknown as Response)

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
