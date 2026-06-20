import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import MembersTab from './MembersTab'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

const members = [
  {
    user_id: 'u-admin',
    display_name: 'Admin',
    avatar_url: null,
    role: 'owner',
    joined_at: '2026-01-01T00:00:00Z',
    total_points: 20,
    exact_hits: 3,
  },
  {
    user_id: 'u-other',
    display_name: 'Outro',
    avatar_url: null,
    role: 'member',
    joined_at: '2026-01-02T00:00:00Z',
    total_points: 10,
    exact_hits: 1,
  },
]

describe('MembersTab – analytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  it('fires click_members_remover when the Remover button is clicked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ members }),
    } as Response)

    render(<MembersTab groupId="g1" currentUserId="u-admin" />)

    await waitFor(() => screen.getByText('Outro'))
    await userEvent.click(screen.getByRole('button', { name: 'Remover' }))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_members_remover')
  })
})
