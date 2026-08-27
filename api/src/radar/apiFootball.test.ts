import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchCurrentLeagues, fetchMatchCountByLeague } from './apiFootball.js'

describe('apiFootball', () => {
  const mockApiKey = 'test-api-key'

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('fetchCurrentLeagues', () => {
    it('should parse successful responses correctly', async () => {
      const mockResponse = {
        response: [
          {
            league: { id: 1, name: 'League 1', type: 'League', logo: 'logo1.png' },
            country: { name: 'Country 1' },
            seasons: [
              { year: 2022, current: false },
              { year: 2023, start: '2023-01-01', end: '2023-12-31', current: true }
            ]
          },
          {
            league: { id: 2, name: 'League 2', type: 'Cup', logo: 'logo2.png' },
            country: { name: 'Country 2' },
            seasons: [
              { year: 2024, start: '2024-01-01', end: '2024-12-31', current: true }
            ]
          },
          {
            // Missing season
            league: { id: 3, name: 'League 3' }
          }
        ]
      }

      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)))

      const leagues = await fetchCurrentLeagues(mockApiKey)

      expect(fetch).toHaveBeenCalledWith('https://v3.football.api-sports.io/leagues?current=true', {
        headers: { 'x-apisports-key': mockApiKey }
      })

      expect(leagues).toHaveLength(2)
      expect(leagues[0]).toEqual({
        externalId: '1',
        name: 'League 1',
        country: 'Country 1',
        type: 'League',
        logoUrl: 'logo1.png',
        season: '2023',
        startsOn: '2023-01-01',
        endsOn: '2023-12-31'
      })
      expect(leagues[1]).toEqual({
        externalId: '2',
        name: 'League 2',
        country: 'Country 2',
        type: 'Cup',
        logoUrl: 'logo2.png',
        season: '2024',
        startsOn: '2024-01-01',
        endsOn: '2024-12-31'
      })
    })

    it('should fall back to default country if missing', async () => {
       const mockResponse = {
        response: [
          {
            league: { id: 1, name: 'League 1' },
            seasons: [
              { year: 2023, current: true }
            ]
          }
        ]
      }

      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)))

      const leagues = await fetchCurrentLeagues(mockApiKey)
      expect(leagues[0].country).toBe('World')
    })

    it('should fall back to default when item.league?.type or logo is null', async () => {
       const mockResponse = {
        response: [
          {
            league: { id: 1, name: 'League 1', type: null, logo: null },
            seasons: [{ year: 2023, current: true }]
          }
        ]
      }
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)))
      const leagues = await fetchCurrentLeagues(mockApiKey)
      expect(leagues[0].type).toBe(null)
      expect(leagues[0].logoUrl).toBe(null)
    })

    it('should ignore items with missing league/season info', async () => {
      const mockResponse = {
        response: [{}]
      }
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)))
      const leagues = await fetchCurrentLeagues(mockApiKey)
      expect(leagues).toEqual([])
    })

    it('should ignore if response is undefined', async () => {
      const mockResponse = {
        response: undefined
      }
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)))
      const leagues = await fetchCurrentLeagues(mockApiKey)
      expect(leagues).toEqual([])
    })
  })

  describe('fetchMatchCountByLeague', () => {
    it('should aggregate match counts per league', async () => {
      const mockResponse = {
        response: [
          { league: { id: 1 } },
          { league: { id: 1 } },
          { league: { id: 2 } },
          { league: { id: 1 } },
          { league: { id: 3 } }
        ]
      }

      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)))

      const counts = await fetchMatchCountByLeague(mockApiKey, '2023-10-15')

      expect(fetch).toHaveBeenCalledWith('https://v3.football.api-sports.io/fixtures?date=2023-10-15', {
        headers: { 'x-apisports-key': mockApiKey }
      })

      expect(counts.get('1')).toBe(3)
      expect(counts.get('2')).toBe(1)
      expect(counts.get('3')).toBe(1)
      expect(counts.size).toBe(3)
    })

    it('should ignore fixtures without league id', async () => {
      const mockResponse = {
        response: [
          { league: { id: 1 } },
          { league: {} },
          { }
        ]
      }

      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)))

      const counts = await fetchMatchCountByLeague(mockApiKey, '2023-10-15')
      expect(counts.get('1')).toBe(1)
      expect(counts.size).toBe(1)
    })

    it('should ignore fixtures with empty response', async () => {
      const mockResponse = {}
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)))
      const counts = await fetchMatchCountByLeague(mockApiKey, '2023-10-15')
      expect(counts.size).toBe(0)
    })
  })

  describe('callApi error handling', () => {
    it('should throw an error if HTTP status is not ok', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('Rate limit exceeded', { status: 429 }))

      await expect(fetchCurrentLeagues(mockApiKey)).rejects.toThrowError(
        'API-Football respondeu 429 em /leagues?current=true: Rate limit exceeded'
      )
    })

    it('should throw an error and handle fetch reject text failure silently', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: vi.fn().mockRejectedValue(new Error('Network Error'))
      } as unknown as Response)

      await expect(fetchCurrentLeagues(mockApiKey)).rejects.toThrowError(
        'API-Football respondeu 500 em /leagues?current=true: '
      )
    })

    it('should throw an error if JSON response contains array of errors', async () => {
      const mockResponse = {
        errors: ['Invalid API Key']
      }
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)))

      await expect(fetchCurrentLeagues(mockApiKey)).rejects.toThrowError(
        'API-Football retornou erro em /leagues?current=true: ["Invalid API Key"]'
      )
    })

    it('should throw an error if JSON response contains object of errors', async () => {
      const mockResponse = {
        errors: { token: 'Error' }
      }
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)))

      await expect(fetchCurrentLeagues(mockApiKey)).rejects.toThrowError(
        'API-Football retornou erro em /leagues?current=true: {"token":"Error"}'
      )
    })

    it('should not throw if errors is empty array', async () => {
      const mockResponse = {
        errors: [],
        response: []
      }
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)))

      const leagues = await fetchCurrentLeagues(mockApiKey)
      expect(leagues).toEqual([])
    })

    it('should not throw if errors is empty object', async () => {
      const mockResponse = {
        errors: {},
        response: []
      }
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)))

      const leagues = await fetchCurrentLeagues(mockApiKey)
      expect(leagues).toEqual([])
    })
  })
})
