import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import StandingsTab, {
  computeStandings,
  isGeneralRanking,
  isLeagueTable,
  isStandingsTabEligible,
  standingsBucket,
} from './StandingsTab'
import { GENERAL_RANKING, LEAGUE, FORM_SIZE } from './StandingsTab'
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

// ─── isLeagueTable ──────────────────────────────────────────────────────────

describe('isLeagueTable', () => {
  it('returns true for the LEAGUE constant', () => {
    expect(isLeagueTable(LEAGUE)).toBe(true)
  })

  it('returns false for other strings', () => {
    expect(isLeagueTable('A')).toBe(false)
    expect(isLeagueTable('Group B')).toBe(false)
    expect(isLeagueTable('league')).toBe(false)
    expect(isLeagueTable(GENERAL_RANKING)).toBe(false)
  })
})

describe('isGeneralRanking', () => {
  it('returns true only for the GENERAL_RANKING sentinel', () => {
    expect(isGeneralRanking(GENERAL_RANKING)).toBe(true)
    expect(isGeneralRanking(LEAGUE)).toBe(false)
    expect(isGeneralRanking('B')).toBe(false)
  })
})

describe('isStandingsTabEligible', () => {
  it('allows every league regardless of competition_code', () => {
    expect(isStandingsTabEligible('league', null)).toBe(true)
    expect(isStandingsTabEligible('league', 'BSA')).toBe(true)
    expect(isStandingsTabEligible('league', 'bra.camp.gaucho')).toBe(true)
  })

  it('allows only regional cups with known canonical codes', () => {
    expect(isStandingsTabEligible('cup', 'bra.camp.gaucho')).toBe(true)
    expect(isStandingsTabEligible('cup', 'bra.camp.carioca')).toBe(true)
    expect(isStandingsTabEligible('cup', 'bra.camp.paulista')).toBe(true)
    expect(isStandingsTabEligible('cup', 'bra.copa_do_brazil')).toBe(false)
    expect(isStandingsTabEligible('cup', 'conmebol.libertadores')).toBe(false)
    expect(isStandingsTabEligible('cup', null)).toBe(false)
  })

  it('rejects null/unknown competition_type', () => {
    expect(isStandingsTabEligible(null, 'bra.camp.gaucho')).toBe(false)
    expect(isStandingsTabEligible(undefined, 'bra.camp.gaucho')).toBe(false)
  })
})

