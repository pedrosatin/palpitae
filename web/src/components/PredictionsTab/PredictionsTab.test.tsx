import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PredictionsTab from './PredictionsTab'
import { type Match } from '../MatchCard'

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeMatch(overrides: Partial<Match> = {}): Match {
  const status = overrides.status ?? 'scheduled'
  const defaultStartTime =
    status === 'scheduled'
      ? new Date(Date.now() + 3_600_000).toISOString()
      : new Date(Date.now() - 3_600_000).toISOString()
  return {
    id: 'm1',
    start_time: defaultStartTime,
    status,
    home_score: null,
    away_score: null,
    phase: 'group',
    round: '1',
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

function mockFetch(matches: Match[]) {
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
      const default_round = activeRound?.[0] ?? matches.at(-1)?.round ?? null
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
    const matches: Match[] = [
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

  it('skips the live round and selects the next open round', async () => {
    const matches: Match[] = [
      makeMatch({ id: 'm1', round: '1', status: 'finished' }),
      makeMatch({ id: 'm2', round: '2', status: 'live' }),
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
    const matches: Match[] = [
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
    const matches: Match[] = [
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
    const matches: Match[] = [
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
    const matches: Match[] = [
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
    const matches: Match[] = [
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

  function twoRoundMatches(): Match[] {
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
    const matches: Match[] = [
      makeMatch({ id: 'm1', round: '1', status: 'scheduled' }),
      makeMatch({ id: 'm2', round: '2', status: 'finished' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Rodada anterior/i }),
      ).toBeDisabled()
    })
  })

  it('disables "Próxima" button on the last round', async () => {
    const matches = twoRoundMatches()
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    // Default index will be 1 (round '2' is scheduled) — that is the last one
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Próxima rodada/i }),
      ).toBeDisabled()
    })
  })

  it('navigates to the next round when "Próxima" is clicked', async () => {
    const matches: Match[] = [
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

    await userEvent.click(
      screen.getByRole('button', { name: /Próxima rodada/i }),
    )

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
    const matches: Match[] = [
      makeMatch({ id: 'm1', round: '1', status: 'scheduled' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /^Salvar todos$/i }),
      ).toBeDisabled()
    })

    await userEvent.click(
      screen.getByRole('button', { name: /Aumentar placar Argentina/i }),
    )

    expect(
      screen.getByRole('button', { name: /Salvar todos \(1\)/i }),
    ).toBeEnabled()
  })

  it('selects the first round with a scheduled/live match on load', async () => {
    const matches: Match[] = [
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
