import { render, screen, waitFor, within } from '@testing-library/react'
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

describe('LeaderboardTab header and badges', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('names the numeric columns in full for screen readers, with short visible labels', async () => {
    mockFetch()
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    const exact = screen.getByRole('columnheader', { name: 'Placares exatos' })
    expect(exact).not.toHaveAttribute('aria-label')
    expect(within(exact).getByText('Ex.')).toHaveAttribute('aria-hidden', 'true')
    expect(within(exact).getByText('Placares exatos')).not.toHaveAttribute('aria-hidden')
    const points = screen.getByRole('columnheader', { name: 'Pontos' })
    expect(points).not.toHaveAttribute('aria-label')
    expect(within(points).getByText('Pts')).toHaveAttribute('aria-hidden', 'true')
  })

  it('groups the admin and você badges under the member name', async () => {
    mockFetch()
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Pedro'))
    const badges = screen.getByText('admin').parentElement as HTMLElement
    expect(badges).toContainElement(screen.getByText('você'))
    expect(badges.parentElement).toContainElement(screen.getByText('Pedro'))
  })
})

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

describe('LeaderboardTab regras', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('mostra o desempate sob a tabela e abre as regras pelo link', async () => {
    mockFetch()
    const onOpenRules = vi.fn()
    render(
      <LeaderboardTab
        groupId="g1"
        currentUserId="u1"
        tiebreakNote="Desempate: mais pontos."
        onOpenRules={onOpenRules}
      />,
    )

    await waitFor(() => screen.getByText('Ana'))
    expect(screen.getByText('Desempate: mais pontos.')).toBeInTheDocument()

    const link = screen.getByRole('button', { name: 'Como pontua' })
    await userEvent.click(link)

    expect(onOpenRules).toHaveBeenCalledWith(link)
  })

  it('não mostra a linha de regras sem as props', async () => {
    mockFetch()
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    expect(screen.queryByRole('button', { name: 'Como pontua' })).not.toBeInTheDocument()
  })
})
