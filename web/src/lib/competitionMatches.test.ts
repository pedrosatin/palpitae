import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchCompetitionMatches, applyDefaultRoundFromMatches } from './competitionMatches'
import * as apiModule from './api'
import * as apiCacheModule from './api-cache'
import * as roundsModule from './rounds'
import type { Match } from '../components/MatchCard'

describe('competitionMatches', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchCompetitionMatches', () => {
    it('should call fetchCachedJson with correct key, ttl, and delegate to apiFetch', async () => {
      // Mock fetchCachedJson to simply execute the loader
      const fetchCachedJsonSpy = vi.spyOn(apiCacheModule, 'fetchCachedJson').mockImplementation(
        async (key, loader, ttl) => await loader()
      )

      const mockResponse = { matches: [], default_round: null }

      // Mock apiFetch to return a successful response
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response)

      const result = await fetchCompetitionMatches('comp-123')

      expect(fetchCachedJsonSpy).toHaveBeenCalledWith(
        'matches:comp-123',
        expect.any(Function),
        30000
      )

      expect(apiFetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/matches?competition_id=comp-123')
      )

      expect(result).toEqual(mockResponse)
    })

    it('should throw an error if apiFetch response is not ok', async () => {
      // Mock fetchCachedJson to simply execute the loader
      vi.spyOn(apiCacheModule, 'fetchCachedJson').mockImplementation(
        async (key, loader, ttl) => await loader()
      )

      // Mock apiFetch to return a failed response
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: false,
      } as Response)

      await expect(fetchCompetitionMatches('comp-123')).rejects.toThrow('Erro ao carregar jogos')
    })
  })

  describe('applyDefaultRoundFromMatches', () => {
    it('should extract distinct rounds and call applyDefaultRound', () => {
      const applyDefaultRoundSpy = vi.spyOn(roundsModule, 'applyDefaultRound')
      const setRoundIndex = vi.fn()

      const mockMatches = [
        { round: '1' },
        { round: '1' },
        { round: '2' },
        { round: '3' },
        { round: '2' }
      ] as Match[]

      applyDefaultRoundFromMatches(mockMatches, '2', setRoundIndex)

      expect(applyDefaultRoundSpy).toHaveBeenCalledWith(
        '2',
        ['1', '2', '3'],
        setRoundIndex
      )
    })

    it('should handle empty matches array', () => {
      const applyDefaultRoundSpy = vi.spyOn(roundsModule, 'applyDefaultRound')
      const setRoundIndex = vi.fn()

      applyDefaultRoundFromMatches([], null, setRoundIndex)

      expect(applyDefaultRoundSpy).toHaveBeenCalledWith(
        null,
        [],
        setRoundIndex
      )
    })
  })
})
