import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { notifySessionExpired, consumeSessionExpired, apiFetch, SESSION_EXPIRED_EVENT } from './api'

describe('api', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('dispatchEvent', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('notifySessionExpired', () => {
    it('sets session storage flag and dispatches event', () => {
      notifySessionExpired()
      expect(window.sessionStorage.setItem).toHaveBeenCalledWith('palpitae:session-expired', '1')
      expect(window.dispatchEvent).toHaveBeenCalledWith(expect.any(Event))
      expect((window.dispatchEvent as any).mock.calls[0][0].type).toBe(SESSION_EXPIRED_EVENT)
    })

    it('dispatches event even if sessionStorage.setItem throws', () => {
      vi.mocked(window.sessionStorage.setItem).mockImplementation(() => {
        throw new Error('Quota exceeded')
      })
      notifySessionExpired()
      expect(window.dispatchEvent).toHaveBeenCalled()
    })

    it('does nothing if window is undefined', () => {
      const originalWindow = global.window
      // @ts-ignore
      delete global.window
      notifySessionExpired()
      expect(global.dispatchEvent).not.toHaveBeenCalled()
      global.window = originalWindow
    })
  })

  describe('consumeSessionExpired', () => {
    it('returns true and removes flag if flag is set to 1', () => {
      vi.mocked(window.sessionStorage.getItem).mockReturnValue('1')
      expect(consumeSessionExpired()).toBe(true)
      expect(window.sessionStorage.removeItem).toHaveBeenCalledWith('palpitae:session-expired')
    })

    it('returns false if flag is not set', () => {
      vi.mocked(window.sessionStorage.getItem).mockReturnValue(null)
      expect(consumeSessionExpired()).toBe(false)
      expect(window.sessionStorage.removeItem).not.toHaveBeenCalled()
    })

    it('returns false when sessionStorage throws an error', () => {
      vi.mocked(window.sessionStorage.getItem).mockImplementation(() => {
        throw new Error('Quota exceeded')
      })
      expect(consumeSessionExpired()).toBe(false)
    })

    it('returns false if window is undefined', () => {
      const originalWindow = global.window
      // @ts-ignore
      delete global.window
      expect(consumeSessionExpired()).toBe(false)
      global.window = originalWindow
    })
  })

  describe('apiFetch', () => {
    it('calls fetch with credentials include', async () => {
      const mockResponse = new Response(null, { status: 200 })
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const res = await apiFetch('/test', { method: 'POST' })
      expect(global.fetch).toHaveBeenCalledWith('/test', { method: 'POST', credentials: 'include' })
      expect(res).toBe(mockResponse)
    })

    it('calls notifySessionExpired on 401 response', async () => {
      const mockResponse = new Response(null, { status: 401 })
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      await apiFetch('/test')
      expect(window.sessionStorage.setItem).toHaveBeenCalledWith('palpitae:session-expired', '1')
      expect(window.dispatchEvent).toHaveBeenCalled()
    })
  })
})
