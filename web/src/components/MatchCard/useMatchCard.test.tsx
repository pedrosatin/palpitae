import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMatchCard } from './useMatchCard'
import type { Match, Prediction } from './MatchCard'
import { invalidateApiCache } from '../../lib/api-cache'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
vi.mock('../../config', () => ({ config: { apiUrl: 'mockApiUrl' } }))
vi.mock('../../lib/api-cache', () => ({
  invalidateApiCache: vi.fn(),
}))

const mockFetch = vi.spyOn(globalThis, 'fetch')
const mockInvalidate = vi.mocked(invalidateApiCache)

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
    mockInvalidate.mockClear()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)
  })

  it('começa com os dois campos vazios quando não há palpite', () => {
    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch(),
        prediction: undefined,
        groupId: 'group-1',
        onSaved: vi.fn(),
      }),
    )

    expect(result.current.home).toBe('')
    expect(result.current.away).toBe('')
    expect(result.current.penaltyWinner).toBeNull()
    expect(result.current.status).toBe('empty')
    expect(result.current.canSave).toBe(false)
  })

  it('só libera o salvar de jogo sem palpite com os dois campos preenchidos', () => {
    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch(),
        prediction: undefined,
        groupId: 'group-1',
        onSaved: vi.fn(),
      }),
    )

    act(() => {
      result.current.updateHome('1')
    })
    expect(result.current.status).toBe('dirty')
    expect(result.current.canSave).toBe(false)

    act(() => {
      result.current.updateAway('0')
    })
    expect(result.current.canSave).toBe(true)
  })

  it('marca o palpite salvo como concluído até o placar mudar', () => {
    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch(),
        prediction: makePrediction(),
        groupId: 'group-1',
        onSaved: vi.fn(),
      }),
    )

    expect(result.current.status).toBe('saved')
    expect(result.current.saveDone).toBe(true)
    expect(result.current.canSave).toBe(false)

    act(() => {
      result.current.updateHome('4')
    })
    expect(result.current.status).toBe('dirty')
    expect(result.current.saveDone).toBe(false)
    expect(result.current.canSave).toBe(true)
  })

  it('initializes with prediction values', () => {
    const prediction = makePrediction({
      predicted_home_score: 3,
      predicted_away_score: 1,
      predicted_penalty_winner: 'home',
    })
    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch(),
        prediction,
        groupId: 'group-1',
        onSaved: vi.fn(),
      }),
    )

    expect(result.current.home).toBe('3')
    expect(result.current.away).toBe('1')
    expect(result.current.penaltyWinner).toBe('home')
  })

  it('updates score correctly and clears penalty winner if leaving draw', () => {
    const match = makeMatch({ decides_on_penalties: true })
    const prediction = makePrediction({
      predicted_home_score: 1,
      predicted_away_score: 1,
      predicted_penalty_winner: 'home',
    })
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
      }),
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
      }),
    )

    let updatedValue = ''
    const updateFn = (v: string) => {
      updatedValue = v
    }

    // Valid inputs
    act(() => {
      result.current.handleScoreInput('1', updateFn)
    })
    expect(updatedValue).toBe('1')

    act(() => {
      result.current.handleScoreInput('12', updateFn)
    })
    expect(updatedValue).toBe('12')

    act(() => {
      result.current.handleScoreInput('', updateFn)
    })
    expect(updatedValue).toBe('')

    // Invalid inputs
    updatedValue = 'unchanged'
    act(() => {
      result.current.handleScoreInput('123', updateFn)
    })
    expect(updatedValue).toBe('unchanged')

    act(() => {
      result.current.handleScoreInput('a', updateFn)
    })
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
      }),
    )

    act(() => {
      result.current.updateHome('1')
    })
    act(() => {
      result.current.updateAway('0')
    })

    expect(result.current.canSave).toBe(true)

    await act(async () => {
      await result.current.handleSave()
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'mockApiUrl/predictions',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          group_id: 'group-1',
          match_id: 'match-1',
          predicted_home_score: 1,
          predicted_away_score: 0,
          predicted_penalty_winner: null,
        }),
      }),
    )

    expect(onSaved).toHaveBeenCalledWith('match-1', 1, 0, null)
    expect(mockInvalidate).toHaveBeenCalledWith('groups:')
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
      }),
    )

    await act(async () => {
      await result.current.selectOutcome('home')
    })

    expect(result.current.home).toBe('1')
    expect(result.current.away).toBe('0')
    expect(result.current.selectedOutcome).toBe('home')
    expect(onDraftChange).toHaveBeenCalledWith('match-1', '1', '0')

    expect(mockFetch).toHaveBeenCalledWith(
      'mockApiUrl/predictions',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          group_id: 'group-1',
          match_id: 'match-1',
          predicted_home_score: 1,
          predicted_away_score: 0,
          predicted_penalty_winner: null,
        }),
      }),
    )
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
      }),
    )

    await act(async () => {
      await result.current.selectOutcome('draw')
    })
    await act(async () => {
      await result.current.selectPenaltyWinner('away')
    })

    expect(result.current.penaltyWinner).toBe('away')
    expect(onPenaltyDraftChange).toHaveBeenCalledWith('match-1', 'away')

    expect(mockFetch).toHaveBeenCalledWith(
      'mockApiUrl/predictions',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          group_id: 'group-1',
          match_id: 'match-1',
          predicted_home_score: 0,
          predicted_away_score: 0,
          predicted_penalty_winner: 'away',
        }),
      }),
    )
    expect(onSaved).toHaveBeenCalledWith('match-1', 0, 0, 'away')
  })

  it('não grava 0×0 quando o pênalti chega com os campos vazios no modo só vencedor', async () => {
    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch({ decides_on_penalties: true }),
        prediction: undefined,
        groupId: 'group-1',
        outcomeOnly: true,
        onSaved: vi.fn(),
      }),
    )

    await act(async () => {
      await result.current.selectPenaltyWinner('away')
    })

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('selectOutcome draw for match with penalties does not save immediately', async () => {
    const onSaved = vi.fn()

    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch({ decides_on_penalties: true }),
        prediction: undefined,
        groupId: 'group-1',
        onSaved,
      }),
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

  it('sets error when save fails', async () => {
    const onSaved = vi.fn()
    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch(),
        prediction: undefined,
        groupId: 'group-1',
        onSaved,
      }),
    )

    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Mock error message' }),
    } as Response)

    act(() => {
      result.current.updateHome('1')
    })
    act(() => {
      result.current.updateAway('0')
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(result.current.error).toBe('Mock error message')
    expect(result.current.saved).toBe(false)
    expect(onSaved).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it('reverts saved state after timeout', async () => {
    vi.useFakeTimers()
    const onSaved = vi.fn()
    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch(),
        prediction: undefined,
        groupId: 'group-1',
        onSaved,
      }),
    )

    act(() => {
      result.current.updateHome('1')
    })
    act(() => {
      result.current.updateAway('0')
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(result.current.saved).toBe(true)

    act(() => {
      vi.advanceTimersByTime(2500)
    })

    expect(result.current.saved).toBe(false)
    vi.useRealTimers()
  })

  it('o timer do envio anterior não apaga o "salvo" de um envio novo', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useMatchCard({
        match: makeMatch(),
        prediction: undefined,
        groupId: 'group-1',
        outcomeOnly: true,
        onSaved: vi.fn(),
      }),
    )

    await act(async () => {
      await result.current.selectOutcome('home')
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    await act(async () => {
      await result.current.selectOutcome('away')
    })

    // O timer do primeiro envio venceria aqui.
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current.saved).toBe(true)

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.saved).toBe(false)
    vi.useRealTimers()
  })

  it('sair da tela cancela o timer do "salvo"', async () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() =>
      useMatchCard({
        match: makeMatch(),
        prediction: undefined,
        groupId: 'group-1',
        outcomeOnly: true,
        onSaved: vi.fn(),
      }),
    )

    await act(async () => {
      await result.current.selectOutcome('home')
    })
    expect(vi.getTimerCount()).toBe(1)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('updateAway correctly updates state and clears penalty winner if leaving draw', () => {
    const match = makeMatch({ decides_on_penalties: true })
    const prediction = makePrediction({
      predicted_home_score: 1,
      predicted_away_score: 1,
      predicted_penalty_winner: 'home',
    })
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
      }),
    )

    act(() => {
      result.current.updateAway('2')
    })

    expect(result.current.away).toBe('2')
    expect(onDraftChange).toHaveBeenCalledWith('match-1', '1', '2')
    expect(result.current.penaltyWinner).toBeNull()
    expect(onPenaltyDraftChange).toHaveBeenCalledWith('match-1', null)
  })

  it('selectOutcome clears penaltyWinner when changing from draw to definitive outcome', async () => {
    const match = makeMatch({ decides_on_penalties: true })
    const prediction = makePrediction({
      predicted_home_score: 1,
      predicted_away_score: 1,
      predicted_penalty_winner: 'home',
    })
    const onPenaltyDraftChange = vi.fn()

    const { result } = renderHook(() =>
      useMatchCard({
        match,
        prediction,
        groupId: 'group-1',
        onSaved: vi.fn(),
        onPenaltyDraftChange,
      }),
    )

    await act(async () => {
      await result.current.selectOutcome('home')
    })

    expect(result.current.penaltyWinner).toBeNull()
    expect(onPenaltyDraftChange).toHaveBeenCalledWith('match-1', null)
  })
})
