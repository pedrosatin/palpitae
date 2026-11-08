import { describe, expect, it, vi } from 'vitest'
import {
  applyDefaultRound,
  isGroupStageRound,
  isLeftoverRound,
  leftoverMatchesMarker,
  leftoverMatchesText,
  rescheduledOpenByRound,
} from './rounds'

describe('rounds', () => {
  describe('isGroupStageRound', () => {
    it('returns true for numeric strings', () => {
      expect(isGroupStageRound('1')).toBe(true)
      expect(isGroupStageRound('38')).toBe(true)
      expect(isGroupStageRound('0')).toBe(true)
    })

    it('returns false for non-numeric strings', () => {
      expect(isGroupStageRound('Round of 16')).toBe(false)
      expect(isGroupStageRound('Quarter-finals')).toBe(false)
      expect(isGroupStageRound('Final')).toBe(false)
      expect(isGroupStageRound('1a')).toBe(false)
      expect(isGroupStageRound('a1')).toBe(false)
    })

    it('returns false for empty strings or strings with whitespace', () => {
      expect(isGroupStageRound('')).toBe(false)
      expect(isGroupStageRound(' ')).toBe(false)
      expect(isGroupStageRound(' 1 ')).toBe(false)
    })
  })

  describe('applyDefaultRound', () => {
    it('sets the round index when defaultRound is found in the rounds array', () => {
      const setRoundIndex = vi.fn()
      applyDefaultRound('round2', ['round1', 'round2', 'round3'], setRoundIndex)
      expect(setRoundIndex).toHaveBeenCalledWith(1)
      expect(setRoundIndex).toHaveBeenCalledTimes(1)
    })

    it('sets the round index to the last round when defaultRound is not found in the rounds array', () => {
      const setRoundIndex = vi.fn()
      applyDefaultRound('round4', ['round1', 'round2', 'round3'], setRoundIndex)
      expect(setRoundIndex).toHaveBeenCalledWith(2)
      expect(setRoundIndex).toHaveBeenCalledTimes(1)
    })

    it('sets the round index to the last round when defaultRound is null', () => {
      const setRoundIndex = vi.fn()
      applyDefaultRound(null, ['round1', 'round2', 'round3'], setRoundIndex)
      expect(setRoundIndex).toHaveBeenCalledWith(2)
      expect(setRoundIndex).toHaveBeenCalledTimes(1)
    })

    it('sets the round index to the last round when defaultRound is undefined', () => {
      const setRoundIndex = vi.fn()
      applyDefaultRound(undefined, ['round1', 'round2', 'round3'], setRoundIndex)
      expect(setRoundIndex).toHaveBeenCalledWith(2)
      expect(setRoundIndex).toHaveBeenCalledTimes(1)
    })

    it('sets the round index to -1 when defaultRound is not null but rounds is empty', () => {
      const setRoundIndex = vi.fn()
      applyDefaultRound('round1', [], setRoundIndex)
      expect(setRoundIndex).toHaveBeenCalledWith(-1)
      expect(setRoundIndex).toHaveBeenCalledTimes(1)
    })

    it('does not call setRoundIndex when defaultRound is null and rounds is empty', () => {
      const setRoundIndex = vi.fn()
      applyDefaultRound(null, [], setRoundIndex)
      expect(setRoundIndex).not.toHaveBeenCalled()
    })
  })

  describe('rodada que ficou para trás', () => {
    const NOW = Date.parse('2026-11-07T15:00:00Z')
    const at = (iso: string, extra: Record<string, unknown> = {}) => ({
      start_time: iso,
      status: iso < '2026-11-07T15:00:00Z' ? 'finished' : 'scheduled',
      ...extra,
    })
    const round21 = [
      ...Array.from({ length: 9 }, () => at('2026-07-26T22:00:00Z')),
      at('2026-11-14T23:30:00Z'),
    ]

    const round35 = Array.from({ length: 10 }, () => at('2026-11-15T22:00:00Z'))
    const byRound = (entries: Record<string, ReturnType<typeof at>[]>) =>
      new Map(Object.entries(entries))

    it('maioria dos jogos com mais de 7 dias marca a rodada e conta o remarcado', () => {
      expect(isLeftoverRound(round21, NOW)).toBe(true)
      expect(isLeftoverRound(round35, NOW)).toBe(false)
      expect(rescheduledOpenByRound(byRound({ '21': round21, '35': round35 }), NOW, '35')).toEqual(
        new Map([['21', 1]]),
      )
    })

    it('metade não é maioria: ida e volta com uma semana de intervalo segue ativa', () => {
      const tie = [
        at('2026-10-30T22:00:00Z'),
        at('2026-10-30T22:00:00Z'),
        at('2026-11-08T22:00:00Z'),
        at('2026-11-08T22:00:00Z'),
      ]
      expect(isLeftoverRound(tie, NOW)).toBe(false)
      expect(
        rescheduledOpenByRound(
          byRound({ QUARTER_FINALS: tie, '35': round35 }),
          NOW,
          'QUARTER_FINALS',
        ).size,
      ).toBe(0)
    })

    it('a rodada padrão nunca vira remarcado, mesmo quando também ficou para trás', () => {
      const season = [
        ...Array.from({ length: 30 }, () => at('2026-08-01T22:00:00Z')),
        ...Array.from({ length: 10 }, () => at('2026-11-20T22:00:00Z')),
      ]
      expect(
        rescheduledOpenByRound(byRound({ REGULAR_SEASON: season }), NOW, 'REGULAR_SEASON').size,
      ).toBe(0)
      const round30 = [...round21.slice(0, 9), at('2026-11-21T23:30:00Z')]
      expect(rescheduledOpenByRound(byRound({ '21': round21, '30': round30 }), NOW, '21')).toEqual(
        new Map([['30', 1]]),
      )
    })

    it('exclui a rodada padrão da API em vez de recalcular, mesmo no empate', () => {
      // Fim de temporada: 9 e 21 com um remarcado no mesmo horário e a 38 encerrada.
      // As duas empatam na regra. A dica tem de apontar a que a API não escolheu.
      const round9 = [
        ...Array.from({ length: 9 }, () => at('2026-05-24T22:00:00Z')),
        at('2026-11-14T23:30:00Z'),
      ]
      const round38 = Array.from({ length: 10 }, () => at('2026-11-01T22:00:00Z'))
      const season = byRound({ '9': round9, '21': round21, '38': round38 })
      expect(rescheduledOpenByRound(season, NOW, '21')).toEqual(new Map([['9', 1]]))
      expect(rescheduledOpenByRound(season, NOW, '9')).toEqual(new Map([['21', 1]]))
    })

    it('não conta adiado, travado nem ao vivo como remarcado', () => {
      const round = [
        ...Array.from({ length: 6 }, () => at('2026-07-26T22:00:00Z')),
        at('2026-07-26T22:00:00Z', { status: 'scheduled', postponed: 1 }),
        at('2026-11-14T23:30:00Z', { locked_at: '2026-07-26T22:00:00Z' }),
        at('2026-11-14T23:30:00Z', { status: 'live' }),
        at('2026-11-15T23:30:00Z'),
      ]
      expect(
        rescheduledOpenByRound(byRound({ '21': round, '35': round35 }), NOW, '35').get('21'),
      ).toBe(1)
    })

    it('monta o texto da dica e o marcador do seletor', () => {
      expect(leftoverMatchesText(2, 0)).toBe('2 jogos adiados')
      expect(leftoverMatchesText(0, 1)).toBe('1 jogo remarcado')
      expect(leftoverMatchesText(1, 1)).toBe('1 jogo adiado e 1 remarcado')
      expect(leftoverMatchesText(2, 3)).toBe('2 jogos adiados e 3 remarcados')
      expect(leftoverMatchesMarker(4, 0)).toBe('4 adiados')
      expect(leftoverMatchesMarker(0, 1)).toBe('1 remarcado')
      expect(leftoverMatchesMarker(2, 1)).toBe('2 adiados, 1 remarcado')
      expect(leftoverMatchesMarker(0, 0)).toBe('')
    })
  })
})
