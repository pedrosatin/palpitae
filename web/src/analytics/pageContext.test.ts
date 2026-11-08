import { describe, expect, it } from 'vitest'
import { gaPageLocation, gaPageTitle, internalReferrer } from './pageContext'

const origin = 'https://palpitae.com.br'
const uuid = '11111111-2222-4333-8444-555555555555'

describe('gaPageLocation', () => {
  it('replaces the group id in the path', () => {
    expect(gaPageLocation({ origin, pathname: `/grupos/${uuid}`, search: '' })).toBe(
      `${origin}/grupos/:id`,
    )
  })

  it('replaces the invite code in the path', () => {
    expect(gaPageLocation({ origin, pathname: '/convite/ABC123', search: '' })).toBe(
      `${origin}/convite/:code`,
    )
  })

  it('keeps campaign params and the tab, and drops the invite code and the round', () => {
    const search = '?utm_source=news&tab=ranking&convite=ABC123&rodada=7&outro=1'
    expect(gaPageLocation({ origin, pathname: '/', search })).toBe(
      `${origin}/?utm_source=news&tab=ranking`,
    )
  })

  it('keeps every campaign param GA4 recognizes', () => {
    const search = '?utm_id=c1&utm_source_platform=crm&utm_creative_format=video'
    expect(gaPageLocation({ origin, pathname: '/', search })).toBe(`${origin}/${search}`)
  })

  it('leaves public paths untouched', () => {
    expect(gaPageLocation({ origin, pathname: '/entrar', search: '?from=guia_x' })).toBe(
      `${origin}/entrar?from=guia_x`,
    )
  })
})

describe('gaPageTitle', () => {
  it('uses a generic title for a group', () => {
    expect(gaPageTitle(`/grupos/${uuid}`)).toBe('Grupo | Palpitae')
  })

  it('labels the home', () => {
    expect(gaPageTitle('/')).toBe('Início | Palpitae')
  })

  it('falls back to the brand on an unknown route', () => {
    expect(gaPageTitle('/rota-nova')).toBe('Palpitae')
  })
})

describe('internalReferrer', () => {
  it('normalizes a referrer from the same site', () => {
    expect(internalReferrer(`${origin}/grupos/${uuid}?convite=X`, origin)).toBe(
      `${origin}/grupos/:id`,
    )
  })

  it('ignores external referrers so the login return stays excluded', () => {
    expect(internalReferrer('https://accounts.google.com/', origin)).toBeUndefined()
  })

  it('ignores an empty referrer', () => {
    expect(internalReferrer('', origin)).toBeUndefined()
  })
})
