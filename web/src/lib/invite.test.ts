import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildInviteLink,
  buildInviteMessage,
  consumeAcceptedInvite,
  markInviteAccepted,
  normalizeInviteCode,
  parseInviteCode,
} from './invite'

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
    ['https://palpitae.com.br/outro/abcd-ef23', 'ABCD-EF23'],
    ['https://palpitae.com.br/convite/ABCD-EF23/extra', 'ABCD-EF23'],
    ['https://palpitae.com.br/convite/', 'HTTPS://PALPITAE.COM.BR/CONVITE/'],
    // Link sem https://, que o new URL() não aceita.
    ['palpitae.com.br/convite/abcd-ef23', 'ABCD-EF23'],
    // Mensagem do WhatsApp colada inteira: vale a última ocorrência.
    [
      'Entra no meu bolão "WXYZ-2345" no Palpitae: https://palpitae.com.br/convite/abcd-ef23',
      'ABCD-EF23',
    ],
  ])('extracts %s → %s', (raw, expected) => {
    expect(parseInviteCode(raw)).toBe(expected)
  })

  it('keeps unknown text as typed, in upper case', () => {
    expect(parseInviteCode('codigo-errado')).toBe('CODIGO-ERRADO')
  })
})

describe('normalizeInviteCode', () => {
  it('aceita o formato em qualquer caixa', () => {
    expect(normalizeInviteCode(' abcd-ef23 ')).toBe('ABCD-EF23')
  })

  it.each([undefined, null, '', 'ABC', 'ABCDEFGH', 'ABCD-EF01', 'IOAB-CD23', 'ABCD-EF2<'])(
    'recusa %s',
    (raw) => {
      expect(normalizeInviteCode(raw)).toBeNull()
    },
  )
})

describe('marca de convite aceito', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('confirma o mesmo código e apaga a marca', () => {
    markInviteAccepted('ABCD-EF23')

    expect(consumeAcceptedInvite('ABCD-EF23')).toBe(true)
    expect(consumeAcceptedInvite('ABCD-EF23')).toBe(false)
  })

  it('não confirma outro código e apaga a marca', () => {
    markInviteAccepted('ABCD-EF23')

    expect(consumeAcceptedInvite('WXYZ-2345')).toBe(false)
    expect(sessionStorage.getItem('palpitae:convite-aceito')).toBeNull()
  })

  it('sem marca não confirma nada', () => {
    expect(consumeAcceptedInvite('ABCD-EF23')).toBe(false)
  })
})
