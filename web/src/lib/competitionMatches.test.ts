import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fetchCompetitionMatches, applyDefaultRoundFromMatches } from './competitionMatches'
import { apiFetch } from './api'
import { invalidateApiCache } from './api-cache'
import { applyDefaultRound } from './rounds'
import { config } from '../config'

vi.mock('./api', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('./rounds', () => ({
  applyDefaultRound: vi.fn(),
}))

describe('competitionMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateApiCache()
  })

  describe('fetchCompetitionMatches', () => {
    it('fetches matches successfully', async () => {
      const mockResponse = { matches: [], default_round: '1' }
      vi.mocked(apiFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const result = await fetchCompetitionMatches('comp-1')

      expect(apiFetch).toHaveBeenCalledWith(`${config.apiUrl}/matches?competition_id=comp-1`)
      expect(result).toEqual(mockResponse)
    })

    it('throws an error when response is not ok', async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({
        ok: false,
      } as Response)

      await expect(fetchCompetitionMatches('comp-2')).rejects.toThrow('Erro ao carregar jogos')
      expect(apiFetch).toHaveBeenCalledWith(`${config.apiUrl}/matches?competition_id=comp-2`)
    })

    it('uses the cache key matches:competitionId', async () => {
      vi.mocked(apiFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ matches: [], default_round: '1' }),
      } as Response)

      await fetchCompetitionMatches('comp-3')
      await fetchCompetitionMatches('comp-3')

      expect(apiFetch).toHaveBeenCalledTimes(1)
      expect(apiFetch).toHaveBeenCalledWith(`${config.apiUrl}/matches?competition_id=comp-3`)
    })
  })

  describe('applyDefaultRoundFromMatches', () => {
    it('extracts unique rounds and calls applyDefaultRound', () => {
      const matches = [
        { round: 'Round 1' },
        { round: 'Round 2' },
        { round: 'Round 1' },
      ] as any[]

      const setRoundIndex = vi.fn()

      applyDefaultRoundFromMatches(matches, 'Round 2', setRoundIndex)

      expect(applyDefaultRound).toHaveBeenCalledWith(
        'Round 2',
        ['Round 1', 'Round 2'],
        setRoundIndex
      )
    })

    it('handles empty matches array', () => {
      const setRoundIndex = vi.fn()

      applyDefaultRoundFromMatches([], null, setRoundIndex)

      expect(applyDefaultRound).toHaveBeenCalledWith(
        null,
        [],
        setRoundIndex
      )
    })
  })
})
