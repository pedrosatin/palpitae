import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import PredictionsModal from './PredictionsModal'
import { UserPrediction } from './types'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

const member = {
  user_id: 'u1',
  display_name: 'Pedro',
  avatar_url: null,
  role: 'owner',
  joined_at: '2026-01-01T00:00:00Z',
  total_points: 20,
  exact_hits: 3,
}

const mockPredictions: UserPrediction[] = [
  {
    match_id: 'm1',
    predicted_home_score: 2,
    predicted_away_score: 1,
    points_awarded: 3,
    match_status: 'finished',
    match_start_time: '2026-01-01T15:00:00Z',
    home_score: 2,
    away_score: 1,
    round: 'r1',
    round_label: 'Rodada 1',
    group_name: 'A',
    home_team_name: 'Time A',
    home_team_short_name: 'TMA',
    home_team_logo: 'logoA.png',
    away_team_name: 'Time B',
    away_team_short_name: 'TMB',
    away_team_logo: 'logoB.png',
  },
  {
    match_id: 'm2',
    predicted_home_score: null,
    predicted_away_score: null,
    points_awarded: null,
    match_status: 'scheduled',
    match_start_time: '2026-01-02T15:00:00Z',
    home_score: null,
    away_score: null,
    round: 'r2',
    round_label: 'Rodada 2',
    group_name: 'A',
    home_team_name: 'Time C',
    home_team_short_name: 'TMC',
    home_team_logo: 'logoC.png',
    away_team_name: 'Time D',
    away_team_short_name: 'TMD',
    away_team_logo: 'logoD.png',
  },
]

function mockFetch(responseType: 'success' | 'empty' | 'error' = 'success') {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (responseType === 'error') {
      return { ok: false } as Response
    }

    return {
      ok: true,
      json: async () => ({
        predictions: responseType === 'empty' ? [] : mockPredictions,
        default_round: responseType === 'empty' ? null : 'r1',
      }),
    } as Response
  })
}

describe('PredictionsModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  it('renders loading state initially', () => {
    mockFetch()
    render(<PredictionsModal member={member} groupId="g1" onClose={() => {}} />)
    expect(screen.getByText('Carregando palpites...')).toBeInTheDocument()
  })

  it('renders error state on fetch failure', async () => {
    mockFetch('error')
    render(<PredictionsModal member={member} groupId="g1" onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('Erro ao carregar palpites')).toBeInTheDocument()
    })
  })

  it('renders empty state when no predictions are returned', async () => {
    mockFetch('empty')
    render(<PredictionsModal member={member} groupId="g1" onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('Nenhum jogo encontrado.')).toBeInTheDocument()
    })
  })

  it('renders predictions and handles analytics on round navigation', async () => {
    mockFetch()
    render(<PredictionsModal member={member} groupId="g1" onClose={() => {}} />)

    // Wait for predictions to load
    await waitFor(() => {
      expect(screen.getByText('TMA')).toBeInTheDocument()
    })

    // Check missing prediction
    expect(screen.queryByText('TMC')).not.toBeInTheDocument() // round 2 not visible

    const user = userEvent.setup()

    // Next round
    const nextBtn = screen.getByRole('button', { name: 'Próxima rodada' })
    await user.click(nextBtn)

    expect(mockTrackEvent).toHaveBeenCalledWith('click_leaderboard_proxima_rodada', { round: 'r2' })

    // Round 2 should be visible now
    await waitFor(() => {
      expect(screen.getByText('TMC')).toBeInTheDocument()
    })

    // Check edge case for scheduled match without prediction
    expect(screen.getByText(/02\/01, 12:00/)).toBeInTheDocument()

    // Prev round
    const prevBtn = screen.getByRole('button', { name: 'Rodada anterior' })
    await user.click(prevBtn)

    expect(mockTrackEvent).toHaveBeenCalledWith('click_leaderboard_rodada_anterior', {
      round: 'r1',
    })

    // Select round directly
    const select = screen.getByRole('combobox')
    await user.selectOptions(select, 'r2')

    expect(mockTrackEvent).toHaveBeenCalledWith('change_leaderboard_rodada', { round: 'r2' })
  })
})
