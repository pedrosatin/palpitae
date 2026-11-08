import { describe, expect, it } from 'vitest'
import { describeReplicate, type ReplicateResponse } from './replicateToGroups'

const names: Record<string, string> = {
  a: 'Bolão Alfa',
  b: 'Bolão Beta',
  c: 'Copa dos amigos',
}
const nameOf = (id: string) => names[id]

function result(overrides: Partial<ReplicateResponse> = {}): ReplicateResponse {
  return { groups: [], skipped_groups: [], locked_matches: [], missing_matches: [], ...overrides }
}

describe('describeReplicate', () => {
  it('conta o grupo atual e cada grupo que recebeu o palpite', () => {
    const message = describeReplicate(
      result({
        groups: [
          { group_id: 'a', saved: 2, replaced: 0 },
          { group_id: 'b', saved: 2, replaced: 0 },
        ],
      }),
      nameOf,
    )
    expect(message).toBe('Salvo em 3 grupos.')
  })

  it('usa o singular quando nenhum outro grupo recebeu', () => {
    const message = describeReplicate(
      result({ groups: [{ group_id: 'a', saved: 0, replaced: 0 }], locked_matches: ['m'] }),
      nameOf,
    )
    expect(message).toBe('Salvo em 1 grupo. 1 jogo já bloqueado ficou de fora.')
  })

  it('avisa onde o palpite substituiu outro diferente', () => {
    const message = describeReplicate(
      result({
        groups: [
          { group_id: 'a', saved: 3, replaced: 1 },
          { group_id: 'b', saved: 3, replaced: 2 },
          { group_id: 'c', saved: 3, replaced: 0 },
        ],
      }),
      nameOf,
    )
    expect(message).toBe(
      'Salvo em 4 grupos. Palpite diferente substituído em Bolão Alfa (1 jogo) e Bolão Beta (2 jogos).',
    )
  })

  it('lista os grupos que ficaram de fora', () => {
    const message = describeReplicate(result({ skipped_groups: ['a', 'b', 'c'] }), nameOf)
    expect(message).toBe(
      'Salvo em 1 grupo. Não aplicado em Bolão Alfa, Bolão Beta e Copa dos amigos.',
    )
  })
})
