import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  fetchCompetitionMatches,
  applyDefaultRoundFromMatches,
  competitionMatchesQueryOptions,
} from './competitionMatches'
import { apiFetch } from './api'
import { applyDefaultRound } from './rounds'
import { config } from '../config'
import { createTestQueryClient } from '../test-utils'

vi.mock('./api', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('./rounds', () => ({
  applyDefaultRound: vi.fn(),
}))

describe('competitionMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchCompetitionMatches', () => {
    it('fetches matches successfully', async () => {
      const mockResponse = { matches: [], default_round: '1' }
      vi.mocked(apiFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const result = await fetchCompetitionMatches('comp-1')

      expect(apiFetch).toHaveBeenCalledWith(
        `${config.apiUrl}/matches?competition_id=comp-1&round_order=1`,
        undefined,
      )
      expect(result).toEqual(mockResponse)
    })

    it('throws an error when response is not ok', async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({
        ok: false,
      } as Response)

      await expect(fetchCompetitionMatches('comp-2')).rejects.toThrow('Erro ao carregar jogos')
      expect(apiFetch).toHaveBeenCalledWith(
        `${config.apiUrl}/matches?competition_id=comp-2&round_order=1`,
        undefined,
      )
    })

    it('repassa o signal ao apiFetch', async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ matches: [], default_round: '1' }),
      } as Response)
      const controller = new AbortController()

      await fetchCompetitionMatches('comp-signal', controller.signal)

      expect(apiFetch).toHaveBeenCalledWith(
        `${config.apiUrl}/matches?competition_id=comp-signal&round_order=1`,
        { signal: controller.signal },
      )
    })
  })

  describe('competitionMatchesQueryOptions', () => {
    it('reutiliza a query com a mesma chave dentro do staleTime', async () => {
      vi.mocked(apiFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ matches: [], default_round: '1' }),
      } as Response)

      const client = createTestQueryClient()
      await client.fetchQuery(competitionMatchesQueryOptions('comp-3'))
      await client.fetchQuery(competitionMatchesQueryOptions('comp-3'))

      expect(apiFetch).toHaveBeenCalledTimes(1)
      expect(apiFetch).toHaveBeenCalledWith(
        `${config.apiUrl}/matches?competition_id=comp-3&round_order=1`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
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
        setRoundIndex,
      )
    })

    it('prefere a rodada pedida quando ela existe na competição', () => {
      const matches = [{ round: '21' }, { round: '35' }] as any[]
      const setRoundIndex = vi.fn()

      applyDefaultRoundFromMatches(matches, '35', setRoundIndex, '21')
      expect(applyDefaultRound).toHaveBeenLastCalledWith('21', ['21', '35'], setRoundIndex)

      applyDefaultRoundFromMatches(matches, '35', setRoundIndex, '99')
      expect(applyDefaultRound).toHaveBeenLastCalledWith('35', ['21', '35'], setRoundIndex)
    })

    it('handles empty matches array', () => {
      const setRoundIndex = vi.fn()

      applyDefaultRoundFromMatches([], null, setRoundIndex)

      expect(applyDefaultRound).toHaveBeenCalledWith(null, [], setRoundIndex)
    })
  })
})
