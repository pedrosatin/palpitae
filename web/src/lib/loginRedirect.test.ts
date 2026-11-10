import { describe, expect, it } from 'vitest'
import { loggedInLoginTarget, pageLoadedFromHistory } from './loginRedirect'

const query =
  '?from=guia_bolao-do-brasileirao&competicao=campeonato-brasileiro-serie-a-2027&utm_source=x'

function perfWith(type: string | undefined) {
  return {
    getEntriesByType: () => (type ? [{ type }] : []),
  } as unknown as Performance
}

describe('loggedInLoginTarget', () => {
  it('mantém a query inteira numa carga nova', () => {
    expect(loggedInLoginTarget(query, false)).toBe(`/${query}`)
    expect(loggedInLoginTarget('', false)).toBe('/')
  })

  it('tira só o competicao na volta pelo histórico', () => {
    expect(loggedInLoginTarget(query, true)).toBe('/?from=guia_bolao-do-brasileirao&utm_source=x')
    expect(loggedInLoginTarget('?competicao=a&competicao=b', true)).toBe('/')
    expect(loggedInLoginTarget('', true)).toBe('/')
  })
})

describe('pageLoadedFromHistory', () => {
  it('reconhece a carga por voltar ou avançar', () => {
    expect(pageLoadedFromHistory(perfWith('back_forward'))).toBe(true)
  })

  it.each(['navigate', 'reload', undefined])('não trata a carga %s como histórico', (type) => {
    expect(pageLoadedFromHistory(perfWith(type))).toBe(false)
  })

  it('responde que não sem a API ou quando ela falha', () => {
    expect(pageLoadedFromHistory({})).toBe(false)
    expect(
      pageLoadedFromHistory({
        getEntriesByType: () => {
          throw new Error('indisponível')
        },
      } as unknown as Performance),
    ).toBe(false)
  })
})
