import { describe, expect, it } from 'vitest'
import {
  UNLIKELY_EXACT_BADGE_LABEL,
  unlikelyExactBadgeTitle,
  unlikelyExactHighlightText,
  unlikelyExactShareHighlightText,
} from './unlikelyExact'

describe('unlikelyExact', () => {
  it('monta o rótulo curto e o title qualitativo', () => {
    expect(UNLIKELY_EXACT_BADGE_LABEL).toBe('improvável')
    expect(unlikelyExactBadgeTitle()).toBe(
      'Placar exato que menos de 10% dos palpiteiros da competição cravaram nesta rodada',
    )
  })

  it('monta a frase do resumo e a do compartilhamento sem contagens', () => {
    expect(unlikelyExactHighlightText(false)).toBeNull()
    expect(unlikelyExactHighlightText(true)).toBe(
      'Você cravou um placar improvável: menos de 10% dos palpiteiros da competição acertaram',
    )
    expect(unlikelyExactShareHighlightText(false)).toBeNull()
    expect(unlikelyExactShareHighlightText(true)).toBe(
      'Cravei um placar improvável: menos de 10% dos palpiteiros da competição acertaram',
    )
  })
})
