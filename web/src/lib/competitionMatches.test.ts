import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchCompetitionMatches, applyDefaultRoundFromMatches } from './competitionMatches'
import * as apiModule from './api'
import * as apiCacheModule from './api-cache'
import * as roundsModule from './rounds'
import { config } from '../config'

vi.mock('./api')
vi.mock('./api-cache')
vi.mock('./rounds')

describe('competitionMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchCompetitionMatches', () => {
    it('should call fetchCachedJson with correct parameters and resolve json', async () => {
      const mockResponse = { matches: [], default_round: '1' }

      // Mock fetchCachedJson to execute the loader directly and return its result
      vi.mocked(apiCacheModule.fetchCachedJson).mockImplementation(async (key, loader, ttl) => {
        expect(key).toBe('matches:comp-123')
        expect(ttl).toBe(30_000)
        return loader()
      })

      // Mock apiFetch to return an ok response with json data
      vi.mocked(apiModule.apiFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const result = await fetchCompetitionMatches('comp-123')

      expect(apiModule.apiFetch).toHaveBeenCalledWith(`${config.apiUrl}/matches?competition_id=comp-123`)
      expect(result).toEqual(mockResponse)
    })

    it('should throw an error if the apiFetch response is not ok', async () => {
      vi.mocked(apiCacheModule.fetchCachedJson).mockImplementation(async (_key, loader, _ttl) => {
        return loader()
      })

      // Mock apiFetch to return a not ok response
      vi.mocked(apiModule.apiFetch).mockResolvedValueOnce({
        ok: false,
      } as Response)

      await expect(fetchCompetitionMatches('comp-123')).rejects.toThrow('Erro ao carregar jogos')
    })
  })

  describe('applyDefaultRoundFromMatches', () => {
    it('should extract distinct rounds and call applyDefaultRound', () => {
      const matches = [
        { id: '1', round: 'Round 1' },
        { id: '2', round: 'Round 1' },
        { id: '3', round: 'Round 2' },
      ] as any[]

      const setRoundIndex = vi.fn()

      applyDefaultRoundFromMatches(matches, 'Round 2', setRoundIndex)

      expect(roundsModule.applyDefaultRound).toHaveBeenCalledWith('Round 2', ['Round 1', 'Round 2'], setRoundIndex)
    })
  })
})
