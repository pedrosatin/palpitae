import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ShareGroupModal from './ShareGroupModal'
import type { GroupWithStats } from '../GroupCard'

const mockTrackEvent = vi.fn()
vi.mock('../../analytics/ga', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

const group: GroupWithStats = {
  id: 'g1',
  name: 'Meu Grupo',
  is_admin: false,
  competition_id: 'comp-1',
  competition_name: 'Copa 2026',
  competition_status: 'finished',
  created_at: '2026-01-01T00:00:00Z',
  member_count: 8,
  user_position: 5,
  user_points: 42,
  podium: [{ position: 1, display: 'João', points: 152, is_you: false }],
}

const shareBtn = () => screen.queryByRole('button', { name: /^Compartilhar$/ })

describe('ShareGroupModal', () => {
  const originalCanShare = navigator.canShare

  beforeEach(() => {
    mockTrackEvent.mockClear()
  })

  afterEach(() => {
    // Restaura a capability entre testes.
    Object.defineProperty(navigator, 'canShare', {
      value: originalCanShare,
      configurable: true,
      writable: true,
    })
  })

  it('hides the share button on platforms without file sharing (desktop)', () => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
    render(<ShareGroupModal isOpen onClose={vi.fn()} group={group} />)

    // Sem share de arquivo → nada de "Compartilhar" redundante; baixar é o primário.
    expect(shareBtn()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Baixar imagem/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copiar link/i })).toBeInTheDocument()
  })

  it('shows the share button when the platform can share image files (mobile)', () => {
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn(() => true),
      configurable: true,
    })
    render(<ShareGroupModal isOpen onClose={vi.fn()} group={group} />)

    expect(shareBtn()).toBeInTheDocument()
  })

  it('copies the landing link and tracks the click', async () => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<ShareGroupModal isOpen onClose={vi.fn()} group={group} />)
    await userEvent.click(screen.getByRole('button', { name: /Copiar link/i }))

    expect(writeText).toHaveBeenCalledWith(window.location.origin)
    expect(mockTrackEvent).toHaveBeenCalledWith('click_share_copiar_link')
    expect(screen.getByRole('button', { name: /Link copiado/i })).toBeInTheDocument()
  })
})
