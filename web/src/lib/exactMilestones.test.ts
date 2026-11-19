import { describe, expect, it } from 'vitest'
import {
  achievedExactMilestones,
  exactMilestoneBadgeLabel,
  exactMilestoneHighlightText,
  exactMilestonesTitle,
  highestExactMilestoneFromHits,
} from './exactMilestones'

describe('exactMilestones', () => {
  it('lista os limiares atingidos em ordem', () => {
    expect(achievedExactMilestones(0)).toEqual([])
    expect(achievedExactMilestones(4)).toEqual([])
    expect(achievedExactMilestones(5)).toEqual([5])
    expect(achievedExactMilestones(15)).toEqual([5, 15])
    expect(achievedExactMilestones(30)).toEqual([5, 15, 30])
    expect(highestExactMilestoneFromHits(4)).toBeNull()
    expect(highestExactMilestoneFromHits(16)).toBe(15)
  })

  it('monta o rótulo curto e o title com a lista', () => {
    expect(exactMilestoneBadgeLabel(5)).toBe('5 exatos')
    expect(exactMilestonesTitle([5])).toBe('Marco de 5 placares exatos neste grupo')
    expect(exactMilestonesTitle([5, 15])).toBe('Marcos de 5 e 15 placares exatos neste grupo')
    expect(exactMilestonesTitle([5, 15, 30])).toBe(
      'Marcos de 5, 15 e 30 placares exatos neste grupo',
    )
  })

  it('monta a frase do resumo no cruzamento', () => {
    expect(exactMilestoneHighlightText([])).toBeNull()
    expect(exactMilestoneHighlightText([5])).toBe(
      'Você cruzou o marco de 5 placares exatos neste grupo',
    )
    expect(exactMilestoneHighlightText([5, 15])).toBe(
      'Você cruzou os marcos de 5 e 15 placares exatos neste grupo',
    )
  })
})
