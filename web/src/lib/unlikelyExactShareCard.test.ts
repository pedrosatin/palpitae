import { describe, expect, it } from 'vitest'
import {
  buildUnlikelyExactShareCardData,
  unlikelyExactShareFileName,
  unlikelyExactShareText,
} from './unlikelyExactShareCard'

describe('unlikelyExactShareCard', () => {
  it('monta o cartão só com o reconhecimento qualitativo', () => {
    expect(
      buildUnlikelyExactShareCardData({
        groupName: 'Bolão',
        hasUnlikelyExact: false,
        origin: 'https://palpitae.com.br',
      }),
    ).toBeNull()

    expect(
      buildUnlikelyExactShareCardData({
        groupName: 'Bolão',
        hasUnlikelyExact: true,
        origin: 'https://palpitae.com.br',
        groupLink: 'https://palpitae.com.br/grupo/abc',
      }),
    ).toEqual({
      groupName: 'Bolão',
      domain: 'palpitae.com.br',
      groupLink: 'https://palpitae.com.br/grupo/abc',
    })
  })

  it('monta o texto e o nome do arquivo sem percentual do jogo', () => {
    const card = buildUnlikelyExactShareCardData({
      groupName: 'Bolão',
      hasUnlikelyExact: true,
      origin: 'https://palpitae.com.br',
      groupLink: 'https://palpitae.com.br/grupo/abc',
    })!
    expect(unlikelyExactShareText(card)).toContain('menos de 10%')
    expect(unlikelyExactShareText(card)).not.toMatch(/\bsó \d+%/)
    expect(unlikelyExactShareText(card)).toContain('Entra com a gente:')
    expect(unlikelyExactShareFileName()).toBe('palpitae-placar-improvavel.png')
  })
})
