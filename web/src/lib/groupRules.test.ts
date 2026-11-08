import { describe, expect, it } from 'vitest'
import { buildGroupRules, tiebreakCriteria, tiebreakSummary } from './groupRules'

const base = {
  points_exact: 3,
  points_winner: 1,
  points_penalty: 1,
  points_classified: 0,
  predictions_visibility: 'hidden',
  competition_type: 'league' as const,
}

describe('buildGroupRules', () => {
  it('descreve o modo Clássico', () => {
    expect(buildGroupRules(base).scoring).toEqual([
      'Placar exato vale 3 pontos.',
      'Acertar só o resultado, sem o placar, vale 1 ponto.',
    ])
  })

  it('descreve o modo Só placar exato', () => {
    const { scoring } = buildGroupRules({ ...base, points_winner: 0 })
    expect(scoring).toEqual([
      'Placar exato vale 3 pontos.',
      'Acertar só o resultado, sem o placar, não pontua.',
    ])
  })

  it('descreve o modo Só vencedor sem citar placar exato', () => {
    const { scoring } = buildGroupRules({ ...base, points_exact: 0, points_winner: 2 })
    expect(scoring).toEqual(['Acertar o resultado (vitória de um time ou empate) vale 2 pontos.'])
  })

  it('descreve o modo Personalizado', () => {
    const { scoring } = buildGroupRules({ ...base, points_exact: 7, points_winner: 4 })
    expect(scoring).toEqual([
      'Placar exato vale 7 pontos.',
      'Acertar só o resultado, sem o placar, vale 4 pontos.',
    ])
  })

  it('mostra os bônus só no mata-mata e quando maiores que zero', () => {
    expect(buildGroupRules(base).bonuses).toEqual([])
    expect(
      buildGroupRules({ ...base, competition_type: 'cup', points_penalty: 0 }).bonuses,
    ).toEqual([])
    const cup = buildGroupRules({ ...base, competition_type: 'cup', points_classified: 2 })
    expect(cup.bonuses).toHaveLength(2)
    expect(cup.bonuses[0]).toContain('Classificado vale mais 2 pontos')
    expect(cup.bonuses[1]).toContain('Pênaltis valem mais 1 ponto')
  })

  it('muda o texto conforme a visibilidade', () => {
    expect(buildGroupRules(base).visibility).toMatch(/depois que o jogo começa/)
    expect(buildGroupRules({ ...base, predictions_visibility: 'public' }).visibility).toMatch(
      /o tempo todo/,
    )
  })

  it('explica o tempo de jogo e o travamento', () => {
    const rules = buildGroupRules(base)
    expect(rules.period).toMatch(/prorrogação/)
    expect(rules.lock).toMatch(/início do jogo/)
  })
})

describe('desempate', () => {
  it('segue pontos, exatos e entrada quando o exato vale mais', () => {
    expect(tiebreakCriteria(3, 1)).toEqual([
      'mais pontos',
      'mais placares exatos',
      'quem entrou primeiro no grupo',
    ])
    expect(tiebreakSummary(3, 1)).toBe(
      'Desempate: mais pontos, depois mais placares exatos, depois quem entrou primeiro no grupo.',
    )
  })

  it('ignora os exatos quando não há bônus de placar', () => {
    expect(tiebreakCriteria(0, 1)).toEqual(['mais pontos', 'quem entrou primeiro no grupo'])
    expect(tiebreakCriteria(1, 1)).toEqual(['mais pontos', 'quem entrou primeiro no grupo'])
  })
})
