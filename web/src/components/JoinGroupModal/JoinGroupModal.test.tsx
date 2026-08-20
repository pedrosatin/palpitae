import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import JoinGroupModal from './JoinGroupModal'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onJoined: vi.fn(),
}

describe('JoinGroupModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
    defaultProps.onClose.mockClear()
    defaultProps.onJoined.mockClear()
  })

  it('renders the invite code input when open', () => {
    render(<JoinGroupModal {...defaultProps} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('does not render when isOpen is false', () => {
    render(<JoinGroupModal {...defaultProps} isOpen={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('pre-fills invite code from initialCode prop', () => {
    render(<JoinGroupModal {...defaultProps} initialCode="ABC123" />)
    expect(screen.getByRole('textbox')).toHaveValue('ABC123')
  })

  it('calls onJoined with the joined group on success', async () => {
    const joinedGroup = { id: 'g1', name: 'Group 1' }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: joinedGroup }),
    } as Response)

    render(<JoinGroupModal {...defaultProps} />)
    await userEvent.type(screen.getByRole('textbox'), 'INVITE1')
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(defaultProps.onJoined).toHaveBeenCalledWith(joinedGroup)
    })
  })

  it('shows error message on API failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Código inválido' }),
    } as Response)

    render(<JoinGroupModal {...defaultProps} />)
    await userEvent.type(screen.getByRole('textbox'), 'BAD')
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(screen.getByText('Código inválido')).toBeInTheDocument()
    })
  })

  it('fires submit_entrar_grupo when the user successfully joins a group', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: { id: 'g1', name: 'Group 1' } }),
    } as Response)

    render(<JoinGroupModal {...defaultProps} />)
    await userEvent.type(screen.getByRole('textbox'), 'INVITE1')
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith('submit_entrar_grupo')
    })
  })

  it('normalises a share URL pasted into the input', async () => {
    const joinedGroup = { id: 'g1', name: 'Group 1' }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: joinedGroup }),
    } as Response)

    render(<JoinGroupModal {...defaultProps} />)
    await userEvent.type(screen.getByRole('textbox'), 'https://example.com?convite=abc123')
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
      expect(body.invite_code).toBe('ABC123')
    })
  })

  it('normalises a non-URL string (plain invite code)', async () => {
    const joinedGroup = { id: 'g1', name: 'Group 1' }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: joinedGroup }),
    } as Response)

    render(<JoinGroupModal {...defaultProps} />)
    await userEvent.type(screen.getByRole('textbox'), '  abc-123  ')
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
      expect(body.invite_code).toBe('ABC-123')
    })
  })
})
