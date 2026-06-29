import { describe, expect, it } from 'vitest'
import { roundLabel } from './rounds'

describe('roundLabel', () => {
  it('formats a numeric group-stage round', () => {
    expect(roundLabel('1')).toBe('Rodada 1')
    expect(roundLabel('8')).toBe('Rodada 8')
  })

  it('maps known knockout stages to their PT-BR label', () => {
    expect(roundLabel('LAST_32')).toBe('Rodada de 32')
    expect(roundLabel('LAST_16')).toBe('Oitavas de final')
    expect(roundLabel('QUARTER_FINALS')).toBe('Quartas de final')
    expect(roundLabel('SEMI_FINALS')).toBe('Semifinais')
    expect(roundLabel('THIRD_PLACE')).toBe('Terceiro lugar')
    expect(roundLabel('FINAL')).toBe('Final')
  })

  it('falls back to the raw value for an unknown stage (never breaks display)', () => {
    expect(roundLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })

  it('returns empty string for empty input (matches missing-round fallback)', () => {
    expect(roundLabel('')).toBe('')
  })
})
