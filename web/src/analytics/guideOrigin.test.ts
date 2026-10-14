import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { captureGuideOrigin, clearGuideOrigin, getGuideOrigin } from './guideOrigin'

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

it('keeps a validated guide token through navigation and expires after one hour', () => {
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now)
  captureGuideOrigin('?from=guia-planilha')
  expect(getGuideOrigin()).toBeUndefined()
  captureGuideOrigin('?from=guia_planilha-de-bolao_header')
  captureGuideOrigin('')
  expect(getGuideOrigin()).toBe('guia_planilha-de-bolao_header')
  vi.mocked(Date.now).mockReturnValue(now + 60 * 60 * 1000)
  expect(getGuideOrigin()).toBeUndefined()
})

it.each([
  '?from=someone@example.com',
  '?from=',
  '?from=guia_a&from=guia_b',
  '?from=guia_A',
  `?from=guia_${'a'.repeat(101)}`,
])('clears stale attribution for invalid token %s', (search) => {
  captureGuideOrigin('?from=guia_planilha-de-bolao')
  captureGuideOrigin(search)
  expect(getGuideOrigin()).toBeUndefined()
})

it('accepts the index header and clears attribution on logout', () => {
  captureGuideOrigin('?from=guias_header')
  expect(getGuideOrigin()).toBe('guias_header')
  clearGuideOrigin()
  expect(getGuideOrigin()).toBeUndefined()
})

it('ignores malformed storage', () => {
  sessionStorage.setItem('palpitae:origem-guia', '{broken')
  expect(getGuideOrigin()).toBeUndefined()
})

it('continues when storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  expect(captureGuideOrigin('?from=guia_planilha-de-bolao')).toBe('guia_planilha-de-bolao')
  expect(getGuideOrigin()).toBeUndefined()
  expect(() => clearGuideOrigin()).not.toThrow()
})
