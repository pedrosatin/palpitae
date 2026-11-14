import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DAY_MS,
  formatCount,
  formatNumber,
  formatSince,
  isNewerThanPeriod,
  parseSqlUtc,
} from './format'

describe('format', () => {
  afterEach(() => vi.useRealTimers())

  it('formatNumber preserva decimais e formatCount arredonda', () => {
    expect(formatNumber(1234.5)).toBe((1234.5).toLocaleString('pt-BR'))
    expect(formatCount(1234.5)).toBe((1235).toLocaleString('pt-BR'))
    expect(formatCount(0.4)).toBe('0')
  })

  it('parseSqlUtc lê o timestamp da SQL API como UTC e devolve NaN se inválido', () => {
    expect(parseSqlUtc('2026-11-10 12:30:00')).toBe(Date.UTC(2026, 10, 10, 12, 30))
    expect(parseSqlUtc('lixo')).toBeNaN()
  })

  it('formatSince encurta para dd/mm hh:mm UTC e devolve o texto cru se não tiver hora', () => {
    expect(formatSince('2026-11-10 12:30:45')).toBe('10/11 12:30 UTC')
    expect(formatSince('2026-11-10')).toBe('2026-11-10')
  })

  it('isNewerThanPeriod compara com o início da janela', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 10, 14, 12))
    expect(isNewerThanPeriod('2026-11-10 12:00:00', 7)).toBe(true)
    expect(isNewerThanPeriod('2026-11-10 12:00:00', 3)).toBe(false)
    expect(isNewerThanPeriod('lixo', 7)).toBe(false)
    expect(DAY_MS).toBe(86_400_000)
  })
})
