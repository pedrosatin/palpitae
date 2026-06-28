import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import GroupPicksTab from './GroupPicksTab'
import { makeMatch } from '../matchFixtures'
import { type Match } from '../MatchCard'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

interface GroupPicksResponse {
  self_user_id: string
  members: Array<{ user_id: string; display: string }>
  predictions: Array<Record<string, unknown>>
}

function mockFetch(matches: Match[], picks: GroupPicksResponse) {
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
      const chronologicalLast = matches.reduce<Match | undefined>(
        (acc, m) => !acc || m.start_time >= acc.start_time ? m : acc,
        undefined,
      )
      const default_round = activeRound?.[0] ?? chronologicalLast?.round ?? null
      return Promise.resolve({
        ok: true,
        json: async () => ({ matches, default_round }),
      } as Response)
    }
    if (u.includes('/predictions/group')) {
      return Promise.resolve({
        ok: true,
        json: async () => picks,
      } as Response)
    }
    return Promise.reject(new Error(`Unexpected fetch: ${u}`))
  })
}

describe('GroupPicksTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows each member prediction for a revealed match, flagging the current user', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: [
        { user_id: 'user-1', display: 'Pedro' },
        { user_id: 'user-2', display: 'Ana' },
      ],
      predictions: [
        {
          match_id: 'm1',
          user_id: 'user-1',
          user_display: 'Pedro',
          predicted_home_score: 2,
          predicted_away_score: 1,
          points_awarded: 0,
          locked: 0,
        },
        {
          match_id: 'm1',
          user_id: 'user-2',
          user_display: 'Ana',
          predicted_home_score: 0,
          predicted_away_score: 0,
          points_awarded: 0,
          locked: 0,
        },
      ],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('Pedro')).toBeInTheDocument()
    })
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('(você)')).toBeInTheDocument()
    expect(screen.getByText('Pedro').closest('li')).toHaveTextContent('2 × 1')
    expect(screen.getByText('Ana').closest('li')).toHaveTextContent('0 × 0')
  })

  it('hides predictions for a match the user has not predicted yet', async () => {
    const matches = [makeMatch({ id: 'm2', round: '1', status: 'scheduled' })]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: [{ user_id: 'user-1', display: 'Pedro' }],
      predictions: [], // user-1 has not predicted m2 → nothing revealed
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText(/Faça seu palpite/i)).toBeInTheDocument()
    })
    expect(screen.queryByText('(você)')).not.toBeInTheDocument()
  })

  it('shows the penalty-winner pick for a draw in a knockout match', async () => {
    const matches = [
      makeMatch({
        id: 'm1',
        round: '1',
        status: 'scheduled',
        decides_on_penalties: true,
      }),
    ]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: [
        { user_id: 'user-1', display: 'Pedro' },
        { user_id: 'user-2', display: 'Ana' },
      ],
      predictions: [
        {
          match_id: 'm1',
          user_id: 'user-1',
          user_display: 'Pedro',
          predicted_home_score: 1,
          predicted_away_score: 1,
          predicted_penalty_winner: 'home',
          points_awarded: 0,
          penalty_points: 0,
          locked: 0,
        },
        {
          match_id: 'm1',
          user_id: 'user-2',
          user_display: 'Ana',
          predicted_home_score: 1,
          predicted_away_score: 1,
          predicted_penalty_winner: 'away',
          points_awarded: 0,
          penalty_points: 0,
          locked: 0,
        },
      ],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('Pedro')).toBeInTheDocument()
    })
    // Same 1×1 score, told apart only by who each backed in the shootout.
    expect(screen.getByText('Pedro').closest('li')).toHaveTextContent('BRA')
    expect(screen.getByText('Ana').closest('li')).toHaveTextContent('ARG')
  })

  it('omits the penalty pick when the draw is not in a knockout', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: [{ user_id: 'user-1', display: 'Pedro' }],
      predictions: [
        {
          match_id: 'm1',
          user_id: 'user-1',
          user_display: 'Pedro',
          predicted_home_score: 1,
          predicted_away_score: 1,
          predicted_penalty_winner: null,
          points_awarded: 0,
          penalty_points: 0,
          locked: 0,
        },
      ],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('Pedro')).toBeInTheDocument()
    })
    expect(screen.getByText('Pedro').closest('li')).not.toHaveTextContent('⚽')
  })

  it('folds the penalty bonus into the displayed points total', async () => {
    const matches = [
      makeMatch({
        id: 'm1',
        round: '1',
        status: 'finished',
        home_score: 1,
        away_score: 1,
        decides_on_penalties: true,
      }),
    ]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: [{ user_id: 'user-1', display: 'Pedro' }],
      predictions: [
        {
          match_id: 'm1',
          user_id: 'user-1',
          user_display: 'Pedro',
          predicted_home_score: 1,
          predicted_away_score: 1,
          predicted_penalty_winner: 'home',
          points_awarded: 3,
          penalty_points: 1,
          locked: 1,
        },
      ],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('4 pt')).toBeInTheDocument()
    })
  })

  it('shows awarded points for a finished match', async () => {
    const matches = [
      makeMatch({
        id: 'm1',
        round: '1',
        status: 'finished',
        home_score: 2,
        away_score: 1,
      }),
    ]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: [{ user_id: 'user-1', display: 'Pedro' }],
      predictions: [
        {
          match_id: 'm1',
          user_id: 'user-1',
          user_display: 'Pedro',
          predicted_home_score: 2,
          predicted_away_score: 1,
          points_awarded: 3,
          locked: 1,
        },
      ],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('3 pt')).toBeInTheDocument()
    })
  })
})

describe('GroupPicksTab – analytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  function twoRounds() {
    return {
      matches: [
        makeMatch({ id: 'm1', round: '1', status: 'scheduled' }),
        makeMatch({ id: 'm2', round: '2', status: 'scheduled' }),
      ],
      picks: {
        self_user_id: 'user-1',
        members: [{ user_id: 'user-1', display: 'Pedro' }],
        predictions: [],
      },
    }
  }

  it('fires click_group_picks_proxima_rodada when Próxima is clicked', async () => {
    const { matches, picks } = twoRounds()
    mockFetch(matches, picks)
    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('1')
    })
    await userEvent.click(screen.getByRole('button', { name: /Próxima rodada/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_picks_proxima_rodada', { round: '2' })
  })

  it('fires click_group_picks_rodada_anterior when Anterior is clicked', async () => {
    const { matches, picks } = twoRounds()
    mockFetch(matches, picks)
    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('1')
    })
    await userEvent.click(screen.getByRole('button', { name: /Próxima rodada/i }))
    mockTrackEvent.mockClear()
    await userEvent.click(screen.getByRole('button', { name: /Rodada anterior/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_picks_rodada_anterior', { round: '1' })
  })

  it('fires change_group_picks_rodada when the round select is changed', async () => {
    const { matches, picks } = twoRounds()
    mockFetch(matches, picks)
    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => screen.getByRole('combobox'))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Rodada 2')
    expect(mockTrackEvent).toHaveBeenCalledWith('change_group_picks_rodada', { round: '2' })
  })
})
