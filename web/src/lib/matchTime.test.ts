import { describe, expect, it } from 'vitest'
import {
  RELATIVE_CLOSING_MS,
  closingText,
  formatClosingDate,
  formatMatchDate,
  formatTimeLeft,
} from './matchTime'

const MIN = 60_000
const HOUR = 60 * MIN

describe('formatMatchDate', () => {
  it('mostra dia da semana sem ponto, data e hora de Brasília', () => {
    // 21:30 UTC = 18:30 em Brasília, num sábado.
    expect(formatMatchDate('2026-11-14T21:30:00Z')).toBe('sáb, 14/11 · 18:30')
  })

  it('usa o dia de Brasília quando o UTC já virou o dia', () => {
    // 02:00 UTC de domingo ainda é 23:00 de sábado em Brasília.
    expect(formatMatchDate('2026-11-15T02:00:00Z')).toBe('sáb, 14/11 · 23:00')
  })

  it('escreve meia-noite como 00:00', () => {
    expect(formatMatchDate('2026-11-16T03:00:00Z')).toBe('seg, 16/11 · 00:00')
  })
})

describe('formatClosingDate', () => {
  it('liga data e hora com "às"', () => {
    expect(formatClosingDate('2026-11-13T21:30:00Z')).toBe('sex, 13/11 às 18:30')
  })
})

describe('formatTimeLeft', () => {
  it.each([
    [30_000, 'menos de 1 min'],
    [MIN, '1 min'],
    [45 * MIN + 59_000, '45 min'],
    [HOUR, '1 h'],
    [2 * HOUR + 15 * MIN, '2 h 15 min'],
    [23 * HOUR + 59 * MIN + 59_000, '23 h 59 min'],
  ])('%i ms vira "%s"', (ms, text) => {
    expect(formatTimeLeft(ms)).toBe(text)
  })
})

describe('closingText', () => {
  const start = '2026-11-13T21:30:00Z'
  const startMs = Date.parse(start)

  it('abaixo de 24 h mostra o tempo que falta', () => {
    expect(closingText(start, startMs - (2 * HOUR + 15 * MIN))).toBe('em 2 h 15 min')
  })

  it('com 24 h ou mais mostra a data com dia da semana', () => {
    expect(closingText(start, startMs - RELATIVE_CLOSING_MS)).toBe('sex, 13/11 às 18:30')
  })

  it('logo abaixo de 24 h já vira contagem', () => {
    expect(closingText(start, startMs - RELATIVE_CLOSING_MS + 1)).toBe('em 23 h 59 min')
  })
})
