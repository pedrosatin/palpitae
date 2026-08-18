import { describe, expect, it } from 'vitest'
import { findEntry, RADAR_ENTRIES } from './articles'

describe('curadoria do radar', () => {
  it('casa nomes ignorando caixa, acento e pontuação', () => {
    expect(findEntry('Brazil', 'Copa do Brasil')?.article).toBe('Copa do Brasil de Futebol')
    expect(findEntry('brazil', 'COPA DO BRASIL')?.article).toBe('Copa do Brasil de Futebol')
    expect(findEntry('Brazil', 'Paulista A1')?.article).toBe(
      'Campeonato Paulista de Futebol Masculino',
    )
  })

  it('resolve aliases de nomes que o provider já trocou', () => {
    expect(findEntry('World', 'UEFA Conference League')?.article).toBe('Liga Conferência da UEFA')
  })

  it('distingue competições homônimas por país', () => {
    expect(findEntry('Brazil', 'Serie A')?.article).toBe('Campeonato Brasileiro de Futebol')
    expect(findEntry('Italy', 'Serie A')?.article).toBe('Campeonato Italiano de Futebol – Série A')
  })

  it('devolve undefined para liga não mapeada', () => {
    expect(findEntry('Estonia', 'Meistriliiga')).toBeUndefined()
  })

  it('não tem entradas duplicadas na curadoria', () => {
    const keys = RADAR_ENTRIES.map((e) => `${e.country}|${e.name}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
