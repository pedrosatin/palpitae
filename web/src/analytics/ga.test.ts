import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStoredConsent, setConsent } from './ga'

describe('ga', () => {
  describe('getStoredConsent', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    afterEach(() => {
      localStorage.clear()
    })

    it('returns "granted" when localStorage has "granted"', () => {
      localStorage.setItem('palpitae:analytics-consent', 'granted')
      expect(getStoredConsent()).toBe('granted')
    })

    it('returns "denied" when localStorage has "denied"', () => {
      localStorage.setItem('palpitae:analytics-consent', 'denied')
      expect(getStoredConsent()).toBe('denied')
    })

    it('returns null when localStorage has something else', () => {
      localStorage.setItem('palpitae:analytics-consent', 'invalid')
      expect(getStoredConsent()).toBeNull()
    })

    it('returns null when localStorage is empty', () => {
      expect(getStoredConsent()).toBeNull()
    })

    it('returns null when localStorage throws an error', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage is disabled')
      })
      expect(getStoredConsent()).toBeNull()
    })
  })

  describe('setConsent', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
      window.gtag = vi.fn()
    })

    afterEach(() => {
      localStorage.clear()
    })

    it('should save consent in localStorage and call gtag update', () => {
      const setItemMock = vi.spyOn(Storage.prototype, 'setItem')

      setConsent('granted')

      expect(setItemMock).toHaveBeenCalledWith('palpitae:analytics-consent', 'granted')
      expect(window.gtag).toHaveBeenCalledWith('consent', 'update', { analytics_storage: 'granted' })
    })

    it('should catch localStorage errors silently and still call gtag update', () => {
      const setItemMock = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      expect(() => setConsent('denied')).not.toThrow()

      // 'denied' é persistido com timestamp (denied:<ms>) para reexibir o banner após 30 dias
      expect(setItemMock).toHaveBeenCalledWith(
        'palpitae:analytics-consent',
        expect.stringMatching(/^denied:\d+$/),
      )
      expect(window.gtag).toHaveBeenCalledWith('consent', 'update', { analytics_storage: 'denied' })
    })
  })
})
