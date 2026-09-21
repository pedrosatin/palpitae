import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useCreateGroupForm, validateScoringRules, buildGroupPayload } from './useCreateGroupForm'
import { apiFetch } from '../../../lib/api'
import { trackEvent } from '../../../analytics/ga'
import { act } from '@testing-library/react'

vi.mock('../../../lib/api', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('../../../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

const mockApiFetch = vi.mocked(apiFetch)
const mockTrackEvent = vi.mocked(trackEvent)

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onCreated: vi.fn(),
}

describe('validateScoringRules', () => {
  it('returns error if pointsExact is less than pointsWinner and greater than 0', () => {
    expect(validateScoringRules(1, 2)).toBe('Pontos por placar exato deve ser maior ou igual a pontos por vencedor')
  })

  it('returns error if both points are 0', () => {
    expect(validateScoringRules(0, 0)).toBe('Pelo menos um tipo de pontuação deve ser maior que zero')
  })

  it('returns null for valid scoring rules', () => {
    expect(validateScoringRules(3, 1)).toBeNull()
    expect(validateScoringRules(0, 1)).toBeNull()
  })
})

describe('buildGroupPayload', () => {
  it('trims name and sets correctly fields when showPenaltyField is true', () => {
    const params = {
      name: '  My Group  ',
      competitionId: 'c1',
      pointsExact: 3,
      pointsWinner: 1,
      pointsPenalty: 2,
      showPenaltyField: true,
      predictionsVisibility: 'public' as const
    }
    const payload = buildGroupPayload(params)
    expect(payload).toEqual({
      name: 'My Group',
      competition_id: 'c1',
      points_exact: 3,
      points_winner: 1,
      points_penalty: 2,
      predictions_visibility: 'public'
    })
  })

  it('sets points_penalty to 1 when showPenaltyField is false', () => {
    const params = {
      name: 'Group 2',
      competitionId: 'c2',
      pointsExact: 3,
      pointsWinner: 1,
      pointsPenalty: 5,
      showPenaltyField: false,
      predictionsVisibility: 'hidden' as const
    }
    const payload = buildGroupPayload(params)
    expect(payload.points_penalty).toBe(1)
  })
})

describe('useCreateGroupForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes with default state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ competitions: [] })),
    )

    const { result } = renderHook(() => useCreateGroupForm(defaultProps))

    await waitFor(() => {
      expect(result.current.loadingCompetitions).toBe(false)
    })

    expect(result.current.name).toBe('')
    expect(result.current.competitionId).toBe('')
    expect(result.current.scoringPreset).toBe('classic')
    expect(result.current.pointsExact).toBe(3)
    expect(result.current.pointsWinner).toBe(1)
    expect(result.current.pointsPenalty).toBe(1)
    expect(result.current.predictionsVisibility).toBe('hidden')
    expect(result.current.error).toBeNull()
    expect(result.current.created).toBeNull()
    expect(result.current.submitting).toBe(false)
    expect(result.current.showPenaltyField).toBe(false)
  })

  it('fetches competitions and sets the first as default', async () => {
    const competitions = [
      { id: 'c1', name: 'Comp 1', has_penalty_phases: false },
      { id: 'c2', name: 'Comp 2', has_penalty_phases: true },
    ]
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ competitions })),
    )

    const { result } = renderHook(() => useCreateGroupForm(defaultProps))

    expect(result.current.loadingCompetitions).toBe(true)

    await waitFor(() => {
      expect(result.current.loadingCompetitions).toBe(false)
    })

    expect(result.current.competitions).toEqual(competitions)
    expect(result.current.competitionId).toBe('c1')
    expect(result.current.showPenaltyField).toBe(false)
  })

  it('sets showPenaltyField correctly', async () => {
    const competitions = [
      { id: 'c1', name: 'Comp 1', has_penalty_phases: false },
      { id: 'c2', name: 'Comp 2', has_penalty_phases: true },
    ]
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ competitions })),
    )

    const { result } = renderHook(() => useCreateGroupForm(defaultProps))

    await waitFor(() => {
      expect(result.current.competitions).toEqual(competitions)
    })

    act(() => {
      result.current.setCompetitionId('c2')
    })

    expect(result.current.showPenaltyField).toBe(true)
  })

  it('handles competitions fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Fetch failed'))

    const { result } = renderHook(() => useCreateGroupForm(defaultProps))

    await waitFor(() => {
      expect(result.current.loadingCompetitions).toBe(false)
    })

    expect(result.current.error).toBe('Não foi possível carregar as competições')
  })

  it('does not submit when points validations fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ competitions: [{ id: 'c1' }] })),
    )

    const { result } = renderHook(() => useCreateGroupForm(defaultProps))

    await waitFor(() => {
      expect(result.current.competitions.length).toBe(1)
    })

    const e = { preventDefault: vi.fn() } as unknown as React.FormEvent

    // pointsExact < pointsWinner
    act(() => {
      result.current.setPointsExact(1)
      result.current.setPointsWinner(2)
    })

    await act(async () => {
      await result.current.handleSubmit(e)
    })
    expect(result.current.error).toBe(
      'Pontos por placar exato deve ser maior ou igual a pontos por vencedor',
    )

    // pointsExact + pointsWinner === 0
    act(() => {
      result.current.setPointsExact(0)
      result.current.setPointsWinner(0)
    })

    await act(async () => {
      await result.current.handleSubmit(e)
    })
    expect(result.current.error).toBe('Pelo menos um tipo de pontuação deve ser maior que zero')

    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('creates group successfully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ competitions: [{ id: 'c1' }] })),
    )

    const createdGroup = { id: 'g1', name: 'My Group' }
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: createdGroup }),
    } as Response)

    const { result } = renderHook(() => useCreateGroupForm(defaultProps))

    await waitFor(() => {
      expect(result.current.competitions.length).toBe(1)
    })

    act(() => {
      result.current.setName('My Group')
    })

    const e = { preventDefault: vi.fn() } as unknown as React.FormEvent

    await act(async () => {
      await result.current.handleSubmit(e)
    })

    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/groups'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'My Group',
          competition_id: 'c1',
          points_exact: 3,
          points_winner: 1,
          points_penalty: 1,
          predictions_visibility: 'hidden',
        }),
      }),
    )

    expect(mockTrackEvent).toHaveBeenCalledWith('submit_criar_grupo')
    expect(defaultProps.onCreated).toHaveBeenCalledWith(createdGroup)
    expect(result.current.created).toEqual(createdGroup)
    expect(result.current.error).toBeNull()
  })

  it('handles API error response on creation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ competitions: [{ id: 'c1' }] })),
    )

    mockApiFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Nome já existe' }),
    } as Response)

    const { result } = renderHook(() => useCreateGroupForm(defaultProps))

    await waitFor(() => {
      expect(result.current.competitions.length).toBe(1)
    })

    const e = { preventDefault: vi.fn() } as unknown as React.FormEvent

    await act(async () => {
      await result.current.handleSubmit(e)
    })

    expect(result.current.error).toBe('Nome já existe')
    expect(result.current.created).toBeNull()
  })

  it('handles fetch exception on creation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ competitions: [{ id: 'c1' }] })),
    )

    mockApiFetch.mockRejectedValueOnce(new Error('Network offline'))

    const { result } = renderHook(() => useCreateGroupForm(defaultProps))

    await waitFor(() => {
      expect(result.current.competitions.length).toBe(1)
    })

    const e = { preventDefault: vi.fn() } as unknown as React.FormEvent

    await act(async () => {
      await result.current.handleSubmit(e)
    })

    expect(result.current.error).toBe('Erro de conexão. Tente novamente.')
  })

  it('handles closing modal properly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ competitions: [{ id: 'c1' }] })),
    )

    const { result } = renderHook(() => useCreateGroupForm(defaultProps))

    await waitFor(() => {
      expect(result.current.competitions.length).toBe(1)
    })

    act(() => {
      result.current.setName('Dirty State')
      result.current.handleClose()
    })

    expect(result.current.name).toBe('')
    expect(defaultProps.onClose).toHaveBeenCalled()
  })
})
