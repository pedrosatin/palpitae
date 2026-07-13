import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import StandingsTab, { computeStandings } from './StandingsTab'
import { type Match } from '../MatchCard'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

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
    round_label: 'Rodada 1',
    group_name: 'A',
    home_team_id: 'bra',
    home_team_name: 'Brasil',
    home_team_short_name: 'BRA',
    home_team_logo: '/bra.png',
    away_team_id: 'arg',
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
      return Promise.resolve({
        ok: true,
        json: async () => ({ matches, default_round: null }),
      } as Response)
    }
    return Promise.reject(new Error(`Unexpected fetch: ${u}`))
  })
}

// ─── computeStandings (pure logic) ──────────────────────────────────────────

describe('computeStandings', () => {
  it('awards 3 points to the home winner and 0 to the loser', () => {
    const matches = [
      makeMatch({
        id: 'm1',
        status: 'finished',
        home_score: 2,
        away_score: 1,
      }),
    ]
    const standings = computeStandings(matches)
    const groupA = standings.get('A')!

    const bra = groupA.find((t) => t.team_id === 'bra')!
    const arg = groupA.find((t) => t.team_id === 'arg')!

    expect(bra).toMatchObject({ p: 3, j: 1, v: 1, e: 0, d: 0, gf: 2, ga: 1, sg: 1 })
    expect(arg).toMatchObject({ p: 0, j: 1, v: 0, e: 0, d: 1, gf: 1, ga: 2, sg: -1 })
  })

  it('awards 1 point to each team on a draw', () => {
    const matches = [
      makeMatch({
        id: 'm1',
        status: 'finished',
        home_score: 1,
        away_score: 1,
      }),
    ]
    const groupA = computeStandings(matches).get('A')!

    for (const t of groupA) {
      expect(t).toMatchObject({ p: 1, j: 1, v: 0, e: 1, d: 0 })
    }
  })

  it('awards 3 points to the away winner', () => {
    const matches = [
      makeMatch({
        id: 'm1',
        status: 'finished',
        home_score: 0,
        away_score: 2,
      }),
    ]
    const groupA = computeStandings(matches).get('A')!
    const bra = groupA.find((t) => t.team_id === 'bra')!
    const arg = groupA.find((t) => t.team_id === 'arg')!

    expect(bra).toMatchObject({ p: 0, d: 1 })
    expect(arg).toMatchObject({ p: 3, v: 1, sg: 2 })
  })

  it('lists teams of an unfinished match with everything zeroed', () => {
    const matches = [makeMatch({ id: 'm1', status: 'scheduled' })]
    const groupA = computeStandings(matches).get('A')!

    expect(groupA).toHaveLength(2)
    for (const t of groupA) {
      expect(t).toMatchObject({ p: 0, j: 0, gf: 0, ga: 0, sg: 0 })
    }
  })

  it('does not count in-progress (not yet finished) matches towards points', () => {
    const matches = [
      makeMatch({ id: 'm1', status: 'scheduled', home_score: 1, away_score: 0 }),
    ]
    const groupA = computeStandings(matches).get('A')!
    for (const t of groupA) {
      expect(t).toMatchObject({ p: 0, j: 0 })
    }
  })

  it('sorts by points, then goal difference, then goals scored', () => {
    // Group B: three teams, crafted so ordering exercises each tiebreaker.
    const matches = [
      makeMatch({
        id: 'm1',
        group_name: 'B',
        status: 'finished',
        home_team_id: 'x',
        home_team_name: 'X',
        away_team_id: 'y',
        away_team_name: 'Y',
        home_score: 3,
        away_score: 0,
      }),
      makeMatch({
        id: 'm2',
        group_name: 'B',
        status: 'finished',
        home_team_id: 'z',
        home_team_name: 'Z',
        away_team_id: 'y',
        away_team_name: 'Y',
        home_score: 1,
        away_score: 0,
      }),
    ]
    const groupB = computeStandings(matches).get('B')!
    // X: 3pts sg+3, Z: 3pts sg+1, Y: 0pts
    expect(groupB.map((t) => t.team_id)).toEqual(['x', 'z', 'y'])
  })

  it('ignores matches without a group_name', () => {
    const matches = [makeMatch({ id: 'm1', group_name: null })]
    expect(computeStandings(matches).size).toBe(0)
  })
})

// ─── Render ─────────────────────────────────────────────────────────────────

