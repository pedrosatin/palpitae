import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMatchCard } from './useMatchCard'
import type { Match, Prediction } from './MatchCard'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
vi.mock('../../config', () => ({ config: { apiUrl: 'mockApiUrl' } }))

const mockFetch = vi.spyOn(globalThis, 'fetch')

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 'match-1',
    start_time: new Date(Date.now() + 3_600_000).toISOString(),
    status: 'scheduled',
    home_score: null,
    away_score: null,
    phase: 'group',
    round: '1',
    round_label: 'Rodada 1',
    group_name: null,
    home_team_id: 'ht-1',
    home_team_name: 'Brasil',
    home_team_short_name: 'BRA',
    home_team_logo: '/bra.png',
    away_team_id: 'at-1',
    away_team_name: 'Argentina',
    away_team_short_name: 'ARG',
    away_team_logo: '/arg.png',
    ...overrides,
  }
}

function makePrediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    id: 'pred-1',
    match_id: 'match-1',
    predicted_home_score: 1,
    predicted_away_score: 2,
    points_awarded: 0,
    locked: 0,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('useMatchCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)
  })

  it('initializes with default values when there is no prediction', () => {
    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch(),
        prediction: undefined,
        groupId: 'group-1',
        onSaved: vi.fn(),
      })
    )

    expect(result.current.home).toBe('0')
    expect(result.current.away).toBe('0')
    expect(result.current.penaltyWinner).toBeNull()
    expect(result.current.canSave).toBe(true)
  })

  it('initializes with prediction values', () => {
    const prediction = makePrediction({ predicted_home_score: 3, predicted_away_score: 1, predicted_penalty_winner: 'home' })
    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch(),
        prediction,
        groupId: 'group-1',
        onSaved: vi.fn(),
      })
    )

    expect(result.current.home).toBe('3')
    expect(result.current.away).toBe('1')
    expect(result.current.penaltyWinner).toBe('home')
  })

  it('updates score correctly and clears penalty winner if leaving draw', () => {
    const match = makeMatch({ decides_on_penalties: true })
    const prediction = makePrediction({ predicted_home_score: 1, predicted_away_score: 1, predicted_penalty_winner: 'home' })
    const onDraftChange = vi.fn()
    const onPenaltyDraftChange = vi.fn()

    const { result } = renderHook(() =>
      useMatchCard({
        match,
        prediction,
        groupId: 'group-1',
        onSaved: vi.fn(),
        onDraftChange,
        onPenaltyDraftChange,
      })
    )

    expect(result.current.home).toBe('1')
    expect(result.current.away).toBe('1')
    expect(result.current.penaltyWinner).toBe('home')

    act(() => {
      result.current.updateHome('2')
    })

    expect(result.current.home).toBe('2')
    expect(onDraftChange).toHaveBeenCalledWith('match-1', '2', '1')
    expect(result.current.penaltyWinner).toBeNull()
    expect(onPenaltyDraftChange).toHaveBeenCalledWith('match-1', null)
  })

  it('handleScoreInput validates input', () => {
    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch(),
        prediction: undefined,
        groupId: 'group-1',
        onSaved: vi.fn(),
      })
    )

    let updatedValue = ''
    const updateFn = (v: string) => { updatedValue = v }

    // Valid inputs
    act(() => { result.current.handleScoreInput('1', updateFn) })
    expect(updatedValue).toBe('1')

    act(() => { result.current.handleScoreInput('12', updateFn) })
    expect(updatedValue).toBe('12')

    act(() => { result.current.handleScoreInput('', updateFn) })
    expect(updatedValue).toBe('')

    // Invalid inputs
    updatedValue = 'unchanged'
    act(() => { result.current.handleScoreInput('123', updateFn) })
    expect(updatedValue).toBe('unchanged')

    act(() => { result.current.handleScoreInput('a', updateFn) })
    expect(updatedValue).toBe('unchanged')
  })

  it('handleSave calls persist API and updates states', async () => {
    const onSaved = vi.fn()
    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch(),
        prediction: undefined,
        groupId: 'group-1',
        onSaved,
      })
    )

    act(() => {
      result.current.updateHome('1')
    })

    expect(result.current.canSave).toBe(true)

    await act(async () => {
      await result.current.handleSave()
    })

    expect(mockFetch).toHaveBeenCalledWith('mockApiUrl/predictions', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        group_id: 'group-1',
        match_id: 'match-1',
        predicted_home_score: 1,
        predicted_away_score: 0,
        predicted_penalty_winner: null,
      })
    }))

    expect(onSaved).toHaveBeenCalledWith('match-1', 1, 0, null)
  })

  it('selectOutcome logic for home', async () => {
    const onSaved = vi.fn()
    const onDraftChange = vi.fn()

    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch(),
        prediction: undefined,
        groupId: 'group-1',
        onSaved,
        onDraftChange,
      })
    )

    await act(async () => {
      await result.current.selectOutcome('home')
    })

    expect(result.current.home).toBe('1')
    expect(result.current.away).toBe('0')
    expect(result.current.selectedOutcome).toBe('home')
    expect(onDraftChange).toHaveBeenCalledWith('match-1', '1', '0')

    expect(mockFetch).toHaveBeenCalledWith('mockApiUrl/predictions', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          group_id: 'group-1',
          match_id: 'match-1',
          predicted_home_score: 1,
          predicted_away_score: 0,
          predicted_penalty_winner: null,
        })
    }))
  })

  it('selectPenaltyWinner logic updates state and saves if outcomeOnly', async () => {
    const onPenaltyDraftChange = vi.fn()
    const onSaved = vi.fn()

    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch({ decides_on_penalties: true }),
        prediction: undefined,
        groupId: 'group-1',
        outcomeOnly: true,
        onSaved,
        onPenaltyDraftChange,
      })
    )

    await act(async () => {
      await result.current.selectPenaltyWinner('away')
    })

    expect(result.current.penaltyWinner).toBe('away')
    expect(onPenaltyDraftChange).toHaveBeenCalledWith('match-1', 'away')

    expect(mockFetch).toHaveBeenCalledWith('mockApiUrl/predictions', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          group_id: 'group-1',
          match_id: 'match-1',
          predicted_home_score: 0,
          predicted_away_score: 0,
          predicted_penalty_winner: 'away',
        })
    }))
    expect(onSaved).toHaveBeenCalledWith('match-1', 0, 0, 'away')
  })

  it('selectOutcome draw for match with penalties does not save immediately', async () => {
    const onSaved = vi.fn()

    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch({ decides_on_penalties: true }),
        prediction: undefined,
        groupId: 'group-1',
        onSaved,
      })
    )

    await act(async () => {
      await result.current.selectOutcome('draw')
    })

    expect(result.current.home).toBe('0')
    expect(result.current.away).toBe('0')
    expect(result.current.selectedOutcome).toBe('draw')

    // fetch should NOT be called because penalty winner is not decided yet
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
