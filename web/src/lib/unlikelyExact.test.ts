import { describe, expect, it } from 'vitest'
import {
  UNLIKELY_EXACT_BADGE_LABEL,
  unlikelyExactBadgeTitle,
  unlikelyExactHighlightText,
  unlikelyExactShareHighlightText,
} from './unlikelyExact'

describe('unlikelyExact', () => {
  it('monta o rótulo curto e o title com o percentual', () => {
    expect(UNLIKELY_EXACT_BADGE_LABEL).toBe('improvável')
    expect(unlikelyExactBadgeTitle(null)).toBe(
      'Placar exato improvável na competição nesta rodada',
    )
    expect(unlikelyExactBadgeTitle(3)).toBe(
      'Placar exato que só 3% dos palpiteiros da competição cravaram nesta rodada',
    )
  })

  it('monta a frase do resumo e a do compartilhamento', () => {
    expect(unlikelyExactHighlightText(null)).toBeNull()
    expect(unlikelyExactHighlightText(10)).toBe(
      'Você cravou um placar improvável: só 10% dos palpiteiros da competição acertaram',
    )
    expect(unlikelyExactShareHighlightText(null)).toBeNull()
    expect(unlikelyExactShareHighlightText(5)).toBe(
      'Cravei um placar improvável: só 5% dos palpiteiros da competição acertaram',
    )
  })
})
