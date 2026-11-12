import { describe, it, expect, afterEach } from 'vitest'
import { config, buildApiUrl, buildAuthUrl } from './config'

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

describe('buildAuthUrl', () => {
  const originalAuthUrl = config.authUrl

  afterEach(() => {
    ;(config as any).authUrl = originalAuthUrl
  })

  it('não duplica a barra quando VITE_AUTH_URL termina em barra', () => {
    ;(config as any).authUrl = 'https://api.example.com/'
    expect(buildAuthUrl('/auth/google')).toBe('https://api.example.com/auth/google')
  })
})

// Código-fonte do app, fora dos testes, lido como texto.
const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./config.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('montagem das URLs da API', () => {
  it('toda chamada passa por buildApiUrl ou buildAuthUrl', () => {
    const offenders = Object.entries(sources)
      .filter(([, text]) => /config\.(apiUrl|authUrl)/.test(text))
      .map(([file]) => file)
    expect(Object.keys(sources).length).toBeGreaterThan(50)
    expect(offenders).toEqual([])
  })
})
