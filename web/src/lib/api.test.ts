import { afterEach, describe, expect, it, vi } from 'vitest'
import { SESSION_EXPIRED_EVENT, apiFetch, consumeSessionExpired, notifySessionExpired } from './api'

describe('api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  describe('notifySessionExpired', () => {
    it('sets session storage flag and dispatches event', () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      notifySessionExpired()

      expect(window.sessionStorage.getItem('palpitae:session-expired')).toBe('1')
      expect(dispatchEventSpy).toHaveBeenCalledTimes(1)
      expect((dispatchEventSpy.mock.calls[0][0] as Event).type).toBe(SESSION_EXPIRED_EVENT)
    })

    it('still dispatches event even if sessionStorage.setItem throws', () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded')
      })

      notifySessionExpired()

      expect(setItemSpy).toHaveBeenCalledTimes(1)
      expect(dispatchEventSpy).toHaveBeenCalledTimes(1)
      expect((dispatchEventSpy.mock.calls[0][0] as Event).type).toBe(SESSION_EXPIRED_EVENT)
    })

    it('does nothing if window is undefined', () => {
      const originalWindow = window
      vi.stubGlobal('window', undefined)

      expect(() => notifySessionExpired()).not.toThrow()

      vi.stubGlobal('window', originalWindow)
    })
  })

  describe('consumeSessionExpired', () => {
    it('returns true and clears flag if set', () => {
      window.sessionStorage.setItem('palpitae:session-expired', '1')
      expect(consumeSessionExpired()).toBe(true)
      expect(window.sessionStorage.getItem('palpitae:session-expired')).toBeNull()
    })

    it('returns false if flag not set', () => {
      expect(consumeSessionExpired()).toBe(false)
    })

    it('returns false if sessionStorage.getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Storage disabled')
      })
      expect(consumeSessionExpired()).toBe(false)
    })

    it('returns false if window is undefined', () => {
      const originalWindow = window
      vi.stubGlobal('window', undefined)
      expect(consumeSessionExpired()).toBe(false)
      vi.stubGlobal('window', originalWindow)
    })
  })

  describe('apiFetch', () => {
    it('calls fetch with credentials: include', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
      vi.stubGlobal('fetch', fetchMock)

      await apiFetch('https://api.example.com', { method: 'POST' })

      expect(fetchMock).toHaveBeenCalledWith('https://api.example.com', {
        method: 'POST',
        credentials: 'include',
      })
    })

    it('calls notifySessionExpired on 401 status', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('unauth', { status: 401 }))
      vi.stubGlobal('fetch', fetchMock)
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      await apiFetch('/some/endpoint')

      expect(dispatchEventSpy).toHaveBeenCalledTimes(1)
      expect((dispatchEventSpy.mock.calls[0][0] as Event).type).toBe(SESSION_EXPIRED_EVENT)
    })

    it('does not call notifySessionExpired on non-401 status', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      await apiFetch('/some/endpoint')

      expect(dispatchEventSpy).not.toHaveBeenCalled()
    })
  })
})
