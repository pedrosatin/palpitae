import { describe, expect, it } from 'vitest'
import { roundLabel } from './rounds'

describe('roundLabel', () => {
  describe('numeric group-stage rounds', () => {
    it.each([
      ['1', 'Rodada 1'],
      ['8', 'Rodada 8'],
      ['10', 'Rodada 10'],
      ['0', 'Rodada 0'],
      ['01', 'Rodada 01'],
      ['123', 'Rodada 123'],
    ])('formats valid numeric round %s as %s', (input, expected) => {
      expect(roundLabel(input)).toBe(expected)
    })

    it.each([
      ['-1', '-1'],
      ['1.5', '1.5'],
      [' 1 ', ' 1 '],
    ])('treats non-strict numeric strings like %s as raw values', (input, expected) => {
      expect(roundLabel(input)).toBe(expected)
    })
  })

  describe('known knockout stages', () => {
    it.each([
      ['LAST_32', 'Rodada de 32'],
      ['LAST_16', 'Oitavas de final'],
      ['QUARTER_FINALS', 'Quartas de final'],
      ['SEMI_FINALS', 'Semifinais'],
      ['THIRD_PLACE', 'Terceiro lugar'],
      ['FINAL', 'Final'],
    ])('maps %s to PT-BR label %s', (input, expected) => {
      expect(roundLabel(input)).toBe(expected)
    })
  })

  describe('empty rounds', () => {
    it.each([
      ['', ''],
      ['   ', '   '],
    ])('returns empty string/whitespace as-is', (input, expected) => {
      expect(roundLabel(input)).toBe(expected)
    })
  })

  describe('fallback behavior', () => {
    it.each([
      ['SOMETHING_NEW', 'SOMETHING_NEW'],
      ['ROUND_1', 'ROUND_1'],
    ])('falls back to raw value %s for unknown stages/inputs', (input, expected) => {
      expect(roundLabel(input)).toBe(expected)
    })
  })
})
