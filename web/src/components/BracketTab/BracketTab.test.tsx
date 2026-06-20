import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import BracketTab from './BracketTab'
import type { BracketData } from './types'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeData(overrides: Partial<BracketData> = {}): BracketData {
  return {
    self_user_id: 'user-1',
    teams: [
      { id: 't-bra', name: 'Brasil', short_name: 'BRA', logo_url: null },
      { id: 't-arg', name: 'Argentina', short_name: 'ARG', logo_url: null },
    ],
    team_groups: { 't-bra': 'A', 't-arg': 'B' },
    round_points: {
      LAST_32: 1,
      LAST_16: 2,
      QUARTER_FINALS: 4,
      SEMI_FINALS: 8,
      FINAL: 16,
      THIRD_PLACE: 4,
    },
    rounds: {
      LAST_32: [
        {
          position: 1,
          match: null,
          locked: false,
          my_pick: null,
          members_picks: [
            {
              user_id: 'user-2',
              user_display: 'Ana',
              team_id: 't-bra',
              team_name: 'Brasil',
              team_short: 'BRA',
              team_logo: null,
            },
          ],
        },
      ],
    },
    ...overrides,
  }
}

function mockFetch(data: BracketData) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()
    if (u.includes('/bracket')) {
      return Promise.resolve({ ok: true, json: async () => data } as Response)
    }
    return Promise.reject(new Error(`Unexpected fetch: ${u}`))
  })
}

describe('BracketTab – viewing other members', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('offers a selector listing other members who have picks', async () => {
    mockFetch(makeData())

    render(<BracketTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: 'Meu chaveamento (editável)' }),
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('option', { name: 'Ana' })).toBeInTheDocument()
  })

  it('does not show the selector when nobody else has picked', async () => {
    mockFetch(
      makeData({
        rounds: {
          LAST_32: [
            {
              position: 1,
              match: null,
              locked: false,
              my_pick: null,
              members_picks: [],
            },
          ],
        },
      }),
    )

    render(<BracketTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText(/Pontuação:/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it("renders the selected member's pick read-only", async () => {
    mockFetch(makeData())

    render(<BracketTab groupId="g1" competitionId="c1" />)

    const select = await screen.findByRole('combobox')
    await userEvent.selectOptions(
      select,
      screen.getByRole('option', { name: 'Ana' }),
    )

    // Read-only notice + the member's picked team + at least one lock icon
    expect(
      screen.getByText(/Visualizando o chaveamento de/),
    ).toBeInTheDocument()
    expect(screen.getByText('BRA')).toBeInTheDocument()
    expect(screen.getAllByText('🔒').length).toBeGreaterThan(0)
  })
})

describe('BracketTab – analytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  it('fires change_bracket_ver_membro when a member is selected', async () => {
    mockFetch(makeData())
    render(<BracketTab groupId="g1" competitionId="c1" />)

    const select = await screen.findByRole('combobox')
    await userEvent.selectOptions(
      select,
      screen.getByRole('option', { name: 'Ana' }),
    )

    expect(mockTrackEvent).toHaveBeenCalledWith('change_bracket_ver_membro')
  })

  it('does not fire change_bracket_ver_membro when switching back to own bracket', async () => {
    mockFetch(makeData())
    render(<BracketTab groupId="g1" competitionId="c1" />)

    const select = await screen.findByRole('combobox')
    await userEvent.selectOptions(select, screen.getByRole('option', { name: 'Ana' }))
    mockTrackEvent.mockClear()
    await userEvent.selectOptions(
      select,
      screen.getByRole('option', { name: 'Meu chaveamento (editável)' }),
    )

    expect(mockTrackEvent).not.toHaveBeenCalledWith('change_bracket_ver_membro')
  })

  it('fires click_bracket_expandir then click_bracket_reduzir when toggling fullscreen', async () => {
    mockFetch(makeData())
    render(<BracketTab groupId="g1" competitionId="c1" />)

    const expandBtn = await screen.findByRole('button', { name: /Expandir chaveamento/i })
    await userEvent.click(expandBtn)
    expect(mockTrackEvent).toHaveBeenCalledWith('click_bracket_expandir')

    await userEvent.click(screen.getByRole('button', { name: /Sair da tela cheia/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_bracket_reduzir')
  })

  it('fires click_bracket_escolher_time with round and position when a team is picked', async () => {
    // A slot whose match has both teams determined renders direct duel buttons,
    // so we can pick a team without driving the grouped dropdown.
    mockFetch(
      makeData({
        rounds: {
          LAST_32: [
            {
              position: 1,
              match: {
                id: 'bm1',
                home_team_id: 't-bra',
                home_team_name: 'Brasil',
                home_team_short: 'BRA',
                home_team_logo: null,
                away_team_id: 't-arg',
                away_team_name: 'Argentina',
                away_team_short: 'ARG',
                away_team_logo: null,
                home_score: null,
                away_score: null,
                status: 'scheduled',
                start_time: new Date(Date.now() + 3_600_000).toISOString(),
              },
              locked: false,
              my_pick: null,
              members_picks: [],
            },
          ],
        },
      }),
    )
    render(<BracketTab groupId="g1" competitionId="c1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'BRA' }))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_bracket_escolher_time', {
      round: 'LAST_32',
      position: 1,
    })
  })
})
