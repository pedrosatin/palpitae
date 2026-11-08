import { describe, expect, it } from 'vitest'
import { makeMatch } from '../components/matchFixtures'
import type { Match } from '../components/MatchCard'
import {
  highlightText,
  pickPoints,
  postponedNotice,
  rankRound,
  roundLeaders,
  roundScope,
  tallyRound,
  type GroupRoundPick,
  type RoundPick,
} from './roundSummary'

function finished(id: string, home: number, away: number, overrides: Partial<Match> = {}) {
  return makeMatch({ id, status: 'finished', home_score: home, away_score: away, ...overrides })
}

function pick(matchId: string, home: number, away: number, points: number): RoundPick {
  return {
    match_id: matchId,
    predicted_home_score: home,
    predicted_away_score: away,
    points_awarded: points,
  }
}

const members = [
  { user_id: 'u1', display: 'Ana' },
  { user_id: 'u2', display: 'Bruno' },
  { user_id: 'u3', display: 'Carla' },
  { user_id: 'u4', display: 'Davi' },
  { user_id: 'u5', display: 'Eva' },
]

describe('roundScope', () => {
  it('abre o resumo com todos os jogos encerrados', () => {
    const scope = roundScope([finished('a', 1, 0), finished('b', 0, 0)])
    expect(scope?.finished).toHaveLength(2)
    expect(scope?.postponed).toBe(0)
  })

  it('abre o resumo parcial quando o resto da rodada está adiado', () => {
    const scope = roundScope([
      finished('a', 1, 0),
      makeMatch({ id: 'b', status: 'scheduled', postponed: 1 }),
    ])
    expect(scope?.finished).toHaveLength(1)
    expect(scope?.postponed).toBe(1)
  })

  it('não abre com jogo aberto, ao vivo ou remarcado', () => {
    expect(roundScope([finished('a', 1, 0), makeMatch({ id: 'b' })])).toBeNull()
    expect(roundScope([finished('a', 1, 0), makeMatch({ id: 'b', status: 'live' })])).toBeNull()
  })

  it('não abre quando só há jogo adiado ou a rodada está vazia', () => {
    expect(roundScope([makeMatch({ id: 'a', postponed: 1 })])).toBeNull()
    expect(roundScope([])).toBeNull()
  })

  it('deixa o mata-mata de fora', () => {
    expect(roundScope([finished('a', 1, 0, { round: 'SEMI_FINALS' })])).toBeNull()
    expect(roundScope([finished('a', 1, 0, { tie_role: 'leg2' })])).toBeNull()
    expect(roundScope([finished('a', 1, 1, { decides_on_penalties: true })])).toBeNull()
  })
})

describe('tallyRound', () => {
  const matches = [
    finished('a', 2, 1),
    finished('b', 0, 0),
    finished('c', 1, 3),
    finished('d', 1, 0),
  ]

  it('conta pontos, exatos, resultados certos e jogos sem palpite', () => {
    const tally = tallyRound(
      matches,
      [pick('a', 2, 1, 3), pick('b', 1, 1, 1), pick('c', 2, 0, 0)],
      3,
    )
    expect(tally).toEqual({ points: 4, exact: 1, correct: 1, missed: 1 })
  })

  it('soma pênalti e classificado como o chip do card', () => {
    expect(pickPoints({ ...pick('a', 1, 0, 3), penalty_points: 1, classified_points: 2 })).toBe(6)
  })

  it('ignora palpites de jogos fora dos encerrados', () => {
    const tally = tallyRound([finished('a', 1, 0)], [pick('a', 1, 0, 3), pick('x', 1, 0, 3)], 3)
    expect(tally.points).toBe(3)
  })

  it('num grupo só de resultado, todo acerto é resultado certo', () => {
    const tally = tallyRound([finished('a', 2, 0)], [pick('a', 1, 0, 1)], 0)
    expect(tally).toMatchObject({ exact: 0, correct: 1 })
  })
})

describe('rankRound', () => {
  const finishedMatches = [finished('a', 1, 0), finished('b', 2, 2)]
  const picks: GroupRoundPick[] = [
    { user_id: 'u1', ...pick('a', 1, 0, 3) },
    { user_id: 'u1', ...pick('b', 0, 0, 1) },
    { user_id: 'u2', ...pick('a', 1, 0, 3) },
    { user_id: 'u2', ...pick('b', 0, 0, 1) },
    { user_id: 'u3', ...pick('a', 2, 0, 1) },
    // Palpite de jogo ainda aberto que a resposta trouxe. Não conta.
    { user_id: 'u3', ...pick('aberto', 1, 0, 3) },
  ]

  it('empate divide a colocação e quem não palpitou fica com 0', () => {
    const standings = rankRound(finishedMatches, picks, members, 'u3', 3)
    expect(standings.map((s) => [s.display, s.points, s.position])).toEqual([
      ['Ana', 4, 1],
      ['Bruno', 4, 1],
      ['Carla', 1, 3],
      ['Davi', 0, 4],
      ['Eva', 0, 4],
    ])
    expect(standings.find((s) => s.isYou)?.display).toBe('Carla')
  })

  it('o destaque lista os empatados no topo', () => {
    const leaders = roundLeaders(rankRound(finishedMatches, picks, members, 'u3', 3))
    expect(leaders.map((l) => l.display)).toEqual(['Ana', 'Bruno'])
  })

  it('sem pontuação não há destaque', () => {
    const standings = rankRound(finishedMatches, [], members, 'u1', 3)
    expect(roundLeaders(standings)).toEqual([])
    expect(highlightText(roundLeaders(standings))).toBeNull()
  })
})

describe('highlightText', () => {
  const base = { exact: 0, correct: 0, missed: 0, position: 1 }
  const row = (display: string, points: number, isYou = false) => ({
    ...base,
    user_id: display,
    display,
    points,
    isYou,
  })

  it('um líder leva o título', () => {
    expect(highlightText([row('Ana', 7)])).toBe('Ana levou o título de rei da rodada, com 7 pontos')
  })

  it('chama quem vê de você', () => {
    expect(highlightText([row('Ana', 1, true)])).toBe(
      'Você levou o título de rei da rodada, com 1 ponto',
    )
  })

  it('no empate, os líderes dividem o título e quem vê vem primeiro', () => {
    expect(highlightText([row('Ana', 7), row('Bruno', 7, true)])).toBe(
      'Você e Ana dividiram o título de rei da rodada, com 7 pontos',
    )
  })

  it('sem líder não há frase', () => {
    expect(highlightText([])).toBeNull()
  })

  it('empate lista até 3 nomes e resume o resto', () => {
    expect(highlightText([row('Ana', 9), row('Bruno', 9), row('Carla', 9)])).toBe(
      'Ana, Bruno e Carla dividiram o título de rei da rodada, com 9 pontos',
    )
    expect(
      highlightText([
        row('Ana', 9),
        row('Bruno', 9),
        row('Carla', 9),
        row('Davi', 9),
        row('Eva', 9),
      ]),
    ).toBe('Ana, Bruno, Carla e mais 2 dividiram o título de rei da rodada, com 9 pontos')
  })
})

describe('postponedNotice', () => {
  it('fala no singular e no plural', () => {
    expect(postponedNotice(0)).toBeNull()
    expect(postponedNotice(1)).toBe('1 jogo adiado ainda vale pontos')
    expect(postponedNotice(2)).toBe('2 jogos adiados ainda valem pontos')
  })
})
