import { describe, expect, it } from 'vitest'
import { buildInviteLink, buildInviteMessage, parseInviteCode } from './invite'

describe('buildInviteLink', () => {
  it('uses the /convite/CODE path', () => {
    expect(buildInviteLink('ABCD-EF23', 'https://palpitae.com.br')).toBe(
      'https://palpitae.com.br/convite/ABCD-EF23',
    )
  })

  it('defaults to the current origin and tolerates a trailing slash', () => {
    expect(buildInviteLink('ABCD-EF23')).toBe(`${window.location.origin}/convite/ABCD-EF23`)
    expect(buildInviteLink('ABCD-EF23', 'https://palpitae.com.br/')).toBe(
      'https://palpitae.com.br/convite/ABCD-EF23',
    )
  })
})

describe('buildInviteMessage', () => {
  it('names the group when there is one', () => {
    expect(buildInviteMessage('Os Craques')).toBe('Entra no meu bolão "Os Craques" no Palpitae:')
  })

  it('falls back to a generic line without a name', () => {
    expect(buildInviteMessage()).toBe('Entra no meu bolão no Palpitae:')
    expect(buildInviteMessage('   ')).toBe('Entra no meu bolão no Palpitae:')
  })
})

describe('parseInviteCode', () => {
  it.each([
    ['abcd-ef23', 'ABCD-EF23'],
    ['  abcd-ef23  ', 'ABCD-EF23'],
    ['https://palpitae.com.br/convite/abcd-ef23', 'ABCD-EF23'],
    ['https://palpitae.com.br/convite/ABCD-EF23/', 'ABCD-EF23'],
    ['https://palpitae.com.br/?convite=abcd-ef23', 'ABCD-EF23'],
    ['https://palpitae.com.br?convite=ABCD-EF23', 'ABCD-EF23'],
  ])('extracts %s → %s', (raw, expected) => {
    expect(parseInviteCode(raw)).toBe(expected)
  })
})
