import { describe, expect, it } from 'vitest'
import { makeMatch } from '../components/matchFixtures'
import type { Prediction } from '../components/MatchCard'
import { progressLabel, roundProgress } from './roundProgress'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const HOUR = 3_600_000
const at = (offsetHours: number) => new Date(NOW + offsetHours * HOUR).toISOString()

function pred(matchId: string, overrides: Partial<Prediction> = {}): Prediction {
  return {
    id: `p-${matchId}`,
    match_id: matchId,
    predicted_home_score: 1,
    predicted_away_score: 0,
    points_awarded: 0,
    locked: 0,
    updated_at: '2026-11-01T00:00:00Z',
    ...overrides,
  }
}

function predictions(...list: Prediction[]) {
  return new Map(list.map((p) => [p.match_id, p]))
}

describe('roundProgress', () => {
  it('conta palpitados sobre os jogos da rodada e aponta o próximo fechamento', () => {
    const round = [
      makeMatch({ id: 'a', start_time: at(30) }),
      makeMatch({ id: 'b', start_time: at(2) }),
      makeMatch({ id: 'c', start_time: at(50) }),
    ]

    expect(roundProgress(round, predictions(pred('a')), NOW)).toEqual({
      predicted: 1,
      total: 3,
      nextClosing: at(2),
    })
  })

  it('o próximo fechamento conta jogo já palpitado', () => {
    const round = [
      makeMatch({ id: 'a', start_time: at(5) }),
      makeMatch({ id: 'b', start_time: at(9) }),
    ]

    expect(roundProgress(round, predictions(pred('a')), NOW)?.nextClosing).toBe(at(5))
  })

  it('tira do total o jogo travado sem palpite e mantém o travado com palpite', () => {
    const round = [
      makeMatch({ id: 'perdido', start_time: at(-1) }),
      makeMatch({ id: 'feito', start_time: at(-1) }),
      makeMatch({ id: 'aberto', start_time: at(3) }),
    ]

    // O que falta é total - predicted: 1 jogo aberto sem palpite.
    expect(roundProgress(round, predictions(pred('feito')), NOW)).toEqual({
      predicted: 1,
      total: 2,
      nextClosing: at(3),
    })
  })

  it('devolve null quando a rodada não tem jogo aberto', () => {
    const round = [
      makeMatch({ id: 'a', status: 'finished', start_time: at(-48) }),
      makeMatch({ id: 'b', start_time: at(-1) }),
    ]

    expect(roundProgress(round, predictions(pred('a')), NOW)).toBeNull()
  })

  it('jogo adiado conta no total, mas não tem horário de fechamento', () => {
    const round = [
      makeMatch({ id: 'adiado', start_time: at(-200), postponed: 1 }),
      makeMatch({ id: 'jogado', status: 'finished', start_time: at(-48) }),
    ]

    expect(roundProgress(round, predictions(), NOW)).toEqual({
      predicted: 0,
      total: 1,
      nextClosing: null,
    })
  })

  it('palpite travado pelo servidor fecha o jogo mesmo antes do horário', () => {
    const round = [makeMatch({ id: 'a', start_time: at(3) })]

    expect(roundProgress(round, predictions(pred('a', { locked: 1 })), NOW)).toBeNull()
  })
})

describe('progressLabel', () => {
  it('usa o plural', () => {
    expect(progressLabel({ predicted: 7, total: 10, nextClosing: null })).toBe('7 de 10 palpitados')
  })

  it('usa o singular com um jogo só', () => {
    expect(progressLabel({ predicted: 0, total: 1, nextClosing: null })).toBe('0 de 1 palpitado')
  })
})
