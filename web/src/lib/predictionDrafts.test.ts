import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { collectRoundDrafts, type CollectRoundDraftsInput } from './predictionDrafts'
import type { Match, Prediction } from '../components/MatchCard/types'

describe('collectRoundDrafts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const createMatch = (overrides: Partial<Match> = {}): Match => ({
    id: 'match-1',
    start_time: '2024-01-02T12:00:00Z', // Future match
    status: 'scheduled',
    home_score: null,
    away_score: null,
    phase: 'group',
    round: '1',
    round_label: 'Rodada 1',
    group_name: null,
    home_team_id: 't1',
    home_team_name: 'Team 1',
    home_team_short_name: 'T1',
    home_team_logo: '',
    away_team_id: 't2',
    away_team_name: 'Team 2',
    away_team_short_name: 'T2',
    away_team_logo: '',
    ...overrides,
  })

  const createPrediction = (overrides: Partial<Prediction> = {}): Prediction => ({
    id: 'pred-1',
    match_id: 'match-1',
    predicted_home_score: 1,
    predicted_away_score: 1,
    points_awarded: 0,
    locked: false,
    updated_at: '2024-01-01T10:00:00Z',
    ...overrides,
  })

  const setupInput = (): CollectRoundDraftsInput => ({
    roundMatches: [],
    drafts: new Map(),
    penaltyDrafts: new Map(),
    predictions: new Map(),
  })

  it('returns empty array when there are no matches', () => {
    const result = collectRoundDrafts(setupInput())
    expect(result).toEqual([])
  })

  it('ignores matches that are locked by time', () => {
    const input = setupInput()
    input.roundMatches = [createMatch({ start_time: '2023-01-01T12:00:00Z' })]
    input.drafts.set('match-1', { home: '2', away: '1' })
    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })

  it('ignores matches that are locked by prediction', () => {
    const input = setupInput()
    input.roundMatches = [createMatch()]
    input.predictions.set('match-1', createPrediction({ locked: true }))
    input.drafts.set('match-1', { home: '2', away: '1' })
    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })

  it('ignores matches with empty string in drafts (incomplete edit)', () => {
    const input = setupInput()
    input.roundMatches = [createMatch()]
    input.drafts.set('match-1', { home: '', away: '1' })
    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })

  it('ignores matches with no changes compared to existing prediction', () => {
    const input = setupInput()
    input.roundMatches = [createMatch()]
    input.predictions.set('match-1', createPrediction({ predicted_home_score: 2, predicted_away_score: 1 }))
    input.drafts.set('match-1', { home: '2', away: '1' })
    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })

  it('collects a valid new prediction draft (no previous prediction)', () => {
    const input = setupInput()
    input.roundMatches = [createMatch()]
    input.drafts.set('match-1', { home: '2', away: '1' })
    const result = collectRoundDrafts(input)
    expect(result).toEqual([
      {
        match_id: 'match-1',
        predicted_home_score: 2,
        predicted_away_score: 1,
        predicted_penalty_winner: null,
      }
    ])
  })

  it('collects a valid update to an existing prediction', () => {
    const input = setupInput()
    input.roundMatches = [createMatch()]
    input.predictions.set('match-1', createPrediction({ predicted_home_score: 1, predicted_away_score: 1 }))
    input.drafts.set('match-1', { home: '2', away: '1' })
    const result = collectRoundDrafts(input)
    expect(result).toEqual([
      {
        match_id: 'match-1',
        predicted_home_score: 2,
        predicted_away_score: 1,
        predicted_penalty_winner: null,
      }
    ])
  })

  it('handles penalty winner when eligible and drafted', () => {
    const input = setupInput()
    input.roundMatches = [createMatch({ decides_on_penalties: true })]
    input.drafts.set('match-1', { home: '1', away: '1' })
    input.penaltyDrafts.set('match-1', 'home')
    const result = collectRoundDrafts(input)
    expect(result).toEqual([
      {
        match_id: 'match-1',
        predicted_home_score: 1,
        predicted_away_score: 1,
        predicted_penalty_winner: 'home',
      }
    ])
  })

  it('ignores draft if eligible draw but no penalty winner is drafted or saved', () => {
    const input = setupInput()
    input.roundMatches = [createMatch({ decides_on_penalties: true })]
    input.drafts.set('match-1', { home: '1', away: '1' })
    // no penaltyDrafts.set
    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })

  it('uses existing prediction penalty winner if draft score is draw and no penalty draft provided', () => {
    const input = setupInput()
    input.roundMatches = [createMatch({ decides_on_penalties: true })]
    // Change score to a draw that needs penalty, user just changed score not penalty winner
    input.predictions.set('match-1', createPrediction({ predicted_home_score: 0, predicted_away_score: 0, predicted_penalty_winner: 'away' }))
    input.drafts.set('match-1', { home: '1', away: '1' })
    const result = collectRoundDrafts(input)
    expect(result).toEqual([
      {
        match_id: 'match-1',
        predicted_home_score: 1,
        predicted_away_score: 1,
        predicted_penalty_winner: 'away',
      }
    ])
  })

  it('collects draft when only penalty winner changed on an existing eligible draw', () => {
    const input = setupInput()
    input.roundMatches = [createMatch({ decides_on_penalties: true })]
    input.predictions.set('match-1', createPrediction({ predicted_home_score: 1, predicted_away_score: 1, predicted_penalty_winner: 'away' }))
    input.penaltyDrafts.set('match-1', 'home')
    const result = collectRoundDrafts(input)
    expect(result).toEqual([
      {
        match_id: 'match-1',
        predicted_home_score: 1,
        predicted_away_score: 1,
        predicted_penalty_winner: 'home',
      }
    ])
  })

  it('falls back to 0 if no prediction and partial draft', () => {
      // This simulates a draft where one field is missing (which is weird, but tests the fallback logic)
      const input = setupInput()
      input.roundMatches = [createMatch()]
      input.drafts.set('match-1', { home: '2', away: undefined as any }) // Force undefined to hit the ?? fallback
      const result = collectRoundDrafts(input)
      expect(result).toEqual([
        {
          match_id: 'match-1',
          predicted_home_score: 2,
          predicted_away_score: 0,
          predicted_penalty_winner: null,
        }
      ])
  })

  it('falls back to prediction if partial draft', () => {
      const input = setupInput()
      input.roundMatches = [createMatch()]
      input.predictions.set('match-1', createPrediction({ predicted_home_score: 1, predicted_away_score: 3 }))
      input.drafts.set('match-1', { home: '2', away: undefined as any })
      const result = collectRoundDrafts(input)
      expect(result).toEqual([
        {
          match_id: 'match-1',
          predicted_home_score: 2,
          predicted_away_score: 3,
          predicted_penalty_winner: null,
        }
      ])
  })
})
