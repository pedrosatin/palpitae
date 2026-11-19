import { describe, expect, it } from 'vitest'
import {
  buildUnlikelyExactShareCardData,
  unlikelyExactShareFileName,
  unlikelyExactShareText,
} from './unlikelyExactShareCard'

describe('unlikelyExactShareCard', () => {
  it('monta o cartão só com percentual', () => {
    expect(
      buildUnlikelyExactShareCardData({
        groupName: 'Bolão',
        percent: null,
        origin: 'https://palpitae.com.br',
      }),
    ).toBeNull()

    expect(
      buildUnlikelyExactShareCardData({
        groupName: 'Bolão',
        percent: 10,
        origin: 'https://palpitae.com.br',
        groupLink: 'https://palpitae.com.br/grupo/abc',
      }),
    ).toEqual({
      groupName: 'Bolão',
      percent: 10,
      domain: 'palpitae.com.br',
      groupLink: 'https://palpitae.com.br/grupo/abc',
    })
  })

  it('monta o texto e o nome do arquivo', () => {
    const card = buildUnlikelyExactShareCardData({
      groupName: 'Bolão',
      percent: 5,
      origin: 'https://palpitae.com.br',
      groupLink: 'https://palpitae.com.br/grupo/abc',
    })!
    expect(unlikelyExactShareText(card)).toContain('só 5%')
    expect(unlikelyExactShareText(card)).toContain('Entra com a gente:')
    expect(unlikelyExactShareFileName(5)).toBe('palpitae-placar-improvavel-5.png')
  })
})
