import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import PredictionsTab from './PredictionsTab'
import { makeMatch } from '../matchFixtures'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

function mockFetch(matches: ReturnType<typeof makeMatch>[]) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()
    if (u.includes('/matches')) {
      const nowIso = new Date().toISOString()
      const roundMaxStart = new Map<string, string>()
      for (const m of matches) {
        const cur = roundMaxStart.get(m.round)
        if (!cur || m.start_time > cur) roundMaxStart.set(m.round, m.start_time)
      }
      const activeRound = [...roundMaxStart.entries()]
        .filter(([, max]) => max > nowIso)
        .sort(([, a], [, b]) => (a < b ? -1 : 1))[0]
      const chronologicalLast = matches.reduce<ReturnType<typeof makeMatch> | undefined>(
        (acc, m) => (!acc || m.start_time >= acc.start_time ? m : acc),
        undefined,
      )
      const default_round = activeRound?.[0] ?? chronologicalLast?.round ?? null
      return Promise.resolve({
        ok: true,
        json: async () => ({ matches, default_round }),
      } as Response)
    }
    if (u.includes('/predictions')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ predictions: [] }),
      } as Response)
    }
    return Promise.reject(new Error(`Unexpected fetch: ${u}`))
  })
}

// ─── defaultRoundIndex behaviour (tested through rendered output) ───────────

describe('PredictionsTab – defaultRoundIndex', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('selects the first round that contains a scheduled match', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'finished' }),
      makeMatch({ id: 'm2', round: '2', status: 'scheduled' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      // The <select> should show Rodada 2 as the selected value
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('2')
    })
  })

  it('skips a round where all matches have already started and selects the next open round', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'finished' }),
      makeMatch({
        id: 'm2',
        round: '2',
        status: 'scheduled',
        start_time: new Date(Date.now() - 3_600_000).toISOString(),
      }),
      makeMatch({ id: 'm3', round: '3', status: 'scheduled' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('3')
    })
  })

  it('falls back to the last round when all matches are finished', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'finished' }),
      makeMatch({ id: 'm2', round: '2', status: 'finished' }),
      makeMatch({ id: 'm3', round: '3', status: 'finished' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('3')
    })
  })
})

// ─── groupedRoundMatches behaviour (tested through rendered output) ─────────

describe('PredictionsTab – groupedRoundMatches', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a group header for matches that share a group_name', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', group_name: 'A', status: 'scheduled' }),
      makeMatch({ id: 'm2', round: '1', group_name: 'A', status: 'scheduled' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('Grupo A')).toBeInTheDocument()
    })
  })

  it('renders no group header when group_name is null', async () => {
    const matches = [
      makeMatch({
        id: 'm1',
        round: '1',
        group_name: null,
        status: 'scheduled',
      }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.queryByText(/^Grupo /)).not.toBeInTheDocument()
    })
  })

  it('renders separate group sections for different group_names', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', group_name: 'A', status: 'scheduled' }),
      makeMatch({ id: 'm2', round: '1', group_name: 'B', status: 'scheduled' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('Grupo A')).toBeInTheDocument()
      expect(screen.getByText('Grupo B')).toBeInTheDocument()
    })
  })

  it('creates a new group section when the same group_name appears non-consecutively', async () => {
    // A, B, A → should produce 3 groups (two "Grupo A" headers)
    const matches = [
      makeMatch({ id: 'm1', round: '1', group_name: 'A', status: 'scheduled' }),
      makeMatch({ id: 'm2', round: '1', group_name: 'B', status: 'scheduled' }),
      makeMatch({ id: 'm3', round: '1', group_name: 'A', status: 'scheduled' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getAllByText('Grupo A')).toHaveLength(2)
    })
  })
})

// ─── Round navigation ───────────────────────────────────────────────────────

describe('PredictionsTab – Round navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function twoRoundMatches() {
    return [
      makeMatch({ id: 'm1', round: '1', status: 'finished' }),
      makeMatch({
        id: 'm2',
        round: '2',
        status: 'scheduled',
        home_team_name: 'Itália',
        home_team_short_name: 'ITA',
        away_team_name: 'França',
        away_team_short_name: 'FRA',
      }),
    ]
  }

  it('disables "Anterior" button on the first round', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'scheduled' }),
      makeMatch({ id: 'm2', round: '2', status: 'finished' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Rodada anterior/i })).toBeDisabled()
    })
  })

  it('disables "Próxima" button on the last round', async () => {
    const matches = twoRoundMatches()
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    // Default index will be 1 (round '2' is scheduled) — that is the last one
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Próxima rodada/i })).toBeDisabled()
    })
  })

  it('navigates to the next round when "Próxima" is clicked', async () => {
    const matches = [
      makeMatch({
        id: 'm1',
        round: '1',
        status: 'scheduled',
        home_team_name: 'Itália',
        home_team_short_name: 'ITA',
        away_team_name: 'França',
        away_team_short_name: 'FRA',
      }),
      makeMatch({
        id: 'm2',
        round: '2',
        status: 'scheduled',
        home_team_name: 'Japão',
        home_team_short_name: 'JPN',
        away_team_name: 'Coreia',
        away_team_short_name: 'KOR',
      }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    // Wait for loading to finish; default lands on round '1' (first scheduled)
    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('1')
    })

    await userEvent.click(screen.getByRole('button', { name: /Próxima rodada/i }))

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('2')
    })
  })

  it('changes the displayed round when the <select> value is changed', async () => {
    const matches = twoRoundMatches()
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    // Default is round '2'; switch to round '1'
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Rodada 1')

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('1')
  })
})

