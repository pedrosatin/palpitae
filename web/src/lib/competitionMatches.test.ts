import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchCompetitionMatches, applyDefaultRoundFromMatches } from './competitionMatches'
import { apiFetch } from './api'
import { fetchCachedJson } from './api-cache'
import { applyDefaultRound } from './rounds'
import type { Match } from '../components/MatchCard'

vi.mock('./api', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('./api-cache', () => ({
  fetchCachedJson: vi.fn((_key, loader) => loader()),
}))

vi.mock('./rounds', () => ({
  applyDefaultRound: vi.fn(),
}))

vi.mock('../config', () => ({
  config: {
    apiUrl: 'http://test-api',
  },
}))

describe('competitionMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchCompetitionMatches', () => {
    it('calls fetchCachedJson with correct arguments and successfully fetches data', async () => {
      const mockMatches = { matches: [], default_round: '1' }
      vi.mocked(apiFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMatches,
      } as any)

      const result = await fetchCompetitionMatches('comp-123')

      expect(fetchCachedJson).toHaveBeenCalledWith('matches:comp-123', expect.any(Function), 30000)

      expect(apiFetch).toHaveBeenCalledWith('http://test-api/matches?competition_id=comp-123')
      expect(result).toEqual(mockMatches)
    })

    it('encodes the competitionId in the URL', async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as any)

      await fetchCompetitionMatches('comp with space & ?')

      expect(apiFetch).toHaveBeenCalledWith(
        'http://test-api/matches?competition_id=comp%20with%20space%20%26%20%3F',
      )
    })

    it('throws an error if apiFetch response is not ok', async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({
        ok: false,
      } as any)

      await expect(fetchCompetitionMatches('comp-123')).rejects.toThrow('Erro ao carregar jogos')
    })
  })

  describe('applyDefaultRoundFromMatches', () => {
    it('extracts unique rounds and calls applyDefaultRound', () => {
      const matches = [
        { round: '1' },
        { round: '1' },
        { round: '2' },
        { round: '3' },
        { round: '2' },
      ] as Match[]

      const setRoundIndex = vi.fn()

      applyDefaultRoundFromMatches(matches, '2', setRoundIndex)

      expect(applyDefaultRound).toHaveBeenCalledWith('2', ['1', '2', '3'], setRoundIndex)
    })

    it('handles empty matches array', () => {
      const matches: Match[] = []
      const setRoundIndex = vi.fn()

      applyDefaultRoundFromMatches(matches, null, setRoundIndex)

      expect(applyDefaultRound).toHaveBeenCalledWith(null, [], setRoundIndex)
    })
  })
})
