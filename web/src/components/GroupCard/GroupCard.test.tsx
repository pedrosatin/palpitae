import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
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

  it('mostra travessão em "Sua posição" quando a API não devolve posição', () => {
    render(<GroupCard group={{ ...baseGroup, user_position: null }} onClick={onClick} />)
    expect(screen.getByText('Sua posição').nextElementSibling).toHaveTextContent(/^—$/)
  })

  it('shows Admin badge when currentUser is the admin', () => {
    render(<GroupCard group={{ ...baseGroup, is_admin: true }} onClick={onClick} />)
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('renders the badges right after the title with the full competition name', () => {
    const competition_name = 'Campeonato Brasileiro Série A'
    render(
      <GroupCard
        group={{ ...baseGroup, name: 'Champions', is_admin: true, competition_name }}
        onClick={onClick}
      />,
    )
    const title = screen.getByRole('heading', { name: 'Champions' })
    const badges = title.nextElementSibling as HTMLElement
    // A linha de badges é o irmão seguinte do título.
    expect(badges).not.toBeNull()
    expect(Array.from(badges.children).map((badge) => badge.textContent)).toEqual([
      'Admin',
      competition_name,
    ])
  })

  it('does not repeat the competition name in a hover tooltip', () => {
    // O tooltip cobria o título e repetia o texto da badge.
    const { container } = render(<GroupCard group={baseGroup} onClick={onClick} />)
    expect(container.querySelector('[data-tooltip]')).toBeNull()
  })

  it('does not show Admin badge for non-admin users', () => {
    render(<GroupCard group={baseGroup} onClick={onClick} />)
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('links to the group', () => {
    render(<GroupCard group={baseGroup} onClick={onClick} />)
    expect(screen.getByRole('link', { name: /Abrir grupo/i })).toHaveAttribute('href', '/grupos/group-1')
  })

  it('calls onClick when the card link is clicked', async () => {
    render(<GroupCard group={baseGroup} onClick={onClick} />)
    await userEvent.click(screen.getByRole('link', { name: /Abrir grupo/i }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('allows the browser to handle Ctrl-click', () => {
    render(<GroupCard group={baseGroup} onClick={onClick} />)
    const link = screen.getByRole('link', { name: /Abrir grupo/i })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    fireEvent(link, event)
    expect(event.defaultPrevented).toBe(false)
    expect(onClick).not.toHaveBeenCalled()
  })

  describe('linha de status da rodada', () => {
    // Quinta, 12/11/2026, 12:00 em Brasília.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-12T15:00:00Z'))
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    const ongoing = {
      ...baseGroup,
      competition_status: 'ongoing' as const,
      next_deadline: null,
      next_match_at: null,
      current_round_label: null,
      round_ends_at: null,
      live_matches: 0,
    }
    const deadline = {
      match_id: 'm1',
      start_time: '2026-11-14T21:30:00Z',
      round: '35',
      round_label: 'Rodada 35',
      round_agreement: 'fs' as const,
      home_team: 'Mirassol',
      away_team: 'Atlético-MG',
    }

    it.each([
      [
        'jogos sem palpite',
        { pending_predictions: 10, next_deadline: deadline, next_match_at: deadline.start_time },
        '10 sem palpite · fecha sáb 18:30',
        '10 sem palpite, fecha sáb 18:30',
      ],
      [
        'rodada completa',
        {
          current_round_label: 'Rodada 35',
          current_round_agreement: 'fs' as const,
          next_match_at: deadline.start_time,
        },
        'Rodada 35 completa ✓ · próximo jogo sáb 18:30',
        'Rodada 35 completa, próximo jogo sáb 18:30',
      ],
      [
        'jogo ao vivo',
        { live_matches: 2, next_match_at: deadline.start_time },
        '2 jogos ao vivo',
        '2 jogos ao vivo',
      ],
      ['sem jogos', {}, 'Sem jogos marcados', 'Sem jogos marcados'],
    ])(
      'mostra uma linha só para %s e repete no rótulo do link sem símbolos',
      (_kind, fields, text, label) => {
        const { container } = render(
          <GroupCard group={{ ...ongoing, ...fields }} onClick={onClick} />,
        )
        const lines = container.querySelectorAll('[data-kind]')
        expect(lines).toHaveLength(1)
        expect(lines[0]).toHaveTextContent(text)
        expect(
          screen.getByRole('link', { name: `Abrir grupo Meu Grupo, ${label}` }),
        ).toBeInTheDocument()
      },
    )

    it('marca a pendência para o estilo de destaque', () => {
      const { container } = render(
        <GroupCard group={{ ...ongoing, pending_predictions: 1 }} onClick={onClick} />,
      )
      expect(container.querySelector('[data-kind="pending"]')).toHaveTextContent('1 sem palpite')
    })
  })

  it('não mostra linha de status com a resposta antiga da API, sem next_match_at', () => {
    const { container } = render(<GroupCard group={baseGroup} onClick={onClick} />)
    expect(container.querySelector('[data-kind]')).toBeNull()
    expect(screen.getByRole('link', { name: 'Abrir grupo Meu Grupo' })).toBeInTheDocument()
  })

  it('esconde a linha de status do grupo encerrado mesmo com contagem vinda da API', () => {
    const { container } = render(
      <GroupCard
        group={{
          ...baseGroup,
          competition_status: 'finished',
          pending_predictions: 4,
          live_matches: 1,
          podium: [{ position: 1, display: 'Ana', points: 10, is_you: true }],
        }}
        onClick={onClick}
      />,
    )
    expect(container.querySelector('[data-kind]')).toBeNull()
    expect(screen.queryByText(/sem palpite/i)).not.toBeInTheDocument()
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

      expect(mockTrackEvent).toHaveBeenCalledWith('click_groupcard_compartilhar')
      // Modal opened.
      expect(screen.getByText('Compartilhar resultado', { selector: 'h2' })).toBeInTheDocument()
      // Opening the card must not fire when clicking share.
      expect(onClick).not.toHaveBeenCalled()
    })

    it('sem posição, mostra travessão e não oferece o cartão de resultado', () => {
      render(
        <GroupCard
          group={{ ...finishedGroup, user_position: null, user_points: 0 }}
          onClick={onClick}
        />,
      )
      expect(screen.getByText('Você').previousElementSibling).toHaveTextContent(/^—$/)
      expect(
        screen.queryByRole('button', { name: /Compartilhar resultado/i }),
      ).not.toBeInTheDocument()
    })

    it('does not render a share button on active (non-finished) cards', () => {
      render(<GroupCard group={baseGroup} onClick={onClick} />)
      expect(
        screen.queryByRole('button', { name: /Compartilhar resultado/i }),
      ).not.toBeInTheDocument()
    })
  })
})
