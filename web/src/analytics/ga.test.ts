import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStoredConsent, setConsent, trackEvent } from './ga'

describe('ga', () => {
  describe('gaEnabled', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    it('is true when gaMeasurementId is set', async () => {
      vi.doMock('../config', () => ({
        config: { gaMeasurementId: 'G-123' },
      }))
      const { gaEnabled } = await import('./ga')
      expect(gaEnabled).toBe(true)
    })

    it('is false when gaMeasurementId is not set', async () => {
      vi.doMock('../config', () => ({
        config: { gaMeasurementId: '' },
      }))
      const { gaEnabled } = await import('./ga')
      expect(gaEnabled).toBe(false)
    })
  })

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

    it('tests the error path in getStoredConsent by mocking localStorage.getItem to throw an error', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Mocked error for testing')
      })

      const result = getStoredConsent()

      expect(result).toBeNull()
      // Clean up the spies
      consoleErrorSpy.mockRestore()
      getItemSpy.mockRestore()
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
      expect(window.gtag).toHaveBeenCalledWith('consent', 'update', {
        analytics_storage: 'granted',
      })
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
      expect(window.gtag).toHaveBeenCalledWith('consent', 'update', {
        analytics_storage: 'denied',
      })
    })
  })

  describe('initGa', () => {
    beforeEach(() => {
      vi.resetModules()
      vi.restoreAllMocks()
      delete (window as any).gtag
      delete (window as any).dataLayer
      document.head.innerHTML = ''
      localStorage.clear()
    })

    it('does nothing if gaEnabled is false', async () => {
      vi.doMock('../config', () => ({
        config: { gaMeasurementId: '' },
      }))

      const { initGa } = await import('./ga')
      initGa()

      expect((window as any).dataLayer).toBeUndefined()
      expect((window as any).gtag).toBeUndefined()
      expect(document.head.innerHTML).toBe('')
    })

    it('initializes GA properly when gaEnabled is true', async () => {
      vi.doMock('../config', () => ({
        config: { gaMeasurementId: 'G-1234567890' },
      }))

      const { initGa } = await import('./ga')
      initGa()

      expect((window as any).dataLayer).toBeDefined()
      expect((window as any).gtag).toBeDefined()
      expect((window as any).dataLayer.length).toBe(3) // js, config, and 1 for default consent

      // O script real é adiado (load/idle) para não competir com o carregamento
      // inicial da página — aguarda o macrotask que injeta a tag no <head>.
      await new Promise((resolve) => setTimeout(resolve, 0))

      const script = document.head.querySelector('script')
      expect(script).not.toBeNull()
      expect(script?.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-1234567890')
      expect(script?.async).toBe(true)
    })

    it('initializes GA and sets granted if consent was already granted', async () => {
      vi.doMock('../config', () => ({
        config: { gaMeasurementId: 'G-1234567890' },
      }))
      localStorage.setItem('palpitae:analytics-consent', 'granted')

      const { initGa } = await import('./ga')
      initGa()

      expect((window as any).dataLayer).toBeDefined()
      expect((window as any).gtag).toBeDefined()
      expect((window as any).dataLayer.length).toBe(4) // js, config, 1 for default consent, 1 for update consent
    })

    it('pushes arguments to dataLayer when gtag is called', async () => {
      vi.doMock('../config', () => ({
        config: { gaMeasurementId: 'G-1234567890' },
      }))

      const { initGa } = await import('./ga')
      initGa()

      // Reset dataLayer for clean check of gtag call arguments
      ;(window as any).dataLayer = []

      // Simulate a gtag call
      window.gtag('event', 'test_event', { value: 1 })

      expect((window as any).dataLayer.length).toBe(1)
      expect(Array.from((window as any).dataLayer[0])).toEqual([
        'event',
        'test_event',
        { value: 1 },
      ])
    })
  })

  describe('trackEvent', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
      window.gtag = vi.fn()
    })

    afterEach(() => {
      // @ts-ignore
      delete window.gtag
    })

    it('should call gtag with the correct arguments when params are provided', () => {
      trackEvent('test_event', { custom_param: 'value', count: 1 })

      expect(window.gtag).toHaveBeenCalledWith('event', 'test_event', {
        custom_param: 'value',
        count: 1,
      })
    })

    it('should call gtag with the correct arguments when params are omitted', () => {
      trackEvent('test_event_no_params')

      expect(window.gtag).toHaveBeenCalledWith('event', 'test_event_no_params', undefined)
    })

    it('should not throw an error when window.gtag is undefined', () => {
      // @ts-ignore
      delete window.gtag

      expect(() => trackEvent('test_event_no_gtag')).not.toThrow()
    })
  })
})
