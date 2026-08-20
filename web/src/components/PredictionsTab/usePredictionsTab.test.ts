import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePredictionsTab } from './usePredictionsTab'
import * as ga from '../../analytics/ga'
import { makeMatch } from '../matchFixtures'

vi.mock('../../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

const mockTrackEvent = vi.mocked(ga.trackEvent)

function mockFetch(
  matches: ReturnType<typeof makeMatch>[],
  predictions: any[] = [],
  groups: any[] = [],
  defaultRound: string | null = null,
) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()
    if (u.includes('/matches')) {
      return Promise.resolve(
        new Response(JSON.stringify({ matches, default_round: defaultRound }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (u.includes('/predictions?group_id')) {
      return Promise.resolve(
        new Response(JSON.stringify({ predictions }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (u.includes('/groups')) {
      return Promise.resolve(
        new Response(JSON.stringify({ groups }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (u.includes('/predictions/bulk')) {
      return Promise.resolve(
        new Response(JSON.stringify({ saved: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (u.includes('/predictions/import')) {
      return Promise.resolve(
        new Response(JSON.stringify({ imported: 1, locked_skipped: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    return Promise.reject(new Error(`Unhandled request: ${u}`))
  })
}

describe('usePredictionsTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches matches and predictions and sets up rounds', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'scheduled' }),
      makeMatch({ id: 'm2', round: '2', status: 'scheduled' }),
    ]
    const preds = [
      {
        id: 'p1',
        match_id: 'm1',
        predicted_home_score: 1,
        predicted_away_score: 0,
        locked: 0,
        updated_at: new Date().toISOString(),
        points_awarded: 0,
      },
    ]
    mockFetch(matches, preds, [], '1')

    const { result } = renderHook(() => usePredictionsTab('g1', 'c1'))

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.matches).toHaveLength(2)
    expect(result.current.predictions.size).toBe(1)
    expect(result.current.predictions.get('m1')?.predicted_home_score).toBe(1)
    expect(result.current.roundKeys).toEqual(['1', '2'])
    expect(result.current.selectedRound).toBe('1') // explicitly set default_round
  })

  it('navigates between rounds', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'scheduled' }),
      makeMatch({ id: 'm2', round: '2', status: 'scheduled' }),
    ]
    mockFetch(matches, [], [], '1')
    const { result } = renderHook(() => usePredictionsTab('g1', 'c1'))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.selectedRound).toBe('1')

    act(() => {
      result.current.next()
    })

    expect(result.current.selectedRound).toBe('2')
    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_proxima_rodada', { round: '2' })

    act(() => {
      result.current.prev()
    })

    expect(result.current.selectedRound).toBe('1')
    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_rodada_anterior', { round: '1' })
  })

  it('handles draft changes and saving', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    mockFetch(matches, [], [], '1')
    const { result } = renderHook(() => usePredictionsTab('g1', 'c1'))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.pendingCount).toBe(0)

    act(() => {
      result.current.handleDraftChange('m1', '2', '1')
    })

    expect(result.current.pendingCount).toBe(1)

    const saveSpy = vi.spyOn(globalThis, 'fetch')

    await act(async () => {
      await result.current.handleSaveAll()
    })

    expect(saveSpy).toHaveBeenCalledWith(
      expect.stringContaining('/predictions/bulk'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          group_id: 'g1',
          predictions: [
            {
              match_id: 'm1',
              predicted_home_score: 2,
              predicted_away_score: 1,
              predicted_penalty_winner: null,
            },
          ],
        }),
      }),
    )
    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_salvar_todos', {
      count: 1,
      round: '1',
    })
  })

  it('handles import', async () => {
    mockFetch([], [], [{ id: 'g2', name: 'Other Group', competition_id: 'c1' }])
    const { result } = renderHook(() => usePredictionsTab('g1', 'c1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.otherGroups).toHaveLength(1)
    })

    expect(result.current.otherGroups).toEqual([
      { id: 'g2', name: 'Other Group', competition_id: 'c1' },
    ])

    act(() => {
      result.current.setImportSourceId('g2')
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await act(async () => {
      await result.current.handleImport()
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/predictions/import'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          source_group_id: 'g2',
          target_group_id: 'g1',
        }),
      }),
    )
    expect(result.current.importFeedback?.ok).toBe(true)
  })
})