// ─── Initialisation ─────────────────────────────────────────────────────────

describe('PredictionsTab – Initialisation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('counts a new draft after changing only one score from the 0 default', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Salvar todos$/i })).toBeDisabled()
    })

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))

    expect(screen.getByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()
  })

  it('includes a default 0×0 knockout draw in "Salvar todos" when only the penalty winner is set', async () => {
    const matches = [
      makeMatch({
        id: 'm1',
        round: '1',
        status: 'scheduled',
        decides_on_penalties: true,
      }),
    ]
    let bulkBody: { predictions: Array<Record<string, unknown>> } | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      const u = url.toString()
      if (u.includes('/matches'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ matches, default_round: '1' }),
        } as Response)
      if (u.includes('/predictions/bulk')) {
        bulkBody = JSON.parse(init!.body as string)
        return Promise.resolve({
          ok: true,
          json: async () => ({ saved: ['m1'] }),
        } as Response)
      }
      if (u.includes('/predictions'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ predictions: [] }),
        } as Response)
      if (u.includes('/groups'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ groups: [] }),
        } as Response)
      return Promise.reject(new Error(`Unexpected: ${u}`))
    })

    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    await waitFor(() => screen.getByRole('button', { name: /^Salvar todos$/i }))

    // Score stays at the 0×0 default; user only picks the shootout winner.
    await userEvent.click(screen.getByRole('radio', { name: 'BRA' }))

    const saveAll = await screen.findByRole('button', {
      name: /Salvar todos \(1\)/i,
    })
    await userEvent.click(saveAll)

    await waitFor(() => expect(bulkBody).not.toBeNull())
    expect(bulkBody!.predictions).toEqual([
      {
        match_id: 'm1',
        predicted_home_score: 0,
        predicted_away_score: 0,
        predicted_penalty_winner: 'home',
      },
    ])
  })

  it('selects the first round with a scheduled match on load', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'finished' }),
      makeMatch({ id: 'm2', round: '2', status: 'scheduled' }),
      makeMatch({ id: 'm3', round: '3', status: 'scheduled' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('2')
    })
  })
})

// ─── Analytics ──────────────────────────────────────────────────────────────

describe('PredictionsTab – analytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  function twoRounds() {
    return [
      makeMatch({
        id: 'm1',
        round: '1',
        status: 'scheduled',
        home_team_name: 'Itália',
        home_team_short_name: 'ITA',
        away_team_name: 'França',
        away_team_short_name: 'FRA',
      }),
      makeMatch({
        id: 'm2',
        round: '2',
        status: 'scheduled',
        home_team_name: 'Japão',
        home_team_short_name: 'JPN',
        away_team_name: 'Coreia',
        away_team_short_name: 'KOR',
      }),
    ]
  }

  it('fires click_predictions_proxima_rodada when Próxima is clicked', async () => {
    mockFetch(twoRounds())
    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('1')
    })
    await userEvent.click(screen.getByRole('button', { name: /Próxima rodada/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_proxima_rodada', { round: '2' })
  })

  it('fires click_predictions_rodada_anterior when Anterior is clicked', async () => {
    mockFetch(twoRounds())
    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    // Default is round '1'; advance to '2' first
    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('1')
    })
    await userEvent.click(screen.getByRole('button', { name: /Próxima rodada/i }))
    mockTrackEvent.mockClear()
    await userEvent.click(screen.getByRole('button', { name: /Rodada anterior/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_rodada_anterior', {
      round: '1',
    })
  })

  it('fires click_predictions_salvar_todos with count and round when Salvar todos is clicked', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = url.toString()
      if (u.includes('/matches'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ matches, default_round: '1' }),
        } as Response)
      if (u.includes('/predictions/bulk'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ saved: ['m1'] }),
        } as Response)
      if (u.includes('/predictions'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ predictions: [] }),
        } as Response)
      if (u.includes('/groups'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ groups: [] }),
        } as Response)
      return Promise.reject(new Error(`Unexpected: ${u}`))
    })

    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    await waitFor(() => screen.getByRole('button', { name: /^Salvar todos$/i }))

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: /Salvar todos \(1\)/i }))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_salvar_todos', {
      count: 1,
      round: '1',
    })
  })

  it('fires change_predictions_rodada when the round select is changed', async () => {
    mockFetch([
      makeMatch({ id: 'm1', round: '1', status: 'scheduled' }),
      makeMatch({ id: 'm2', round: '2', status: 'scheduled' }),
    ])
    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('1')
    })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Rodada 2')
    expect(mockTrackEvent).toHaveBeenCalledWith('change_predictions_rodada', {
      round: '2',
    })
  })

  it('fires click_predictions_importar when Importar is clicked', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = url.toString()
      if (u.includes('/groups'))
        return Promise.resolve({
          ok: true,
          json: async () => ({
            groups: [{ id: 'g-other', name: 'Outro', competition_id: 'c1' }],
          }),
        } as Response)
      if (u.includes('/matches'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ matches, default_round: '1' }),
        } as Response)
      if (u.includes('/predictions/import'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, imported: 3, locked_skipped: 0 }),
        } as Response)
      if (u.includes('/predictions'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ predictions: [] }),
        } as Response)
      return Promise.reject(new Error(`Unexpected: ${u}`))
    })

    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    await waitFor(() => screen.getByText(/Importar palpites de:/i))
    await userEvent.click(screen.getByRole('button', { name: 'Importar' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_importar')
  })
})
