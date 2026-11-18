import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import JoinRequestsList from './JoinRequestsList'

vi.mock('../../analytics/funnel', () => ({
  trackJoinGroup: vi.fn(),
  trackJoinRequest: vi.fn(),
}))

vi.mock('../../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '../../lib/api'
import { trackJoinGroup } from '../../analytics/funnel'

describe('JoinRequestsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lista pedidos e aprova', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(
        Response.json({
          requests: [
            {
              id: 'req1',
              user_id: 'u2',
              display_name: 'Carla',
              avatar_url: null,
              created_at: '2026-11-18T12:00:00Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ group: { id: 'g1', name: 'Firma' } }))

    render(<JoinRequestsList groupId="g1" />)
    expect(await screen.findByText('Carla')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }))
    await waitFor(() => expect(trackJoinGroup).toHaveBeenCalledWith('request'))
    expect(screen.queryByText('Carla')).not.toBeInTheDocument()
  })
})
