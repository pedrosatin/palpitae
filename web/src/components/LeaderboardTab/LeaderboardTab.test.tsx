import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import LeaderboardTab from './LeaderboardTab'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

const members = [
  {
    user_id: 'u1',
    display_name: 'Pedro',
    avatar_url: null,
    role: 'owner',
    joined_at: '2026-01-01T00:00:00Z',
    total_points: 20,
    exact_hits: 3,
  },
  {
    user_id: 'u2',
    display_name: 'Ana',
    avatar_url: null,
    role: 'member',
    joined_at: '2026-01-02T00:00:00Z',
    total_points: 10,
    exact_hits: 1,
  },
]

function mockFetch() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()
    if (u.includes('/predictions/user')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ predictions: [] }),
      } as Response)
    }
    if (u.includes('/members')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ members }),
      } as Response)
    }
    return Promise.reject(new Error(`Unexpected fetch: ${u}`))
  })
}

describe('LeaderboardTab – analytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  it('fires click_leaderboard_ver_palpites when a member row is clicked', async () => {
    mockFetch()
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    await userEvent.click(screen.getByText('Ana'))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_leaderboard_ver_palpites')
  })
})
