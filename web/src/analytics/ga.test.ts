import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStoredConsent } from './ga'

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
})
