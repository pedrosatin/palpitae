import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureGuideOrigin, getGuideOrigin } from './guideOrigin'
import {
  captureEntryOrigin,
  captureInviteEntry,
  clearSignupAttribution,
  getSignupOrigin,
} from './signupOrigin'

const OWN = 'https://palpitae.com.br'

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('captureEntryOrigin', () => {
  it.each([
    'https://www.google.com/',
    'https://www.google.com.br/search?q=bolao',
    'https://www.bing.com/search?q=bolao',
    'https://duckduckgo.com/',
    'https://br.search.yahoo.com/',
    'https://search.brave.com/',
    'android-app://com.google.android.googlequicksearchbox/https/www.google.com',
  ])('classifica %s como busca', (referrer) => {
    captureEntryOrigin(referrer, OWN)
    expect(getSignupOrigin()).toBe('busca')
  })

  it('classifica a chegada sem referrer como direto', () => {
    captureEntryOrigin('', OWN)
    expect(getSignupOrigin()).toBe('direto')
  })

  it.each([
    'https://accounts.google.com/',
    'https://mail.google.com/',
    'https://www.google.evil.com/',
    'https://x.com/algum-post',
    'https://api.palpitae.com.br/auth/callback',
    `${OWN}/entrar`,
    'não é url',
  ])('não atribui categoria a %s', (referrer) => {
    captureEntryOrigin(referrer, OWN)
    expect(getSignupOrigin()).toBeUndefined()
  })

  it.each([
    [`${OWN}/guias/planilha-de-bolao/`, 'guia_planilha-de-bolao'],
    [`${OWN}/guias/`, 'guias_header'],
  ])('reconhece quem saiu do guia em %s', (referrer, token) => {
    captureEntryOrigin(referrer, OWN)
    expect(getSignupOrigin()).toBe(token)
  })

  it('não sobrescreve a chegada na volta do OAuth', () => {
    captureEntryOrigin('https://www.google.com/', OWN)
    captureEntryOrigin('https://accounts.google.com/', OWN)
    captureEntryOrigin('', OWN)
    expect(getSignupOrigin()).toBe('busca')
  })

  it('nunca expõe o referrer, só a categoria', () => {
    captureEntryOrigin('https://www.google.com/search?q=joao', OWN)
    expect(getSignupOrigin()).toBe('busca')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('joao')
  })
})

describe('captureInviteEntry', () => {
  it('guarda convite ao abrir /convite/<código>, por cima de outra chegada', () => {
    captureEntryOrigin('https://www.google.com/', OWN)
    captureInviteEntry('/convite/ABCD-EF23', '')
    expect(getSignupOrigin()).toBe('convite')
  })

  it('aceita o link antigo com ?convite=', () => {
    captureInviteEntry('/', '?convite=ABCD-EF23')
    expect(getSignupOrigin()).toBe('convite')
  })

  it('ignora código inválido', () => {
    captureEntryOrigin('', OWN)
    captureInviteEntry('/convite/nao-e-codigo', '')
    captureInviteEntry('/', '?convite=nao-e-codigo')
    expect(getSignupOrigin()).toBe('direto')
  })

  it('mantém a origem em navegação sem convite', () => {
    captureInviteEntry('/convite/ABCD-EF23', '')
    captureInviteEntry('/entrar', '')
    expect(getSignupOrigin()).toBe('convite')
  })
})

describe('getSignupOrigin', () => {
  it('prefere o guia à chegada da aba', () => {
    captureEntryOrigin('https://www.google.com/', OWN)
    captureGuideOrigin('?from=guia_planilha-de-bolao')
    expect(getSignupOrigin()).toBe('guia_planilha-de-bolao')
  })

  it('prefere o convite ao guia', () => {
    captureGuideOrigin('?from=guia_planilha-de-bolao')
    captureInviteEntry('/convite/ABCD-EF23', '')
    expect(getSignupOrigin()).toBe('convite')
  })

  it('volta à chegada da aba quando o guia expira', () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    captureEntryOrigin('https://www.google.com/', OWN)
    captureGuideOrigin('?from=guia_planilha-de-bolao')
    vi.mocked(Date.now).mockReturnValue(now + 60 * 60 * 1000)
    expect(getSignupOrigin()).toBe('busca')
  })

  it('prefere o guia visitado depois a uma chegada já registrada', () => {
    captureEntryOrigin('', OWN)
    captureEntryOrigin(`${OWN}/guias/planilha-de-bolao/`, OWN)
    expect(getSignupOrigin()).toBe('guia_planilha-de-bolao')
  })

  it('a volta do OAuth não apaga o guia visto pelo referrer', () => {
    captureEntryOrigin(`${OWN}/guias/planilha-de-bolao/`, OWN)
    captureEntryOrigin('https://accounts.google.com/', OWN)
    captureEntryOrigin('', OWN)
    expect(getSignupOrigin()).toBe('guia_planilha-de-bolao')
  })

  it('prefere o convite ao guia visto pelo referrer', () => {
    captureEntryOrigin(`${OWN}/guias/planilha-de-bolao/`, OWN)
    captureInviteEntry('/convite/ABCD-EF23', '')
    expect(getSignupOrigin()).toBe('convite')
  })

  it('expira o guia visto pelo referrer em uma hora, como o do token', () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    captureEntryOrigin('https://www.google.com/', OWN)
    captureEntryOrigin(`${OWN}/guias/planilha-de-bolao/`, OWN)
    vi.mocked(Date.now).mockReturnValue(now + 60 * 60 * 1000 - 1)
    expect(getSignupOrigin()).toBe('guia_planilha-de-bolao')
    vi.mocked(Date.now).mockReturnValue(now + 60 * 60 * 1000)
    expect(getSignupOrigin()).toBe('busca')
  })

  it('ignora valor corrompido do guia visto pelo referrer', () => {
    captureEntryOrigin('https://www.google.com/', OWN)
    sessionStorage.setItem('palpitae:origem-guia-referrer', 'não é json')
    expect(getSignupOrigin()).toBe('busca')
  })

  it('não tem valor sem nenhuma chegada registrada', () => {
    expect(getSignupOrigin()).toBeUndefined()
  })
})

describe('clearSignupAttribution', () => {
  it('apaga a chegada da aba e a origem do guia', () => {
    captureEntryOrigin('https://www.google.com/', OWN)
    captureGuideOrigin('?from=guia_planilha-de-bolao')
    captureEntryOrigin(`${OWN}/guias/dicas-para-acertar-palpites/`, OWN)
    clearSignupAttribution()
    expect(getSignupOrigin()).toBeUndefined()
    expect(getGuideOrigin()).toBeUndefined()
  })
})

describe('storage bloqueado', () => {
  beforeEach(() => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked)
  })

  it('não quebra a navegação e fica sem origem', () => {
    expect(() => captureEntryOrigin('https://www.google.com/', OWN)).not.toThrow()
    expect(() => captureInviteEntry('/convite/ABCD-EF23', '')).not.toThrow()
    expect(() => clearSignupAttribution()).not.toThrow()
    expect(getSignupOrigin()).toBeUndefined()
  })
})
