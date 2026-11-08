import { describe, expect, it } from 'vitest'
import {
  COMPETITION_CATALOG,
  catalogEyebrow,
  catalogFaqAnswer,
  groupCatalog,
  type CatalogCompetition,
} from './competitionCatalog'

const sample: CatalogCompetition[] = [
  { slug: 'a', name: 'Liga A', region: 'europa' },
  { slug: 'b', name: 'Liga B', region: 'brasil' },
  { slug: 'c', name: 'Liga C', region: 'europa' },
]

describe('competitionCatalog', () => {
  it('agrupa "No Brasil" antes de "Europa" e omite região vazia', () => {
    expect(groupCatalog(sample).map((g) => [g.label, g.names])).toEqual([
      ['No Brasil', ['Liga B']],
      ['Europa', ['Liga A', 'Liga C']],
    ])
    expect(groupCatalog([sample[0]]).map((g) => g.label)).toEqual(['Europa'])
  })

  it('monta a resposta do FAQ a partir da lista', () => {
    expect(catalogFaqAnswer(sample)).toBe(
      'Hoje dá para criar bolão no Brasil com Liga B e na Europa com Liga A e Liga C. Cada grupo acompanha um campeonato, e a lista cresce conforme novas competições entram.',
    )
  })

  it('conta os campeonatos no selo, no singular e no plural', () => {
    expect(catalogEyebrow(sample)).toBe('Bolão grátis em 3 campeonatos')
    expect(catalogEyebrow([sample[0]])).toBe('Bolão grátis em 1 campeonato')
  })

  it('não repete nome nem slug e não cita temporada no nome', () => {
    const names = COMPETITION_CATALOG.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(COMPETITION_CATALOG.map((c) => c.slug)).size).toBe(names.length)
    for (const name of names) expect(name).not.toMatch(/\d{4}/)
  })
})