describe('StandingsTab – render', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a loading state', () => {
    mockFetch([])
    render(<StandingsTab competitionId="c1" />)
    expect(screen.getByText(/Carregando/i)).toBeInTheDocument()
  })

  it('renders a header for each group', async () => {
    mockFetch([
      makeMatch({ id: 'm1', group_name: 'A' }),
      makeMatch({ id: 'm2', group_name: 'B' }),
    ])
    render(<StandingsTab competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('Grupo A')).toBeInTheDocument()
      expect(screen.getByText('Grupo B')).toBeInTheDocument()
    })
  })

  it('opens the matches modal when a group header is clicked', async () => {
    mockFetch([
      makeMatch({
        id: 'm1',
        group_name: 'A',
        status: 'finished',
        home_score: 2,
        away_score: 1,
      }),
    ])
    render(<StandingsTab competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('Grupo A')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /Grupo A/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(/BRA 2 × 1 ARG/i)).toBeInTheDocument()
  })

  it('shows an empty message when there is no group phase', async () => {
    mockFetch([makeMatch({ id: 'm1', group_name: null })])
    render(<StandingsTab competitionId="c1" />)

    await waitFor(() => {
      expect(
        screen.getByText(/não tem fase de grupos/i),
      ).toBeInTheDocument()
    })
  })
})

describe('StandingsTab – analytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  it('fires click_standings_ver_grupo with the group when a group header is clicked', async () => {
    mockFetch([makeMatch({ id: 'm1', group_name: 'A' })])
    render(<StandingsTab competitionId="c1" />)

    await waitFor(() => screen.getByText('Grupo A'))
    await userEvent.click(screen.getByRole('button', { name: /Grupo A/i }))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_standings_ver_grupo', { group: 'A' })
  })
})

describe('StandingsTab — liga (pontos corridos)', () => {
  function leagueMatch(overrides: Partial<Match> = {}): Match {
    return makeMatch({ group_name: null, phase: 'REGULAR_SEASON', ...overrides })
  }

  it('renders a single Classificação table from REGULAR_SEASON matches', async () => {
    mockFetch([
      leagueMatch({ id: 'l1', status: 'finished', home_score: 2, away_score: 0 }),
    ])
    render(<StandingsTab competitionId="comp-1" />)
    expect(await screen.findByText('Classificação')).toBeInTheDocument()
    expect(screen.queryByText(/Grupo /)).not.toBeInTheDocument()
    expect(screen.queryByText('ver jogos')).not.toBeInTheDocument()
  })

  it('ignores knockout matches (group_name null fora de REGULAR_SEASON)', async () => {
    mockFetch([
      leagueMatch({ id: 'k1', phase: 'LAST_16', status: 'finished', home_score: 1, away_score: 0 }),
    ])
    render(<StandingsTab competitionId="comp-1" />)
    expect(
      await screen.findByText('Esta competição não tem fase de grupos.'),
    ).toBeInTheDocument()
  })

  it('uses wins as the 2nd tiebreaker (CBF), before goal difference', () => {
    // A: 1 vitória e 1 derrota feia → 3 pts, 1 v, sg -4
    // B: 3 empates → 3 pts, 0 v, sg 0. CBF: A acima de B (FIFA seria o oposto).
    const mk = (id: string, h: [string, string], a: [string, string], hs: number, as_: number) =>
      leagueMatch({
        id, status: 'finished', home_score: hs, away_score: as_,
        home_team_id: h[0], home_team_name: h[1], home_team_short_name: h[1].slice(0, 3).toUpperCase(),
        away_team_id: a[0], away_team_name: a[1], away_team_short_name: a[1].slice(0, 3).toUpperCase(),
      })
    const matches = [
      mk('1', ['aaa', 'Alfa'], ['ccc', 'Gama'], 1, 0),
      mk('2', ['aaa', 'Alfa'], ['ddd', 'Delta'], 0, 5),
      mk('3', ['bbb', 'Beta'], ['ccc', 'Gama'], 0, 0),
      mk('4', ['bbb', 'Beta'], ['ddd', 'Delta'], 0, 0),
      mk('5', ['eee', 'Eco'], ['bbb', 'Beta'], 0, 0),
    ]
    const standings = computeStandings(matches)
    const league = standings.get('')!
    const alfa = league.findIndex((t) => t.team_id === 'aaa')
    const beta = league.findIndex((t) => t.team_id === 'bbb')
    expect(league[alfa].p).toBe(3)
    expect(league[beta].p).toBe(3)
    expect(alfa).toBeLessThan(beta)
  })
})
