import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import GroupPicksTab from './GroupPicksTab'
import { type Match } from '../MatchCard'

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 'm1',
    start_time: new Date(Date.now() + 3_600_000).toISOString(),
    status: 'scheduled',
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

interface GroupPicksResponse {
  self_user_id: string
  members: Array<{ user_id: string; display: string }>
  predictions: Array<Record<string, unknown>>
}

function mockFetch(matches: Match[], picks: GroupPicksResponse) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()
    if (u.includes('/matches')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ matches }),
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
