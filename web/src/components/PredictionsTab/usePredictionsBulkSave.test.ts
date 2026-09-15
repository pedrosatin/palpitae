import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePredictionsBulkSave } from './usePredictionsBulkSave'
import * as ga from '../../analytics/ga'
import { makeMatch } from '../matchFixtures'
import type { Prediction } from '../MatchCard'

vi.mock('../../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

const mockTrackEvent = vi.mocked(ga.trackEvent)

function mockFetch(responses: Record<string, any> | Error = { saved: ['m1'] }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()
    if (u.includes('/predictions/bulk')) {
      if (responses instanceof Error) {
        return Promise.reject(responses)
      }
      if (responses.error) {
        return Promise.resolve(
          new Response(JSON.stringify(responses), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (responses.invalidJson) {
        return Promise.resolve(
          new Response("Invalid JSON", {
            status: 400,
            headers: { 'Content-Type': 'text/plain' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(responses), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    return Promise.reject(new Error(`Unhandled request: ${u}`))
  })
}

describe('usePredictionsBulkSave', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('calculates pending count correctly and handles draft changes', () => {
    const setPredictions = vi.fn()
    const matches = [makeMatch({ id: 'm1', status: 'scheduled' })]
    const { result } = renderHook(() =>
      usePredictionsBulkSave('g1', matches, new Map(), setPredictions, '1')
    )

    expect(result.current.pendingCount).toBe(0)

    act(() => {
      result.current.handleDraftChange('m1', '2', '1')
    })

    expect(result.current.pendingCount).toBe(1)

    act(() => {
      result.current.handlePenaltyDraftChange('m1', 'home')
    })
    expect(result.current.pendingCount).toBe(1)
  })

  it('saves all drafts successfully and updates predictions', async () => {
    let setPredictionsCallback: (prev: Map<string, Prediction>) => Map<string, Prediction> = () => new Map()
    const setPredictions = vi.fn((cb) => {
      setPredictionsCallback = cb
    })
    const matches = [makeMatch({ id: 'm1', status: 'scheduled' })]
    mockFetch({ saved: ['m1'] })

    const { result } = renderHook(() =>
      usePredictionsBulkSave('g1', matches, new Map(), setPredictions, '1')
    )

    act(() => {
      result.current.handleDraftChange('m1', '2', '1')
    })

    await act(async () => {
      await result.current.handleSaveAll()
    })

    expect(result.current.savedAll).toBe(true)
    expect(setPredictions).toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_salvar_todos', {
      count: 1,
      round: '1',
    })

    // verify that state update function works correctly
    const initialPredictions = new Map([
      ['m1', {
        id: 'old-id',
        match_id: 'm1',
        predicted_home_score: 0,
        predicted_away_score: 0,
        predicted_penalty_winner: null,
        points_awarded: 10,
        penalty_points: 5,
        locked: 0,
        updated_at: '2023-01-01T00:00:00.000Z'
      } as Prediction]
    ])

    const updatedPredictions = setPredictionsCallback(initialPredictions)
    const m1Pred = updatedPredictions.get('m1')
    expect(m1Pred?.predicted_home_score).toBe(2)
    expect(m1Pred?.predicted_away_score).toBe(1)
    expect(m1Pred?.points_awarded).toBe(10)
    expect(m1Pred?.penalty_points).toBe(5)
    expect(m1Pred?.id).toBe('old-id')

    // test when no previous prediction exists
    const updatedPredictionsNoPrev = setPredictionsCallback(new Map())
    const m1PredNew = updatedPredictionsNoPrev.get('m1')
    expect(m1PredNew?.predicted_home_score).toBe(2)
    expect(m1PredNew?.predicted_away_score).toBe(1)
    expect(m1PredNew?.points_awarded).toBe(0)
    expect(m1PredNew?.penalty_points).toBe(0)
    expect(m1PredNew?.id).toBe('')

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.savedAll).toBe(false)
  })

  it('handles save error from API with message', async () => {
    const setPredictions = vi.fn()
    const matches = [makeMatch({ id: 'm1', status: 'scheduled' })]
    mockFetch({ error: 'Save failed' })

    const { result } = renderHook(() =>
      usePredictionsBulkSave('g1', matches, new Map(), setPredictions, '1')
    )

    act(() => {
      result.current.handleDraftChange('m1', '2', '1')
    })

    await act(async () => {
      await result.current.handleSaveAll()
    })

    expect(result.current.bulkError).toBe('Save failed')
    expect(result.current.savedAll).toBe(false)
  })

  it('handles save error from API with unparseable response', async () => {
    const setPredictions = vi.fn()
    const matches = [makeMatch({ id: 'm1', status: 'scheduled' })]
    mockFetch({ invalidJson: true })

    const { result } = renderHook(() =>
      usePredictionsBulkSave('g1', matches, new Map(), setPredictions, '1')
    )

    act(() => {
      result.current.handleDraftChange('m1', '2', '1')
    })

    await act(async () => {
      await result.current.handleSaveAll()
    })

    expect(result.current.bulkError).toBe('Erro ao salvar palpites')
    expect(result.current.savedAll).toBe(false)
  })

  it('handles network error', async () => {
    const setPredictions = vi.fn()
    const matches = [makeMatch({ id: 'm1', status: 'scheduled' })]
    mockFetch(new Error('Network error'))

    const { result } = renderHook(() =>
      usePredictionsBulkSave('g1', matches, new Map(), setPredictions, '1')
    )

    act(() => {
      result.current.handleDraftChange('m1', '2', '1')
    })

    await act(async () => {
      await result.current.handleSaveAll()
    })

    expect(result.current.bulkError).toBe('Network error')
  })

  it('does not save if no pending drafts', async () => {
    const setPredictions = vi.fn()
    const matches = [makeMatch({ id: 'm1', status: 'scheduled' })]
    mockFetch({ saved: ['m1'] })

    const { result } = renderHook(() =>
      usePredictionsBulkSave('g1', matches, new Map(), setPredictions, '1')
    )

    await act(async () => {
      await result.current.handleSaveAll()
    })

    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('clears timers and savedAll on unmount and selectedRound change', () => {
    const setPredictions = vi.fn()
    let round: string | undefined = '1'
    const { result, rerender, unmount } = renderHook(() =>
      usePredictionsBulkSave('g1', [], new Map(), setPredictions, round)
    )

    act(() => {
      round = '2'
      rerender()
    })

    expect(result.current.savedAll).toBe(false)

    act(() => {
      round = undefined
      rerender()
    })

    unmount()
  })
})
