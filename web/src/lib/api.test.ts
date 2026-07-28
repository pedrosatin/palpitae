import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  apiFetch,
  notifySessionExpired,
  consumeSessionExpired,
  SESSION_EXPIRED_EVENT,
} from './api'

describe('api', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('notifySessionExpired', () => {
    it('sets session storage flag and dispatches event', () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      notifySessionExpired()

      expect(window.sessionStorage.getItem(SESSION_EXPIRED_EVENT)).toBe('1')
      expect(dispatchEventSpy).toHaveBeenCalledTimes(1)
      const event = dispatchEventSpy.mock.calls[0][0]
      expect(event.type).toBe(SESSION_EXPIRED_EVENT)
    })

    it('dispatches event even if sessionStorage throws', () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
      vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      notifySessionExpired()

      expect(dispatchEventSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('consumeSessionExpired', () => {
    it('returns true and clears the flag if it was set', () => {
      window.sessionStorage.setItem(SESSION_EXPIRED_EVENT, '1')

      expect(consumeSessionExpired()).toBe(true)
      expect(window.sessionStorage.getItem(SESSION_EXPIRED_EVENT)).toBeNull()
    })

    it('returns false if the flag was not set', () => {
      expect(consumeSessionExpired()).toBe(false)
    })

    it('returns false if sessionStorage throws', () => {
      vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      expect(consumeSessionExpired()).toBe(false)
    })
  })

  describe('apiFetch', () => {
    it('calls fetch with credentials: "include"', async () => {
      const fetchStub = vi.fn().mockResolvedValue(new Response('ok'))
      vi.stubGlobal('fetch', fetchStub)

      const res = await apiFetch('/test', { method: 'POST' })

      expect(fetchStub).toHaveBeenCalledTimes(1)
      expect(fetchStub).toHaveBeenCalledWith('/test', {
        method: 'POST',
        credentials: 'include',
      })
      expect(res.status).toBe(200)
    })

    it('dispatches session expired event on 401 response', async () => {
      const fetchStub = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
      vi.stubGlobal('fetch', fetchStub)

      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      const res = await apiFetch('/test')

      expect(res.status).toBe(401)
      expect(dispatchEventSpy).toHaveBeenCalledTimes(1)
      expect(window.sessionStorage.getItem(SESSION_EXPIRED_EVENT)).toBe('1')
    })
  })
})