describe('standingsBucket', () => {
  it('maps REGULAR_SEASON and LEAGUE_PHASE without group to LEAGUE', () => {
    expect(standingsBucket({ phase: 'REGULAR_SEASON', group_name: null })).toBe(LEAGUE)
    expect(standingsBucket({ phase: 'LEAGUE_PHASE', group_name: null })).toBe(LEAGUE)
  })

  it('keeps named groups for GROUP_STAGE and prefers group_name on league phases', () => {
    expect(standingsBucket({ phase: 'GROUP_STAGE', group_name: 'A' })).toBe('A')
    expect(standingsBucket({ phase: 'REGULAR_SEASON', group_name: 'A' })).toBe('A')
    expect(standingsBucket({ phase: 'GROUP_STAGE', group_name: null })).toBe(null)
  })

  it('collapses TACA_GUANABARA into GENERAL_RANKING even when group_name is set', () => {
    expect(standingsBucket({ phase: 'TACA_GUANABARA', group_name: null })).toBe(GENERAL_RANKING)
    expect(standingsBucket({ phase: 'TACA_GUANABARA', group_name: 'B' })).toBe(GENERAL_RANKING)
  })

  it('collapses Gaúcho GROUP_STAGE into GENERAL_RANKING by canonical code', () => {
    expect(
      standingsBucket(
        { phase: 'GROUP_STAGE', group_name: null },
        'bra.camp.gaucho',
      ),
    ).toBe(GENERAL_RANKING)
    expect(
      standingsBucket({ phase: 'GROUP_STAGE', group_name: 'A' }, 'bra.camp.gaucho'),
    ).toBe(GENERAL_RANKING)
  })

  it('does not collapse other competitions GROUP_STAGE without named group', () => {
    expect(standingsBucket({ phase: 'GROUP_STAGE', group_name: null }, 'bra.copa_do_brazil')).toBe(
      null,
    )
    expect(standingsBucket({ phase: 'GROUP_STAGE', group_name: 'A' }, 'conmebol.libertadores')).toBe(
      'A',
    )
    expect(standingsBucket({ phase: 'GROUP_STAGE', group_name: null }, null)).toBe(null)
    expect(standingsBucket({ phase: 'GROUP_STAGE', group_name: null }, undefined)).toBe(null)
  })

  it('keeps Gaúcho relegation and knockouts out of general ranking', () => {
    expect(
      standingsBucket(
        { phase: 'RELEGATION_STAGE', group_name: 'Relegation Group' },
        'bra.camp.gaucho',
      ),
    ).toBe('Relegation Group')
    expect(
      standingsBucket({ phase: 'QUARTER_FINALS', group_name: null }, 'bra.camp.gaucho'),
    ).toBe(null)
  })

  it('ignores knockout phases without group_name', () => {
    expect(standingsBucket({ phase: 'QUARTER_FINALS', group_name: null })).toBe(null)
    expect(standingsBucket({ phase: 'TACA_GUANABARA_QUARTER_FINALS', group_name: null })).toBe(null)
    expect(standingsBucket({ phase: 'FINAL', group_name: null })).toBe(null)
  })
})

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

    expect(bra).toMatchObject({
      p: 3,
      j: 1,
      v: 1,
      e: 0,
      d: 0,
      gf: 2,
      ga: 1,
      sg: 1,
    })
    expect(arg).toMatchObject({
      p: 0,
      j: 1,
      v: 0,
      e: 0,
      d: 1,
      gf: 1,
      ga: 2,
      sg: -1,
    })
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
      makeMatch({
        id: 'm1',
        status: 'scheduled',
        home_score: 1,
        away_score: 0,
      }),
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

  it('sorts alphabetically by team name if points, goal difference, and goals scored are equal', () => {
    const matches = [
      makeMatch({
        id: 'm1',
        group_name: 'A',
        status: 'finished',
        home_team_id: 't2',
        home_team_name: 'Zeta',
        away_team_id: 't1',
        away_team_name: 'Alfa',
        home_score: 1,
        away_score: 1,
      }),
    ]
    const groupA = computeStandings(matches).get('A')!
    expect(groupA.map((t) => t.team_name)).toEqual(['Alfa', 'Zeta'])
  })

  it('handles multiple groups independently', () => {
    const matches = [
      makeMatch({
        id: 'm1',
        group_name: 'A',
        home_team_name: 'Team A1',
        away_team_name: 'Team A2',
      }),
      makeMatch({
        id: 'm2',
        group_name: 'B',
        home_team_name: 'Team B1',
        away_team_name: 'Team B2',
      }),
    ]
    const standings = computeStandings(matches)
    expect(standings.has('A')).toBe(true)
    expect(standings.has('B')).toBe(true)
    expect(standings.get('A')).toHaveLength(2)
    expect(standings.get('B')).toHaveLength(2)
  })

  it('ignores finished matches with null scores', () => {
    const matches = [
      makeMatch({
        id: 'm1',
        group_name: 'A',
        status: 'finished',
        home_score: null,
        away_score: null,
      }),
    ]
    const groupA = computeStandings(matches).get('A')!
    for (const t of groupA) {
      expect(t).toMatchObject({ p: 0, j: 0, gf: 0, ga: 0, sg: 0 })
    }
  })
})

// ─── Render ─────────────────────────────────────────────────────────────────

