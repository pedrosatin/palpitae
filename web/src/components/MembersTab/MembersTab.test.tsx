import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as ga from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import { groupMembersQueryKey } from '../../lib/groupMembers'
import { groupPredictionsQueryKey } from '../../lib/groupPredictions'
import { groupsListQueryKey } from '../../lib/groupsList'
import { createTestQueryClient, renderWithQuery } from '../../test-utils'
import { useConfirm } from '../ConfirmModal'
import MembersTab from './MembersTab'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
vi.mock('../../analytics/funnel', () => ({
  trackApproveJoinRequest: vi.fn(),
  trackJoinRequest: vi.fn(),
}))
vi.mock('../ConfirmModal', () => ({
  useConfirm: vi.fn(),
}))
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, apiFetch: vi.fn() }
})

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
    vi.clearAllMocks()
    vi.mocked(useConfirm).mockReturnValue({
      confirm: vi.fn().mockResolvedValue(false) as unknown as ReturnType<typeof useConfirm>['confirm'],
      confirmDialog: null as never,
    })
  })

  it('fires click_members_remover when the Remover button is clicked', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(Response.json({ members }))
      .mockResolvedValueOnce(Response.json({ requests: [] }))

    renderWithQuery(<MembersTab groupId="g1" currentUserId="u-admin" />)

    await waitFor(() => screen.getByText('Outro'))
    await userEvent.click(screen.getByRole('button', { name: 'Remover' }))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_members_remover')
  })
})

describe('MembersTab – cache após mudança de membros', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useConfirm).mockReturnValue({
      confirm: vi.fn().mockResolvedValue(true) as unknown as ReturnType<typeof useConfirm>['confirm'],
      confirmDialog: null as never,
    })
  })

  it('ao remover membro invalida palpites do grupo e a lista de grupos', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(Response.json({ members }))
      .mockResolvedValueOnce(Response.json({ requests: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const queryClient = createTestQueryClient()
    queryClient.setQueryData(groupPredictionsQueryKey('g1'), {
      self_user_id: 'u-admin',
      members: [],
      predictions: [],
    })
    queryClient.setQueryData(groupsListQueryKey('u-admin'), {
      groups: [],
      matched_invite_group_id: null,
    })

    const onMemberRemoved = vi.fn()
    renderWithQuery(
      <MembersTab groupId="g1" currentUserId="u-admin" onMemberRemoved={onMemberRemoved} />,
      { queryClient },
    )

    await waitFor(() => expect(screen.getByText('Outro')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Remover' }))

    await waitFor(() => expect(onMemberRemoved).toHaveBeenCalledWith('u-other'))
    expect(queryClient.getQueryState(groupPredictionsQueryKey('g1'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(groupsListQueryKey('u-admin'))?.isInvalidated).toBe(true)
  })

  it('ao aprovar pedido invalida palpites do grupo e a lista de grupos', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(groupPredictionsQueryKey('g1'), {
      self_user_id: 'u-admin',
      members: [],
      predictions: [],
    })
    queryClient.setQueryData(groupsListQueryKey('u-admin'), {
      groups: [],
      matched_invite_group_id: null,
    })
    queryClient.setQueryData(groupMembersQueryKey('g1'), members)

    vi.mocked(apiFetch)
      .mockResolvedValueOnce(
        Response.json({
          requests: [
            {
              id: 'req1',
              user_id: 'u-new',
              display_name: 'Nova',
              avatar_url: null,
              created_at: '2026-01-03T00:00:00Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }))

    const onJoinRequestDecided = vi.fn()
    renderWithQuery(
      <MembersTab
        groupId="g1"
        currentUserId="u-admin"
        onJoinRequestDecided={onJoinRequestDecided}
      />,
      { queryClient },
    )

    await waitFor(() => expect(screen.getByText('Nova')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }))

    await waitFor(() => expect(onJoinRequestDecided).toHaveBeenCalledWith('approve'))
    expect(queryClient.getQueryState(groupPredictionsQueryKey('g1'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(groupsListQueryKey('u-admin'))?.isInvalidated).toBe(true)
  })
})
