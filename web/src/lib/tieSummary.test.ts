import { describe, expect, it } from 'vitest'
import type { Match, Prediction } from '../components/MatchCard/types'
import { predictedAggregateText, tieSummary } from './tieSummary'

function match(overrides: Partial<Match>): Match {
  return {
    id: 'm',
    start_time: '2026-11-08T22:00:00Z',
    status: 'scheduled',
    home_score: null,
    away_score: null,
    phase: 'SEMI_FINALS',
    round: 'semi',
    round_label: 'Semifinal',
    group_name: null,
    home_team_id: 'vas',
    home_team_name: 'Vasco',
    home_team_short_name: 'VAS',
    home_team_logo: '',
    away_team_id: 'pal',
    away_team_name: 'Palmeiras',
    away_team_short_name: 'PAL',
    away_team_logo: '',
    ...overrides,
  }
}

const leg1 = match({
  id: 'leg1',
  tie_role: 'leg1',
  status: 'finished',
  home_team_id: 'pal',
  home_team_name: 'Palmeiras',
  away_team_id: 'vas',
  away_team_name: 'Vasco',
  home_score: 1,
  away_score: 0,
})

function prediction(home: number, away: number): Prediction {
  return {
    id: 'p',
    match_id: 'leg1',
    predicted_home_score: home,
    predicted_away_score: away,
    points_awarded: 0,
    locked: 0,
    updated_at: '',
  }
}

const openLeg2 = match({ id: 'leg2', tie_role: 'leg2', leg1_match_id: 'leg1' })

describe('tieSummary', () => {
  it('mostra o placar da ida quando a volta ainda não terminou', () => {
    expect(tieSummary(openLeg2, leg1)).toEqual({
      leg1: 'Ida: Palmeiras 1 × 0 Vasco',
      aggregate: null,
    })
  })

  it('não mostra nada com a ida sem resultado', () => {
    const future = {
      ...leg1,
      status: 'scheduled' as const,
      home_score: null,
      away_score: null,
    }
    expect(tieSummary(openLeg2, future)).toBeNull()
    expect(tieSummary(openLeg2, undefined)).toBeNull()
  })

  it('não mostra nada fora do jogo de volta', () => {
    expect(tieSummary(leg1, leg1)).toBeNull()
    expect(tieSummary(match({ tie_role: 'single' }), leg1)).toBeNull()
    expect(tieSummary(match({}), leg1)).toBeNull()
  })

  it('soma o agregado no mando da volta e diz quem avançou', () => {
    const leg2 = {
      ...openLeg2,
      status: 'finished' as const,
      home_score: 2,
      away_score: 2,
    }
    expect(tieSummary(leg2, leg1)?.aggregate).toBe('Agregado 2 × 3 · Palmeiras avançou')
  })

  it('aponta o vencedor dos pênaltis quando o agregado empata', () => {
    const leg2 = {
      ...openLeg2,
      status: 'finished' as const,
      home_score: 1,
      away_score: 0,
      penalty_winner: 'home' as const,
    }
    expect(tieSummary(leg2, leg1)?.aggregate).toBe('Agregado 1 × 1 · Vasco avançou nos pênaltis')
  })

  it('mostra só o agregado quando empata sem vencedor registrado', () => {
    const leg2 = {
      ...openLeg2,
      status: 'finished' as const,
      home_score: 1,
      away_score: 0,
    }
    expect(tieSummary(leg2, leg1)?.aggregate).toBe('Agregado 1 × 1')
  })
})

describe('predictedAggregateText', () => {
  it('soma o palpite da ida ao da volta', () => {
    expect(predictedAggregateText(openLeg2, '2', '1', prediction(1, 0))).toBe(
      'Agregado previsto 2 × 2',
    )
  })

  it('espera a ida palpitada e o placar completo da volta', () => {
    expect(predictedAggregateText(openLeg2, '2', '1', undefined)).toBeNull()
    expect(predictedAggregateText(openLeg2, '2', '', prediction(1, 0))).toBeNull()
    expect(
      predictedAggregateText(match({ tie_role: 'single' }), '2', '1', prediction(1, 0)),
    ).toBeNull()
  })
})
