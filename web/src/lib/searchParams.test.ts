import { describe, expect, it } from 'vitest'
import { withoutParam } from './searchParams'

describe('withoutParam', () => {
  it('remove apenas o parâmetro pedido e preserva os outros', () => {
    const prev = new URLSearchParams('convite=ABC&tab=members&x=1')
    const next = withoutParam(prev, 'convite')

    expect(next.toString()).toBe('tab=members&x=1')
    expect(prev.toString()).toBe('convite=ABC&tab=members&x=1')
  })

  it('mantém os parâmetros iguais quando a chave não existe', () => {
    const prev = new URLSearchParams('tab=members')
    const next = withoutParam(prev, 'rodada')

    expect(next.toString()).toBe('tab=members')
    expect(next).not.toBe(prev)
  })
})
