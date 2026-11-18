import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildGroupLink, buildGroupLinkMessage, normalizePublicId } from './groupLink'

describe('normalizePublicId', () => {
  it('aceita 32 hex e rejeita o resto', () => {
    expect(normalizePublicId('AaBbCcDdEeFf00112233445566778899')).toBe(
      'aabbccddeeff00112233445566778899',
    )
    expect(normalizePublicId('curto')).toBeNull()
    expect(normalizePublicId('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBeNull()
  })
})

describe('buildGroupLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('monta /grupo/:publicId sem o código de convite', () => {
    vi.stubGlobal('window', { location: { origin: 'https://palpitae.com.br' } })
    const id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    expect(buildGroupLink(id)).toBe(`https://palpitae.com.br/grupo/${id}`)
    expect(buildGroupLink(id)).not.toMatch(/convite|ABCD/)
  })
})

describe('buildGroupLinkMessage', () => {
  it('cita o nome do grupo quando houver', () => {
    expect(buildGroupLinkMessage('Firma')).toContain('Firma')
    expect(buildGroupLinkMessage()).toContain('Pede pra entrar')
  })
})
