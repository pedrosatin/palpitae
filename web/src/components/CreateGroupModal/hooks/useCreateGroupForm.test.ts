import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { useCreateGroupForm } from './useCreateGroupForm'
import { apiFetch } from '../../../lib/api'
import { trackEvent } from '../../../analytics/ga'
import { act } from '@testing-library/react'
import { captureGuideOrigin } from '../../../analytics/guideOrigin'

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api')>()),
  apiFetch: vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    globalThis.fetch(input, { ...init, credentials: 'include' }),
  ),
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

describe('useCreateGroupForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
    sessionStorage.clear()
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

  it('drops finished competitions and defaults to the first ongoing one', async () => {
    const competitions = [
      { id: 'c1', name: 'Brasileirão', status: 'ongoing', has_penalty_phases: false },
      { id: 'c2', name: 'Champions League', status: 'upcoming', has_penalty_phases: false },
      { id: 'c3', name: 'Copa do Mundo', status: 'finished', has_penalty_phases: false },
    ]
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ competitions })),
    )

    const { result } = renderHook(() => useCreateGroupForm(defaultProps))

    await waitFor(() => {
      expect(result.current.loadingCompetitions).toBe(false)
    })

    expect(result.current.competitions).toEqual([competitions[0], competitions[1]])
    expect(result.current.competitionId).toBe('c1')
  })

  it('falls back to the first upcoming competition when none is ongoing', async () => {
    const competitions = [
      { id: 'c1', name: 'Copa do Nordeste', status: 'upcoming', has_penalty_phases: false },
      { id: 'c2', name: 'Copa do Mundo', status: 'finished', has_penalty_phases: false },
    ]
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ competitions })),
    )

    const { result } = renderHook(() => useCreateGroupForm(defaultProps))

    await waitFor(() => {
      expect(result.current.competitions.length).toBe(1)
    })

    expect(result.current.competitionId).toBe('c1')
  })

  describe('competição pedida pelo link', () => {
    const serieA2026 = {
      id: 'bsa-2026',
      name: 'Campeonato Brasileiro Série A',
      slug: 'campeonato-brasileiro-serie-a-2026',
      season: '2026',
      status: 'ongoing',
    }
    const serieA2027 = {
      id: 'bsa-2027',
      name: 'Campeonato Brasileiro Série A',
      slug: 'campeonato-brasileiro-serie-a-2027',
      season: '2027',
      status: 'upcoming',
    }
    const slug2027 = serieA2027.slug

    // As chamadas de apiFetch se acumulam entre os testes; o POST daqui não pode
    // aparecer no teste de validação mais abaixo.
    afterEach(() => mockApiFetch.mockClear())

    function mockCompetitions(competitions: unknown[]) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ competitions })),
      )
    }

    it('escolhe a competição do slug mesmo quando ela não é a primeira', async () => {
      mockCompetitions([serieA2027, serieA2026])

      const { result } = renderHook(() =>
        useCreateGroupForm({ ...defaultProps, preferredCompetitionSlug: slug2027 }),
      )

      await waitFor(() => expect(result.current.competitions).toHaveLength(2))
      expect(result.current.competitions[0].id).toBe('bsa-2026')
      expect(result.current.competitionId).toBe('bsa-2027')
      expect(result.current.preferredCompetitionUnavailable).toBe(false)
    })

    it('fica na primeira e sinaliza o aviso quando o slug não está na lista', async () => {
      mockCompetitions([serieA2026, { ...serieA2027, status: 'finished' }])

      const { result } = renderHook(() =>
        useCreateGroupForm({ ...defaultProps, preferredCompetitionSlug: slug2027 }),
      )

      await waitFor(() => expect(result.current.loadingCompetitions).toBe(false))
      expect(result.current.competitionId).toBe('bsa-2026')
      expect(result.current.preferredCompetitionUnavailable).toBe(true)
    })

    it('não sinaliza aviso sem slug', async () => {
      mockCompetitions([serieA2026])

      const { result } = renderHook(() => useCreateGroupForm(defaultProps))

      await waitFor(() => expect(result.current.loadingCompetitions).toBe(false))
      expect(result.current.competitionId).toBe('bsa-2026')
      expect(result.current.preferredCompetitionUnavailable).toBe(false)
    })

    it('não sinaliza aviso antes de a lista chegar', () => {
      vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise(() => {}))

      const { result } = renderHook(() =>
        useCreateGroupForm({ ...defaultProps, preferredCompetitionSlug: slug2027 }),
      )

      expect(result.current.loadingCompetitions).toBe(true)
      expect(result.current.preferredCompetitionUnavailable).toBe(false)
    })

    it('deixa a pessoa trocar a competição escolhida pelo link', async () => {
      mockCompetitions([serieA2026, serieA2027])

      const { result } = renderHook(() =>
        useCreateGroupForm({ ...defaultProps, preferredCompetitionSlug: slug2027 }),
      )

      await waitFor(() => expect(result.current.competitionId).toBe('bsa-2027'))
      act(() => result.current.setCompetitionId('bsa-2026'))
      expect(result.current.competitionId).toBe('bsa-2026')
    })

    it('volta ao padrão depois de fechar, sem pré-seleção nem aviso', async () => {
      mockCompetitions([serieA2026, serieA2027])
      let props = { ...defaultProps, preferredCompetitionSlug: slug2027 as string | undefined }

      const { result, rerender } = renderHook(() => useCreateGroupForm(props))

      await waitFor(() => expect(result.current.competitionId).toBe('bsa-2027'))
      act(() => result.current.handleClose())
      // O painel fecha o modal e descarta a competição do link.
      props = { ...props, isOpen: false, preferredCompetitionSlug: undefined }
      rerender()
      props = { ...props, isOpen: true }
      rerender()

      expect(result.current.competitionId).toBe('bsa-2026')
      expect(result.current.preferredCompetitionUnavailable).toBe(false)
    })

    it('limpa o aviso depois de fechar e reabrir sem slug', async () => {
      mockCompetitions([serieA2026])
      let props = { ...defaultProps, preferredCompetitionSlug: slug2027 as string | undefined }

      const { result, rerender } = renderHook(() => useCreateGroupForm(props))

      await waitFor(() => expect(result.current.preferredCompetitionUnavailable).toBe(true))
      act(() => result.current.handleClose())
      props = { ...props, isOpen: false, preferredCompetitionSlug: undefined }
      rerender()
      props = { ...props, isOpen: true }
      rerender()

      expect(result.current.competitionId).toBe('bsa-2026')
      expect(result.current.preferredCompetitionUnavailable).toBe(false)
    })

    it('envia a competição do link no POST /groups', async () => {
      captureGuideOrigin('?from=guia_bolao-do-brasileirao')
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ competitions: [serieA2026, serieA2027] })),
        )
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ group: { id: 'g1', name: 'Bolão 2027', invite_code: 'INV' } }),
        } as Response)

      const { result } = renderHook(() =>
        useCreateGroupForm({ ...defaultProps, preferredCompetitionSlug: slug2027 }),
      )

      await waitFor(() => expect(result.current.competitionId).toBe('bsa-2027'))
      act(() => result.current.setName('Bolão 2027'))
      await act(async () => {
        await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent)
      })

      const post = mockApiFetch.mock.calls.find((call) => String(call[0]).endsWith('/groups'))
      expect(JSON.parse(String(post![1]!.body)).competition_id).toBe('bsa-2027')
      expect(mockTrackEvent).toHaveBeenCalledWith('submit_criar_grupo', {
        origem: 'guia_bolao-do-brasileirao',
      })
    })
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

    // A listagem de competições agora passa por apiFetch; o POST /groups é que
    // não pode acontecer.
    expect(
      mockApiFetch.mock.calls.filter((call) => String(call[0]).includes('/groups')),
    ).toHaveLength(0)
  })

  it('creates group successfully', async () => {
    captureGuideOrigin('?from=guia_planilha-de-bolao')
    const createdGroup = { id: 'g1', name: 'My Group' }
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ competitions: [{ id: 'c1' }] })))
      .mockResolvedValueOnce({
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
          points_classified: 0,
          predictions_visibility: 'hidden',
        }),
      }),
    )

    expect(mockTrackEvent).toHaveBeenCalledWith('submit_criar_grupo', {
      origem: 'guia_planilha-de-bolao',
    })
    expect(defaultProps.onCreated).toHaveBeenCalledWith(createdGroup)
    expect(result.current.created).toEqual(createdGroup)
    expect(result.current.error).toBeNull()
  })

  it('handles API error response on creation', async () => {
    captureGuideOrigin('?from=guia_planilha-de-bolao')
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ competitions: [{ id: 'c1' }] })))
      .mockResolvedValueOnce({
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
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('handles fetch exception on creation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ competitions: [{ id: 'c1' }] })))
      .mockRejectedValueOnce(new Error('Network offline'))

    const { result } = renderHook(() => useCreateGroupForm(defaultProps))

    await waitFor(() => {
      expect(result.current.competitions.length).toBe(1)
    })

    const e = { preventDefault: vi.fn() } as unknown as React.FormEvent

    await act(async () => {
      await result.current.handleSubmit(e)
    })

    expect(result.current.error).toBe('Erro de conexão. Tente novamente.')
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('mostra aviso legível quando a resposta de erro não é JSON', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ competitions: [{ id: 'c1' }] })))
      .mockResolvedValueOnce(new Response('<html><h1>502 Bad Gateway</h1></html>', { status: 502 }))

    const { result } = renderHook(() => useCreateGroupForm(defaultProps))
    await waitFor(() => expect(result.current.competitions.length).toBe(1))

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent)
    })

    expect(result.current.error).toBe('Erro de conexão. Tente novamente.')
    expect(result.current.created).toBeNull()
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