describe('StandingsTab – render', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a loading state', () => {
    // Return a never-resolving promise to keep it in the loading state,
    // avoiding the act() warning that occurs if it resolves after the test finishes.
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<StandingsTab competitionId="c1" />)
    expect(screen.getByText(/Carregando/i)).toBeInTheDocument()
  })

  it('shows an error state if fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'))
    render(<StandingsTab competitionId="c1" />)
    await waitFor(() => {
      expect(screen.getByText(/Network failure/i)).toBeInTheDocument()
    })
  })

  it('renders a header for each group', async () => {
    mockFetch([makeMatch({ id: 'm1', group_name: 'A' }), makeMatch({ id: 'm2', group_name: 'B' })])
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

  it('sorts matches chronologically in the modal', async () => {
    const time1 = new Date(Date.now() - 3_600_000).toISOString()
    const time2 = new Date(Date.now() - 7_200_000).toISOString()
    mockFetch([
      makeMatch({ id: 'm1', group_name: 'A', start_time: time1, status: 'scheduled' }),
      makeMatch({
        id: 'm2',
        group_name: 'A',
        start_time: time2,
        status: 'scheduled',
        home_team_short_name: 'URU',
      }),
    ])
    render(<StandingsTab competitionId="c1" />)

    await waitFor(() => screen.getByText('Grupo A'))
    await userEvent.click(screen.getByRole('button', { name: /Grupo A/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()

    const matchItems = screen.getAllByRole('listitem')
    expect(matchItems).toHaveLength(2)
    // The second match (m2) has an earlier start time, so it should be first
    expect(matchItems[0]).toHaveTextContent(/URU/i)
    expect(matchItems[1]).toHaveTextContent(/BRA/i)
  })

  it('renders a finished match with null scores safely in the modal', async () => {
    mockFetch([
      makeMatch({
        id: 'm1',
        group_name: 'A',
        status: 'finished',
        home_score: null,
        away_score: null,
      }),
    ])
    render(<StandingsTab competitionId="c1" />)

    await waitFor(() => screen.getByText('Grupo A'))
    await userEvent.click(screen.getByRole('button', { name: /Grupo A/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(/BRA – × – ARG/i)).toBeInTheDocument()
  })

  it('shows an empty message when there is no group phase', async () => {
    mockFetch([makeMatch({ id: 'm1', group_name: null })])
    render(<StandingsTab competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText(/não tem fase de grupos/i)).toBeInTheDocument()
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

    expect(mockTrackEvent).toHaveBeenCalledWith('click_standings_ver_grupo', {
      group: 'A',
    })
  })
})

describe('StandingsTab — liga (pontos corridos)', () => {
  function leagueMatch(overrides: Partial<Match> = {}): Match {
    return makeMatch({
      group_name: null,
      phase: 'REGULAR_SEASON',
      ...overrides,
    })
  }

  it('renders a single Classificação table from REGULAR_SEASON matches', async () => {
    mockFetch([
      leagueMatch({
        id: 'l1',
        status: 'finished',
        home_score: 2,
        away_score: 0,
      }),
    ])
    render(<StandingsTab competitionId="comp-1" />)
    expect(await screen.findByText('Classificação')).toBeInTheDocument()
    expect(screen.queryByText(/Grupo /)).not.toBeInTheDocument()
    expect(screen.queryByText('ver jogos')).not.toBeInTheDocument()
  })

  it('renders Classificação from LEAGUE_PHASE matches without group_name (Paulista)', async () => {
    mockFetch([
      leagueMatch({
        id: 'p1',
        phase: 'LEAGUE_PHASE',
        status: 'finished',
        home_score: 2,
        away_score: 1,
      }),
      leagueMatch({
        id: 'p2',
        phase: 'LEAGUE_PHASE',
        status: 'finished',
        home_score: 0,
        away_score: 0,
        home_team_id: 'bra',
        away_team_id: 'uru',
        away_team_name: 'Uruguai',
        away_team_short_name: 'URU',
      }),
    ])
    render(<StandingsTab competitionId="paulista" competitionType="cup" />)
    expect(await screen.findByText('Classificação')).toBeInTheDocument()
    expect(screen.queryByText(/Grupo /)).not.toBeInTheDocument()
    expect(screen.queryByText('Ranking geral')).not.toBeInTheDocument()
    // Placar agregado: BRA 2J 4P (vitória + empate); ARG 1J 0P; URU 1J 1P
    const standings = computeStandings([
      leagueMatch({
        id: 'p1',
        phase: 'LEAGUE_PHASE',
        status: 'finished',
        home_score: 2,
        away_score: 1,
      }),
      leagueMatch({
        id: 'p2',
        phase: 'LEAGUE_PHASE',
        status: 'finished',
        home_score: 0,
        away_score: 0,
        home_team_id: 'bra',
        away_team_id: 'uru',
        away_team_name: 'Uruguai',
        away_team_short_name: 'URU',
      }),
    ])
    expect(standings.size).toBe(1)
    expect(standings.has(LEAGUE)).toBe(true)
    const bra = standings.get(LEAGUE)!.find((t) => t.team_id === 'bra')!
    expect(bra.p).toBe(4)
    expect(bra.j).toBe(2)
    expect(bra.v).toBe(1)
    expect(bra.e).toBe(1)
  })

  it('ignores knockout matches (group_name null fora das fases de pontos)', async () => {
    mockFetch([
      leagueMatch({
        id: 'k1',
        phase: 'LAST_16',
        status: 'finished',
        home_score: 1,
        away_score: 0,
      }),
    ])
    render(<StandingsTab competitionId="comp-1" competitionType="cup" />)
    expect(await screen.findByText('Esta competição não tem fase de grupos.')).toBeInTheDocument()
  })

  it('shows a league-appropriate empty state, not the cup message', async () => {
    mockFetch([])
    render(<StandingsTab competitionId="comp-1" competitionType="league" />)
    expect(
      await screen.findByText('Ainda não há jogos sincronizados para montar a classificação.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Esta competição não tem fase de grupos.')).not.toBeInTheDocument()
  })

  it('uses wins as the 2nd tiebreaker (CBF), before goal difference', () => {
    // A: 1 vitória e 1 derrota feia → 3 pts, 1 v, sg -4
    // B: 3 empates → 3 pts, 0 v, sg 0. CBF: A acima de B (FIFA seria o oposto).
    const mk = (
      id: string,
      h: [string, string],
      a: [string, string],
      homeScore: number,
      awayScore: number,
    ) =>
      leagueMatch({
        id,
        status: 'finished',
        home_score: homeScore,
        away_score: awayScore,
        home_team_id: h[0],
        home_team_name: h[1],
        home_team_short_name: h[1].slice(0, 3).toUpperCase(),
        away_team_id: a[0],
        away_team_name: a[1],
        away_team_short_name: a[1].slice(0, 3).toUpperCase(),
      })
    const matches = [
      mk('1', ['aaa', 'Alfa'], ['ccc', 'Gama'], 1, 0),
      mk('2', ['aaa', 'Alfa'], ['ddd', 'Delta'], 0, 5),
      mk('3', ['bbb', 'Beta'], ['ccc', 'Gama'], 0, 0),
      mk('4', ['bbb', 'Beta'], ['ddd', 'Delta'], 0, 0),
      mk('5', ['eee', 'Eco'], ['bbb', 'Beta'], 0, 0),
    ]
    const standings = computeStandings(matches)
    const league = standings.get(LEAGUE)!
    const alfa = league.findIndex((t) => t.team_id === 'aaa')
    const beta = league.findIndex((t) => t.team_id === 'bbb')
    expect(league[alfa].p).toBe(3)
    expect(league[beta].p).toBe(3)
    expect(alfa).toBeLessThan(beta)
  })
})

describe('StandingsTab — forma recente (Últimas 4)', () => {
  const day = (n: number) => new Date(2026, 0, n).toISOString()

  function finished(
    id: string,
    n: number,
    hs: number,
    as_: number,
    overrides: Partial<Match> = {},
  ): Match {
    return makeMatch({
      id,
      status: 'finished',
      home_score: hs,
      away_score: as_,
      group_name: null,
      phase: 'REGULAR_SEASON',
      start_time: day(n),
      ...overrides,
    })
  }

  it('keeps only the last FORM_SIZE results, most recent last, in chronological order', () => {
    // 5 jogos do mesmo mandante (bra): v, v, e, d, v — janela de 4 descarta o 1º
    const matches = [
      finished('f1', 1, 2, 0),
      finished('f2', 2, 1, 0),
      finished('f3', 3, 1, 1),
      finished('f4', 4, 0, 3),
      finished('f5', 5, 4, 2),
    ].reverse() // payload fora de ordem de propósito
    const bra = computeStandings(matches)
      .get(LEAGUE)!
      .find((t) => t.team_id === 'bra')!
    expect(bra.form).toHaveLength(FORM_SIZE)
    expect(bra.form.map((f) => f.result)).toEqual(['v', 'e', 'd', 'v'])
  })

  it('mirrors the result for the away team and labels with score and opponent', () => {
    const arg = computeStandings([finished('f1', 1, 2, 0)])
      .get(LEAGUE)!
      .find((t) => t.team_id === 'arg')!
    expect(arg.form).toEqual([{ result: 'd', label: 'Derrota 2x0 contra BRA' }])
  })

  it('renders one accessible badge per recent match', async () => {
    mockFetch([finished('f1', 1, 2, 0), finished('f2', 2, 1, 1)])
    render(<StandingsTab competitionId="comp-1" competitionType="league" />)
    await screen.findByText('Classificação')
    expect(screen.getByRole('img', { name: 'Vitória 2x0 contra ARG' })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: /Empate 1x1/ })).toHaveLength(2)
  })
})

describe('StandingsTab — Taça Guanabara (ranking geral)', () => {
  function tgMatch(overrides: Partial<Match> = {}): Match {
    return makeMatch({
      phase: 'TACA_GUANABARA',
      round: 'TACA_GUANABARA',
      round_label: 'Taça Guanabara',
      group_name: null,
      status: 'finished',
      ...overrides,
    })
  }

  it('merges null and Group B into one GENERAL_RANKING table with correct points', () => {
    const matches = [
      tgMatch({
        id: 'tg-null',
        group_name: null,
        home_score: 2,
        away_score: 0,
      }),
      tgMatch({
        id: 'tg-b',
        group_name: 'B',
        home_score: 1,
        away_score: 1,
        home_team_id: 'fla',
        home_team_name: 'Flamengo',
        home_team_short_name: 'FLA',
        away_team_id: 'vas',
        away_team_name: 'Vasco',
        away_team_short_name: 'VAS',
      }),
    ]
    const standings = computeStandings(matches)
    expect([...standings.keys()]).toEqual([GENERAL_RANKING])
    expect(standings.has('B')).toBe(false)
    expect(standings.has(LEAGUE)).toBe(false)
    const table = standings.get(GENERAL_RANKING)!
    expect(table).toHaveLength(4)
    const bra = table.find((t) => t.team_id === 'bra')!
    const fla = table.find((t) => t.team_id === 'fla')!
    expect(bra.p).toBe(3)
    expect(bra.j).toBe(1)
    expect(fla.p).toBe(1)
    expect(fla.j).toBe(1)
  })

  it('does not mix knockout TG phases into the ranking and does not duplicate teams', () => {
    const matches = [
      tgMatch({ id: 'tg1', home_score: 1, away_score: 0 }),
      tgMatch({
        id: 'tg2',
        group_name: 'B',
        home_score: 0,
        away_score: 2,
        // mesmo BRA x ARG de tg1 — segundo jogo, não duplica linha
      }),
      makeMatch({
        id: 'tg-qf',
        phase: 'TACA_GUANABARA_QUARTER_FINALS',
        round: 'TACA_GUANABARA_QUARTER_FINALS',
        round_label: 'Quartas da Taça Guanabara',
        group_name: null,
        status: 'finished',
        home_score: 3,
        away_score: 0,
        home_team_id: 'flu',
        home_team_name: 'Fluminense',
        home_team_short_name: 'FLU',
        away_team_id: 'bot',
        away_team_name: 'Botafogo',
        away_team_short_name: 'BOT',
      }),
    ]
    const standings = computeStandings(matches)
    expect(standings.size).toBe(1)
    const table = standings.get(GENERAL_RANKING)!
    expect(table.map((t) => t.team_id).sort()).toEqual(['arg', 'bra'])
    const bra = table.find((t) => t.team_id === 'bra')!
    expect(bra.j).toBe(2)
    expect(bra.p).toBe(3) // vitória + derrota
    expect(table.find((t) => t.team_id === 'flu')).toBeUndefined()
  })

  it('renders Ranking geral with incompleteness note and never Grupo B', async () => {
    mockFetch([
      tgMatch({ id: 'tg-null', home_score: 2, away_score: 0 }),
      tgMatch({
        id: 'tg-b',
        group_name: 'B',
        home_score: 0,
        away_score: 1,
        home_team_id: 'fla',
        home_team_name: 'Flamengo',
        home_team_short_name: 'FLA',
        away_team_id: 'vas',
        away_team_name: 'Vasco',
        away_team_short_name: 'VAS',
      }),
    ])
    render(<StandingsTab competitionId="carioca" competitionType="cup" />)
    expect(await screen.findByText('Ranking geral')).toBeInTheDocument()
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent(/não entrega grupos completos/i)
    expect(note).toHaveTextContent(/não é a classificação oficial dos grupos/i)
    expect(screen.queryByText(/Grupo B/)).not.toBeInTheDocument()
    expect(screen.queryByText('Classificação')).not.toBeInTheDocument()
    expect(screen.queryByText('ver jogos')).not.toBeInTheDocument()
    expect(screen.getByText('Brasil')).toBeInTheDocument()
    expect(screen.getByText('Flamengo')).toBeInTheDocument()
  })

  it('keeps GROUP_STAGE A/B tables separate from TACA_GUANABARA ranking', () => {
    const matches = [
      makeMatch({
        id: 'gs-a',
        phase: 'GROUP_STAGE',
        group_name: 'A',
        status: 'finished',
        home_score: 1,
        away_score: 0,
      }),
      tgMatch({ id: 'tg1', group_name: 'B', home_score: 2, away_score: 2 }),
    ]
    const standings = computeStandings(matches)
    expect(standings.has('A')).toBe(true)
    expect(standings.has(GENERAL_RANKING)).toBe(true)
    expect(standings.has('B')).toBe(false)
    expect(standings.get('A')).toHaveLength(2)
    expect(standings.get(GENERAL_RANKING)).toHaveLength(2)
  })
})

describe('StandingsTab — Gaúcho classificatória (ranking geral)', () => {
  const GAUCHO = 'bra.camp.gaucho'

  function gsMatch(overrides: Partial<Match> = {}): Match {
    return makeMatch({
      phase: 'GROUP_STAGE',
      round: 'GROUP_STAGE',
      round_label: 'Fase de grupos',
      group_name: null,
      status: 'finished',
      ...overrides,
    })
  }

  it('reproduces the missing null-group gap without competition code', () => {
    const matches = [
      gsMatch({ id: 'g-null', home_score: 2, away_score: 0 }),
      gsMatch({
        id: 'g-a',
        group_name: 'A',
        home_score: 1,
        away_score: 1,
        home_team_id: 'gre',
        home_team_name: 'Grêmio',
        home_team_short_name: 'GRE',
        away_team_id: 'int',
        away_team_name: 'Internacional',
        away_team_short_name: 'INT',
      }),
    ]
    const withoutCode = computeStandings(matches)
    expect(withoutCode.has(GENERAL_RANKING)).toBe(false)
    expect(withoutCode.has('A')).toBe(true)
    expect([...withoutCode.keys()]).toEqual(['A'])
  })

  it('merges null and named Gaúcho GROUP_STAGE into one GENERAL_RANKING ordered by points', () => {
    const matches = [
      gsMatch({ id: 'g-null', home_score: 2, away_score: 0 }),
      gsMatch({
        id: 'g-a',
        group_name: 'A',
        home_score: 1,
        away_score: 1,
        home_team_id: 'gre',
        home_team_name: 'Grêmio',
        home_team_short_name: 'GRE',
        away_team_id: 'int',
        away_team_name: 'Internacional',
        away_team_short_name: 'INT',
      }),
    ]
    const standings = computeStandings(matches, GAUCHO)
    expect([...standings.keys()]).toEqual([GENERAL_RANKING])
    expect(standings.has('A')).toBe(false)
    const table = standings.get(GENERAL_RANKING)!
    expect(table).toHaveLength(4)
    expect(table[0].team_id).toBe('bra')
    expect(table[0].p).toBe(3)
    expect(table[0].j).toBe(1)
    const gre = table.find((t) => t.team_id === 'gre')!
    expect(gre.p).toBe(1)
    expect(gre.j).toBe(1)
  })

  it('keeps named GROUP_STAGE of another cup separate and does not collapse globally', () => {
    const matches = [
      gsMatch({
        id: 'copa-a',
        group_name: 'A',
        home_score: 3,
        away_score: 0,
      }),
      gsMatch({
        id: 'copa-b',
        group_name: 'B',
        home_score: 1,
        away_score: 1,
        home_team_id: 'fla',
        home_team_name: 'Flamengo',
        home_team_short_name: 'FLA',
        away_team_id: 'vas',
        away_team_name: 'Vasco',
        away_team_short_name: 'VAS',
      }),
    ]
    const standings = computeStandings(matches, 'conmebol.libertadores')
    expect(standings.has(GENERAL_RANKING)).toBe(false)
    expect(standings.has('A')).toBe(true)
    expect(standings.has('B')).toBe(true)
  })

  it('keeps Gaúcho relegation separate and knockouts out of ranking', () => {
    const matches = [
      gsMatch({ id: 'gs1', home_score: 1, away_score: 0 }),
      makeMatch({
        id: 'rel',
        phase: 'RELEGATION_STAGE',
        round: 'RELEGATION_STAGE',
        round_label: 'Rebaixamento',
        group_name: 'Relegation Group',
        status: 'finished',
        home_score: 2,
        away_score: 2,
        home_team_id: 'aim',
        home_team_name: 'Aimoré',
        home_team_short_name: 'AIM',
        away_team_id: 'sao',
        away_team_name: 'São Luiz',
        away_team_short_name: 'SAO',
      }),
      makeMatch({
        id: 'qf',
        phase: 'QUARTER_FINALS',
        round: 'QUARTER_FINALS',
        round_label: 'Quartas',
        group_name: null,
        status: 'finished',
        home_score: 3,
        away_score: 0,
        home_team_id: 'ypir',
        home_team_name: 'Ypiranga',
        home_team_short_name: 'YPI',
        away_team_id: 'cax',
        away_team_name: 'Caxias',
        away_team_short_name: 'CAX',
      }),
    ]
    const standings = computeStandings(matches, GAUCHO)
    expect(standings.has(GENERAL_RANKING)).toBe(true)
    expect(standings.has('Relegation Group')).toBe(true)
    expect(standings.get(GENERAL_RANKING)!.map((t) => t.team_id).sort()).toEqual(['arg', 'bra'])
    expect(standings.get('Relegation Group')!.map((t) => t.team_id).sort()).toEqual([
      'aim',
      'sao',
    ])
    expect(standings.get(GENERAL_RANKING)!.find((t) => t.team_id === 'ypir')).toBeUndefined()
  })

  it('renders Ranking geral with incompleteness note when competitionCode is Gaúcho', async () => {
    mockFetch([
      gsMatch({ id: 'g-null', home_score: 2, away_score: 0 }),
      gsMatch({
        id: 'g-a',
        group_name: 'A',
        home_score: 0,
        away_score: 1,
        home_team_id: 'gre',
        home_team_name: 'Grêmio',
        home_team_short_name: 'GRE',
        away_team_id: 'int',
        away_team_name: 'Internacional',
        away_team_short_name: 'INT',
      }),
    ])
    render(
      <StandingsTab
        competitionId="gaucho"
        competitionType="cup"
        competitionCode="bra.camp.gaucho"
      />,
    )
    expect(await screen.findByText('Ranking geral')).toBeInTheDocument()
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent(/não entrega grupos completos/i)
    expect(note).toHaveTextContent(/não é a classificação oficial dos grupos/i)
    expect(screen.queryByText(/Grupo A/)).not.toBeInTheDocument()
    expect(screen.getByText('Brasil')).toBeInTheDocument()
    expect(screen.getByText('Internacional')).toBeInTheDocument()
  })

  it('does not enable the Gaúcho exception when competitionCode is missing', async () => {
    mockFetch([gsMatch({ id: 'g-null', home_score: 1, away_score: 0 })])
    render(<StandingsTab competitionId="gaucho" competitionType="cup" />)
    expect(
      await screen.findByText('Esta competição não tem fase de grupos.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Ranking geral')).not.toBeInTheDocument()
  })
})
