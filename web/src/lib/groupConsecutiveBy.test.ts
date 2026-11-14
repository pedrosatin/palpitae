import { describe, expect, it } from 'vitest'
import { groupConsecutiveBy } from './groupConsecutiveBy'

describe('groupConsecutiveBy', () => {
  it('devolve lista vazia quando não há itens', () => {
    expect(groupConsecutiveBy([], (item) => item)).toEqual([])
  })

  it('agrupa itens consecutivos com a mesma chave mantendo a ordem', () => {
    const items = [
      { id: 1, group: 'A' },
      { id: 2, group: 'A' },
      { id: 3, group: 'B' },
      { id: 4, group: null },
      { id: 5, group: null },
    ]

    expect(groupConsecutiveBy(items, (item) => item.group)).toEqual([
      ['A', [items[0], items[1]]],
      ['B', [items[2]]],
      [null, [items[3], items[4]]],
    ])
  })

  it('abre novo grupo quando a mesma chave volta depois de outra', () => {
    const items = [
      { id: 1, group: 'A' },
      { id: 2, group: 'B' },
      { id: 3, group: 'A' },
    ]

    expect(groupConsecutiveBy(items, (item) => item.group)).toEqual([
      ['A', [items[0]]],
      ['B', [items[1]]],
      ['A', [items[2]]],
    ])
  })
})
