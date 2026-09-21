import { describe, expect, it } from 'vitest'
import { collectRoundDrafts, type CollectRoundDraftsInput } from './predictionDrafts'
import type { Match, Prediction } from '../components/MatchCard'

describe('collectRoundDrafts', () => {
  const baseMatch: Match = {
    id: 'match1',
    start_time: new Date(Date.now() + 1000000).toISOString(),
    status: 'scheduled',
    home_score: null,
    away_score: null,
    phase: 'Group Stage',
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
  }

  const basePrediction: Prediction = {
    id: 'pred1',
    match_id: 'match1',
    predicted_home_score: 1,
    predicted_away_score: 2,
    points_awarded: 0,
    locked: false,
    updated_at: new Date().toISOString(),
  }

  const createInput = (
    overrides: Partial<CollectRoundDraftsInput> = {}
  ): CollectRoundDraftsInput => ({
    roundMatches: [baseMatch],
    drafts: new Map(),
    penaltyDrafts: new Map(),
    predictions: new Map(),
    ...overrides
  })

  it('ignores matches that are locked by time', () => {
    const lockedMatch = { ...baseMatch, start_time: new Date(Date.now() - 100000).toISOString() }
    const input = createInput({
      roundMatches: [lockedMatch],
      drafts: new Map([['match1', { home: '2', away: '2' }]]),
    })

    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })

  it('ignores matches that are locked by prediction status', () => {
    const lockedPrediction = { ...basePrediction, locked: true }
    const input = createInput({
      drafts: new Map([['match1', { home: '2', away: '2' }]]),
      predictions: new Map([['match1', lockedPrediction]]),
    })

    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })

  it('ignores matches with no draft and no penalty draft', () => {
    const input = createInput()
    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })

  it('ignores matches with an empty draft string for home score', () => {
    const input = createInput({
      drafts: new Map([['match1', { home: '', away: '2' }]]),
    })
    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })

  it('ignores matches with an empty draft string for away score', () => {
    const input = createInput({
      drafts: new Map([['match1', { home: '1', away: '' }]]),
    })
    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })

  it('returns a new payload when score changes', () => {
    const input = createInput({
      drafts: new Map([['match1', { home: '3', away: '0' }]]),
      predictions: new Map([['match1', basePrediction]]),
    })

    const result = collectRoundDrafts(input)
    expect(result).toEqual([
      {
        match_id: 'match1',
        predicted_home_score: 3,
        predicted_away_score: 0,
        predicted_penalty_winner: null,
      },
    ])
  })

  it('ignores unchanged predictions', () => {
    const input = createInput({
      drafts: new Map([['match1', { home: '1', away: '2' }]]),
      predictions: new Map([['match1', basePrediction]]),
    })

    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })

  it('handles knockout matches with eligible draw and penalty winner', () => {
    const knockoutMatch = { ...baseMatch, decides_on_penalties: true }
    const input = createInput({
      roundMatches: [knockoutMatch],
      drafts: new Map([['match1', { home: '1', away: '1' }]]),
      penaltyDrafts: new Map([['match1', 'home']]),
    })

    const result = collectRoundDrafts(input)
    expect(result).toEqual([
      {
        match_id: 'match1',
        predicted_home_score: 1,
        predicted_away_score: 1,
        predicted_penalty_winner: 'home',
      },
    ])
  })

  it('ignores knockout matches with eligible draw but no penalty winner', () => {
    const knockoutMatch = { ...baseMatch, decides_on_penalties: true }
    const input = createInput({
      roundMatches: [knockoutMatch],
      drafts: new Map([['match1', { home: '1', away: '1' }]]),
    })

    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })

  it('handles partial drafts falling back to prediction', () => {
    const input = createInput({
      drafts: new Map([['match1', { home: undefined as any as string, away: '3' }]]),
      predictions: new Map([['match1', basePrediction]]),
    })

    const result = collectRoundDrafts(input)
    expect(result).toEqual([
      {
        match_id: 'match1',
        predicted_home_score: 1,
        predicted_away_score: 3,
        predicted_penalty_winner: null,
      },
    ])
  })

  it('handles partial drafts falling back to prediction (away undefined)', () => {
    const input = createInput({
      drafts: new Map([['match1', { home: '3', away: undefined as any as string }]]),
      predictions: new Map([['match1', basePrediction]]),
    })

    const result = collectRoundDrafts(input)
    expect(result).toEqual([
      {
        match_id: 'match1',
        predicted_home_score: 3,
        predicted_away_score: 2,
        predicted_penalty_winner: null,
      },
    ])
  })

  it('handles partial drafts falling back to zero when no prediction', () => {
     const input = createInput({
      drafts: new Map([['match1', { home: '2', away: undefined as any as string }]]),
    })

    const result = collectRoundDrafts(input)
    expect(result).toEqual([
      {
        match_id: 'match1',
        predicted_home_score: 2,
        predicted_away_score: 0,
        predicted_penalty_winner: null,
      },
    ])
  })

  it('handles partial drafts falling back to zero when no prediction (home undefined)', () => {
     const input = createInput({
      drafts: new Map([['match1', { home: undefined as any as string, away: '2' }]]),
    })

    const result = collectRoundDrafts(input)
    expect(result).toEqual([
      {
        match_id: 'match1',
        predicted_home_score: 0,
        predicted_away_score: 2,
        predicted_penalty_winner: null,
      },
    ])
  })

  it('handles penalty winner fallback to prediction when penalty draft is missing', () => {
    const knockoutMatch = { ...baseMatch, decides_on_penalties: true }
    const input = createInput({
      roundMatches: [knockoutMatch],
      drafts: new Map([['match1', { home: '1', away: '1' }]]),
      predictions: new Map([['match1', { ...basePrediction, predicted_home_score: 1, predicted_away_score: 1, predicted_penalty_winner: 'away' }]]),
    })

    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })

  it('handles penalty winner fallback to prediction when penalty draft is missing BUT score changes', () => {
    const knockoutMatch = { ...baseMatch, decides_on_penalties: true }
    const input = createInput({
      roundMatches: [knockoutMatch],
      drafts: new Map([['match1', { home: '2', away: '2' }]]),
      predictions: new Map([['match1', { ...basePrediction, predicted_home_score: 1, predicted_away_score: 1, predicted_penalty_winner: 'away' }]]),
    })

    const result = collectRoundDrafts(input)
    expect(result).toEqual([{
        match_id: 'match1',
        predicted_home_score: 2,
        predicted_away_score: 2,
        predicted_penalty_winner: 'away',
    }])
  })

  it('handles explicit null penalty draft overriding prediction', () => {
    const knockoutMatch = { ...baseMatch, decides_on_penalties: true }
    const input = createInput({
      roundMatches: [knockoutMatch],
      drafts: new Map([['match1', { home: '1', away: '1' }]]),
      penaltyDrafts: new Map([['match1', null]]),
      predictions: new Map([['match1', { ...basePrediction, predicted_home_score: 1, predicted_away_score: 1, predicted_penalty_winner: 'away' }]]),
    })

    const result = collectRoundDrafts(input)
    expect(result).toEqual([])
  })
})
