import { describe, expect, it } from 'vitest'
import {
  isKnockoutPhase,
  LABELED_ROUNDS,
  roundAgreement,
  roundLabel,
  type RoundAgreement,
} from './rounds'

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

  describe('known knockout and cup stages', () => {
    it.each([
      ['GROUP_STAGE', 'Fase de grupos'],
      ['REGULAR_SEASON', 'Temporada regular'],
      ['LEAGUE_PHASE', 'Fase de pontos'],
      ['TACA_GUANABARA', 'Taça Guanabara'],
      ['RELEGATION_STAGE', 'Rebaixamento'],
      ['FIRST_STAGE', '1ª fase'],
      ['SECOND_STAGE', '2ª fase'],
      ['THIRD_STAGE', '3ª fase'],
      ['FIRST_ROUND', '1ª fase'],
      ['SECOND_ROUND', '2ª fase'],
      ['THIRD_ROUND', '3ª fase'],
      ['FOURTH_ROUND', '4ª fase'],
      ['FIFTH_ROUND', '5ª fase'],
      ['PLAYOFFS', 'Playoffs'],
      ['LAST_32', 'Rodada de 32'],
      ['LAST_16', 'Oitavas de final'],
      ['QUARTER_FINALS', 'Quartas de final'],
      ['SEMI_FINALS', 'Semifinais'],
      ['THIRD_PLACE', 'Terceiro lugar'],
      ['FINAL', 'Final'],
      ['TACA_GUANABARA_QUARTER_FINALS', 'Quartas da Taça Guanabara'],
      ['TACA_GUANABARA_SEMI_FINALS', 'Semifinais da Taça Guanabara'],
      ['TACA_GUANABARA_FINAL', 'Final da Taça Guanabara'],
      ['TACA_RIO_SEMI_FINALS', 'Semifinais da Taça Rio'],
      ['TACA_RIO_FINAL', 'Final da Taça Rio'],
      ['TROFEU_INCONFIDENCIA_SEMI_FINALS', 'Semifinais do Troféu Inconfidência'],
      ['TROFEU_INCONFIDENCIA_FINAL', 'Final do Troféu Inconfidência'],
      ['PLAYOFFS_SEMI_FINALS', 'Semifinais dos playoffs'],
      ['PLAYOFFS_FINAL', 'Final dos playoffs'],
      ['FARROUPILHA_SEMI_FINALS', 'Semifinais do Farroupilha'],
      ['FARROUPILHA_FINAL', 'Final do Farroupilha'],
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

describe('roundAgreement', () => {
  // O painel escreve "<rótulo> completa" com a concordância da API. Esta tabela
  // fixa cada par: renomear um rótulo sem rever a concordância quebra o teste.
  const COMPLETE: Record<RoundAgreement, string> = {
    fs: 'completa',
    fp: 'completas',
    ms: 'completo',
    mp: 'completos',
  }
  const phrase = (round: string) => {
    const agreement = roundAgreement(round)
    return agreement ? `${roundLabel(round)} ${COMPLETE[agreement]}` : null
  }

  it('concorda cada rótulo conhecido com "completa"', () => {
    expect(Object.fromEntries(LABELED_ROUNDS.map((round) => [round, phrase(round)]))).toEqual({
      GROUP_STAGE: 'Fase de grupos completa',
      REGULAR_SEASON: 'Temporada regular completa',
      LEAGUE_PHASE: 'Fase de pontos completa',
      TACA_GUANABARA: 'Taça Guanabara completa',
      RELEGATION_STAGE: 'Rebaixamento completo',
      FIRST_STAGE: '1ª fase completa',
      SECOND_STAGE: '2ª fase completa',
      THIRD_STAGE: '3ª fase completa',
      FIRST_ROUND: '1ª fase completa',
      SECOND_ROUND: '2ª fase completa',
      THIRD_ROUND: '3ª fase completa',
      FOURTH_ROUND: '4ª fase completa',
      FIFTH_ROUND: '5ª fase completa',
      PLAYOFFS: 'Playoffs completos',
      LAST_32: 'Rodada de 32 completa',
      LAST_16: 'Oitavas de final completas',
      QUARTER_FINALS: 'Quartas de final completas',
      SEMI_FINALS: 'Semifinais completas',
      THIRD_PLACE: 'Terceiro lugar completo',
      FINAL: 'Final completa',
      TACA_GUANABARA_QUARTER_FINALS: 'Quartas da Taça Guanabara completas',
      TACA_GUANABARA_SEMI_FINALS: 'Semifinais da Taça Guanabara completas',
      TACA_GUANABARA_FINAL: 'Final da Taça Guanabara completa',
      TACA_RIO_SEMI_FINALS: 'Semifinais da Taça Rio completas',
      TACA_RIO_FINAL: 'Final da Taça Rio completa',
      TROFEU_INCONFIDENCIA_SEMI_FINALS: 'Semifinais do Troféu Inconfidência completas',
      TROFEU_INCONFIDENCIA_FINAL: 'Final do Troféu Inconfidência completa',
      PLAYOFFS_SEMI_FINALS: 'Semifinais dos playoffs completas',
      PLAYOFFS_FINAL: 'Final dos playoffs completa',
      FARROUPILHA_SEMI_FINALS: 'Semifinais do Farroupilha completas',
      FARROUPILHA_FINAL: 'Final do Farroupilha completa',
    })
  })

  it('rodada numérica é "Rodada N", no feminino singular', () => {
    expect(phrase('35')).toBe('Rodada 35 completa')
  })

  it.each(['SOMETHING_NEW', 'LEAGUE_STAGE_3', '', 'constructor'])(
    'rodada desconhecida %s fica sem concordância',
    (round) => {
      expect(roundAgreement(round)).toBeNull()
    },
  )
})

describe('isKnockoutPhase', () => {
  it.each([
    'FIRST_ROUND',
    'SECOND_ROUND',
    'THIRD_ROUND',
    'FOURTH_ROUND',
    'FIFTH_ROUND',
    'FIRST_STAGE',
    'SEMI_FINALS',
    'FINAL',
    'LAST_16',
    'QUARTER_FINALS',
    'PLAYOFFS',
    'TACA_GUANABARA_QUARTER_FINALS',
    'TACA_GUANABARA_SEMI_FINALS',
    'TACA_GUANABARA_FINAL',
    'TACA_RIO_SEMI_FINALS',
    'TACA_RIO_FINAL',
    'TROFEU_INCONFIDENCIA_SEMI_FINALS',
    'TROFEU_INCONFIDENCIA_FINAL',
    'PLAYOFFS_SEMI_FINALS',
    'PLAYOFFS_FINAL',
    'FARROUPILHA_SEMI_FINALS',
    'FARROUPILHA_FINAL',
  ])('trata %s como mata-mata', (phase) => {
    expect(isKnockoutPhase(phase)).toBe(true)
  })

  it.each([
    'GROUP_STAGE',
    'REGULAR_SEASON',
    'LEAGUE_PHASE',
    'TACA_GUANABARA',
    'RELEGATION_STAGE',
    '1',
    '30',
    '',
    null,
    undefined,
    'UNKNOWN',
  ])('não trata %s como mata-mata', (phase) => {
    expect(isKnockoutPhase(phase)).toBe(false)
  })
})
