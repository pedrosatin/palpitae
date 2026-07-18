import { describe, it, expect, afterEach } from 'vitest'
import { config, buildApiUrl } from './config'

describe('buildApiUrl', () => {
  const originalApiUrl = config.apiUrl

  afterEach(() => {
    // Restore the original apiUrl after each test
    ;(config as any).apiUrl = originalApiUrl
  })

  describe('with absolute apiUrl', () => {
    it('handles path without leading slash', () => {
      ;(config as any).apiUrl = 'https://api.example.com'
      expect(buildApiUrl('users')).toBe('https://api.example.com/users')
    })

    it('handles path with leading slash', () => {
      ;(config as any).apiUrl = 'https://api.example.com'
      expect(buildApiUrl('/users')).toBe('https://api.example.com/users')
    })

    it('handles apiUrl with trailing slash', () => {
      ;(config as any).apiUrl = 'https://api.example.com/'
      expect(buildApiUrl('users')).toBe('https://api.example.com/users')
    })

    it('handles search params', () => {
      ;(config as any).apiUrl = 'https://api.example.com'
      const params = new URLSearchParams({ page: '1', limit: '10' })
      expect(buildApiUrl('users', params)).toBe('https://api.example.com/users?page=1&limit=10')
    })

    it('handles empty search params', () => {
      ;(config as any).apiUrl = 'https://api.example.com'
      const params = new URLSearchParams()
      expect(buildApiUrl('users', params)).toBe('https://api.example.com/users')
    })
  })

  describe('with relative apiUrl', () => {
    it('handles path without leading slash', () => {
      ;(config as any).apiUrl = '/api/v1'
      expect(buildApiUrl('users')).toBe('/api/v1/users')
    })

    it('handles path with leading slash', () => {
      ;(config as any).apiUrl = '/api/v1'
      expect(buildApiUrl('/users')).toBe('/api/v1/users')
    })

    it('handles apiUrl with trailing slash', () => {
      ;(config as any).apiUrl = '/api/v1/'
      expect(buildApiUrl('users')).toBe('/api/v1/users')
    })

    it('handles apiUrl without leading slash', () => {
      ;(config as any).apiUrl = 'api/v1'
      expect(buildApiUrl('users')).toBe('/api/v1/users')
    })

    it('handles empty apiUrl', () => {
      ;(config as any).apiUrl = ''
      expect(buildApiUrl('users')).toBe('/users')
    })

    it('handles search params', () => {
      ;(config as any).apiUrl = '/api/v1'
      const params = new URLSearchParams({ q: 'search query', sort: 'desc' })
      expect(buildApiUrl('users', params)).toBe('/api/v1/users?q=search+query&sort=desc')
    })

    it('handles empty search params', () => {
      ;(config as any).apiUrl = '/api/v1'
      const params = new URLSearchParams()
      expect(buildApiUrl('users', params)).toBe('/api/v1/users')
    })
  })
})
