import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  notifySessionExpired,
  consumeSessionExpired,
  apiFetch,
  SESSION_EXPIRED_EVENT,
} from './api'

describe('api', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('notifySessionExpired', () => {
    it('sets session storage flag and dispatches event', () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      notifySessionExpired()

      expect(window.sessionStorage.getItem('palpitae:session-expired')).toBe('1')
      expect(dispatchEventSpy).toHaveBeenCalledTimes(1)
      const event = dispatchEventSpy.mock.calls[0][0]
      expect((event as Event).type).toBe(SESSION_EXPIRED_EVENT)
    })

    it('dispatches event even if sessionStorage throws', () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded')
      })

      notifySessionExpired()

      expect(dispatchEventSpy).toHaveBeenCalledTimes(1)
    })

    it('returns early if window is undefined', () => {
      vi.stubGlobal('window', undefined)
      expect(() => notifySessionExpired()).not.toThrow()
    })
  })

  describe('consumeSessionExpired', () => {
    it('returns false if flag is not set', () => {
      expect(consumeSessionExpired()).toBe(false)
    })

    it('returns true and removes flag if it is set to "1"', () => {
      window.sessionStorage.setItem('palpitae:session-expired', '1')
      expect(consumeSessionExpired()).toBe(true)
      expect(window.sessionStorage.getItem('palpitae:session-expired')).toBeNull()
    })

    it('returns false and removes flag if it is set to something else', () => {
      window.sessionStorage.setItem('palpitae:session-expired', '0')
      expect(consumeSessionExpired()).toBe(false)
      expect(window.sessionStorage.getItem('palpitae:session-expired')).toBeNull()
    })

    it('returns false if sessionStorage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Private mode')
      })
      expect(consumeSessionExpired()).toBe(false)
    })

    it('returns false if window is undefined', () => {
      vi.stubGlobal('window', undefined)
      expect(consumeSessionExpired()).toBe(false)
    })

    it('returns false if accessing sessionStorage throws', () => {
      const spy = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
        throw new Error('SecurityError')
      })
      expect(consumeSessionExpired()).toBe(false)
      spy.mockRestore()
    })
  })

  describe('apiFetch', () => {
    it('calls fetch with credentials: "include"', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      await apiFetch('/test-url')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith('/test-url', { credentials: 'include' })
    })

    it('merges RequestInit options while keeping credentials: "include"', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      await apiFetch('/test-url', { method: 'POST', headers: { 'Content-Type': 'application/json' } })

      expect(fetchMock).toHaveBeenCalledWith('/test-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      })
    })

    it('notifies session expired if response status is 401', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
      vi.stubGlobal('fetch', fetchMock)
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      await apiFetch('/test-url')

      expect(window.sessionStorage.getItem('palpitae:session-expired')).toBe('1')
      expect(dispatchEventSpy).toHaveBeenCalledTimes(1)
    })

    it('does not notify session expired if response status is not 401', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 }))
      vi.stubGlobal('fetch', fetchMock)
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      await apiFetch('/test-url')

      expect(window.sessionStorage.getItem('palpitae:session-expired')).toBeNull()
      expect(dispatchEventSpy).not.toHaveBeenCalled()
    })
  })
})
