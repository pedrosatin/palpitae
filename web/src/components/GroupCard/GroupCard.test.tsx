import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import GroupCard from './GroupCard'

const mockTrackEvent = vi.fn()
vi.mock('../../analytics/ga', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

const baseGroup = {
  id: 'group-1',
  name: 'Meu Grupo',
  is_admin: false,
  competition_id: 'comp-1',
  competition_name: 'Brasileirão 2026',
  created_at: '2026-01-01T00:00:00Z',
  member_count: 5,
  user_position: 2,
  user_points: 10,
  pending_predictions: 0,
}

describe('GroupCard', () => {
  const onClick = vi.fn()

  beforeEach(() => {
    onClick.mockClear()
    mockTrackEvent.mockClear()
  })

  it('renders group name', () => {
    render(<GroupCard group={baseGroup} onClick={onClick} />)
    expect(screen.getByText('Meu Grupo')).toBeInTheDocument()
  })

  it('renders member count, position and points', () => {
    render(<GroupCard group={baseGroup} onClick={onClick} />)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('shows Admin badge when currentUser is the admin', () => {
    render(<GroupCard group={{ ...baseGroup, is_admin: true }} onClick={onClick} />)
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('does not show Admin badge for non-admin users', () => {
    render(<GroupCard group={baseGroup} onClick={onClick} />)
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('calls onClick when the card button is clicked', async () => {
    render(<GroupCard group={baseGroup} onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: /Abrir grupo/i }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not show pending badge when pending_predictions is 0', () => {
    render(<GroupCard group={baseGroup} onClick={onClick} />)
    expect(screen.queryByText(/pendente/i)).not.toBeInTheDocument()
  })

  it('shows singular pending badge when pending_predictions is 1', () => {
    render(<GroupCard group={{ ...baseGroup, pending_predictions: 1 }} onClick={onClick} />)
    expect(screen.getByText('1 palpite pendente')).toBeInTheDocument()
  })

  it('shows plural pending badge when pending_predictions is more than 1', () => {
    render(<GroupCard group={{ ...baseGroup, pending_predictions: 3 }} onClick={onClick} />)
    expect(screen.getByText('3 palpites pendentes')).toBeInTheDocument()
  })

  describe('finished (encerrado) variant', () => {
    const finishedGroup = {
      ...baseGroup,
      competition_status: 'finished' as const,
      user_position: 5,
      user_points: 42,
      podium: [
        { position: 1, display: 'João', points: 152, is_you: false },
        { position: 2, display: 'Ana', points: 140, is_you: false },
        { position: 3, display: 'Rui', points: 131, is_you: false },
      ],
    }

    it('renders the podium instead of the stats block', () => {
      render(<GroupCard group={finishedGroup} onClick={onClick} />)
      expect(screen.getByText('João')).toBeInTheDocument()
      expect(screen.getByText('152')).toBeInTheDocument()
      // Stats labels from the active card must be gone.
      expect(screen.queryByText('Sua posição')).not.toBeInTheDocument()
    })

    it('labels the current user as "Você" when they are on the podium', () => {
      render(
        <GroupCard
          group={{
            ...finishedGroup,
            podium: [
              { position: 1, display: 'João', points: 152, is_you: true },
              { position: 2, display: 'Ana', points: 140, is_you: false },
            ],
          }}
          onClick={onClick}
        />,
      )
      expect(screen.getByText('Você')).toBeInTheDocument()
      expect(screen.queryByText('João')).not.toBeInTheDocument()
    })

    it('appends the user own row when they finished outside the top 3', () => {
      render(<GroupCard group={finishedGroup} onClick={onClick} />)
      // Not in podium → own row shows position #5 and 42 points.
      expect(screen.getByText('Você')).toBeInTheDocument()
      expect(screen.getByText('#5')).toBeInTheDocument()
      expect(screen.getByText('42')).toBeInTheDocument()
    })

    it('shows a share button that opens the share modal and tracks the click', async () => {
      render(<GroupCard group={finishedGroup} onClick={onClick} />)
      const shareBtn = screen.getByRole('button', { name: /Compartilhar resultado/i })

      await userEvent.click(shareBtn)

      expect(mockTrackEvent).toHaveBeenCalledWith('click_groupcard_compartilhar', {
        group_id: 'group-1',
      })
      // Modal opened.
      expect(screen.getByText('Compartilhar resultado', { selector: 'h2' })).toBeInTheDocument()
      // Opening the card must not fire when clicking share.
      expect(onClick).not.toHaveBeenCalled()
    })

    it('does not render a share button on active (non-finished) cards', () => {
      render(<GroupCard group={baseGroup} onClick={onClick} />)
      expect(
        screen.queryByRole('button', { name: /Compartilhar resultado/i }),
      ).not.toBeInTheDocument()
    })
  })
})
