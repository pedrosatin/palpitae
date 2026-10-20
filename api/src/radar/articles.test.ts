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

  it('marca UEFA Champions League, Premier League, La Liga, Serie A (Itália), Bundesliga, Primeira Liga, Série B e Ligue 1 com palpitaeSlug', () => {
    expect(findEntry('World', 'UEFA Champions League')?.palpitaeSlug).toBe('uefa-champions-league')
    expect(findEntry('England', 'Premier League')?.palpitaeSlug).toBe('premier-league')
    expect(findEntry('Spain', 'La Liga')?.palpitaeSlug).toBe('la-liga')
    expect(findEntry('Italy', 'Serie A')?.palpitaeSlug).toBe('serie-a')
    expect(findEntry('Brazil', 'Serie A')?.palpitaeSlug).toBe('campeonato-brasileiro-serie-a')
    expect(findEntry('Brazil', 'Serie B')?.palpitaeSlug).toBe('brasileirao-serie-b')
    expect(findEntry('Germany', 'Bundesliga')?.palpitaeSlug).toBe('bundesliga')
    expect(findEntry('Portugal', 'Primeira Liga')?.palpitaeSlug).toBe('primeira-liga')
    expect(findEntry('France', 'Ligue 1')?.palpitaeSlug).toBe('ligue-1')
  })

  it('não tem entradas duplicadas na curadoria', () => {
    const keys = RADAR_ENTRIES.map((e) => `${e.country}|${e.name}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
