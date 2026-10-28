import { describe, expect, it } from 'vitest'
import { partitionSelectableCompetitions, selectableCompetitions } from './competitionStatus'
import type { Competition } from './types'

function comp(partial: Partial<Competition> & { id: string }): Competition {
  return { name: `Comp ${partial.id}`, slug: partial.id, season: '2026', status: 'upcoming', ...partial }
}

describe('partitionSelectableCompetitions', () => {
  it('descarta encerradas, separa andamento e preserva a ordem interna', () => {
    const groups = partitionSelectableCompetitions([
      comp({ id: 'c1', name: 'B Copa' }),
      comp({ id: 'c2', name: 'A Liga', status: 'ongoing' }),
      comp({ id: 'c3', status: 'finished' }),
    ])

    expect(groups.ongoing.map((c) => c.id)).toEqual(['c2'])
    expect(groups.upcoming.map((c) => c.id)).toEqual(['c1'])
  })

  it('status desconhecido ou ausente cai em "Em breve", conservador', () => {
    const groups = partitionSelectableCompetitions([
      { id: 'c-x', name: 'X', slug: 'x', season: '2026', status: 'indefinido' as never },
      comp({ id: 'c-sem-status', status: undefined as never }),
    ])

    expect(groups.ongoing).toHaveLength(0)
    expect(groups.upcoming.map((c) => c.id)).toEqual(['c-x', 'c-sem-status'])
  })

  it('partição é idempotente: repartir a saída devolve o mesmo resultado', () => {
    const first = partitionSelectableCompetitions([
      comp({ id: 'c1', status: 'ongoing' }),
      comp({ id: 'c2' }),
    ])
    const second = partitionSelectableCompetitions([...first.ongoing, ...first.upcoming])

    expect(second).toEqual(first)
  })
})

describe('selectableCompetitions', () => {
  it('concatena andamento primeiro e devolve os grupos junto', () => {
    const { list, groups } = selectableCompetitions([
      comp({ id: 'futuro', name: 'Futura' }),
      comp({ id: 'rolando', name: 'Rolando', status: 'ongoing' }),
      comp({ id: 'acabada', name: 'Acabada', status: 'finished' }),
    ])

    expect(list.map((c) => c.id)).toEqual(['rolando', 'futuro'])
    expect(groups.ongoing.map((c) => c.id)).toEqual(['rolando'])
    expect(groups.upcoming.map((c) => c.id)).toEqual(['futuro'])
  })
})
