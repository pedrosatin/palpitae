import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PredictionItem } from './PredictionItem'
import type { UserPrediction } from '../types'

describe('PredictionItem', () => {
  const basePrediction: UserPrediction = {
    match_id: 'm1',
    predicted_home_score: null,
    predicted_away_score: null,
    points_awarded: null,
    match_status: 'scheduled',
    match_start_time: '2026-06-12T17:00:00Z',
    home_score: null,
    away_score: null,
    round: '1',
    round_label: 'Rodada 1',
    group_name: null,
    home_team_name: 'Brazil',
    home_team_short_name: 'BRA',
    home_team_logo: 'bra.png',
    away_team_name: 'Croatia',
    away_team_short_name: 'CRO',
    away_team_logo: 'cro.png',
  }

  beforeEach(() => {
    vi.stubEnv('TZ', 'America/Sao_Paulo')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('renders correctly for a scheduled match with no prediction', () => {
    render(<PredictionItem prediction={basePrediction} />)
    expect(screen.getByText('BRA')).toBeInTheDocument()
    expect(screen.getByText('CRO')).toBeInTheDocument()
    expect(screen.getByText('12/06, 14:00')).toBeInTheDocument() // 17:00 UTC -> 14:00 BRT
    expect(screen.queryByText('Sem palpite')).not.toBeInTheDocument()
  })

  it('renders "Sem palpite" for a finished match with no prediction', () => {
    const p = { ...basePrediction, match_status: 'finished' }
    render(<PredictionItem prediction={p} />)
    expect(screen.getByText('Sem palpite')).toBeInTheDocument()
  })

  it('renders predicted score for a scheduled match with prediction', () => {
    const p = { ...basePrediction, predicted_home_score: 2, predicted_away_score: 1 }
    render(<PredictionItem prediction={p} />)
    expect(screen.getByText('Palpite')).toBeInTheDocument()
    expect(screen.getByText('2 × 1')).toBeInTheDocument()
    expect(screen.queryByText('Resultado')).not.toBeInTheDocument()
  })

  it('renders predicted score, actual score, and positive points for a finished match', () => {
    const p = {
      ...basePrediction,
      match_status: 'finished',
      predicted_home_score: 2,
      predicted_away_score: 1,
      home_score: 2,
      away_score: 1,
      points_awarded: 5,
    }
    render(<PredictionItem prediction={p} />)
    expect(screen.getByText('Palpite')).toBeInTheDocument()
    expect(screen.getByText('Resultado')).toBeInTheDocument()
    expect(screen.getAllByText('2 × 1').length).toBe(2)
    expect(screen.getByText('5 pt')).toBeInTheDocument()
    expect(screen.getByText('5 pt')).toHaveAttribute(
      'class',
      expect.stringMatching(/predPointsGreen/),
    )
  })

  it('renders predicted score, actual score, and zero points for a finished match', () => {
    const p = {
      ...basePrediction,
      match_status: 'finished',
      predicted_home_score: 2,
      predicted_away_score: 1,
      home_score: 0,
      away_score: 2,
      points_awarded: 0,
    }
    render(<PredictionItem prediction={p} />)
    expect(screen.getByText('Palpite')).toBeInTheDocument()
    expect(screen.getByText('2 × 1')).toBeInTheDocument()
    expect(screen.getByText('Resultado')).toBeInTheDocument()
    expect(screen.getByText('0 × 2')).toBeInTheDocument()
    expect(screen.getByText('0 pt')).toBeInTheDocument()
    expect(screen.getByText('0 pt')).toHaveAttribute(
      'class',
      expect.stringMatching(/predPointsZero/),
    )
  })
})
