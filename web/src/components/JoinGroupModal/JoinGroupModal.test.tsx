import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import { rememberInviteDocument, wasInviteDocumentOpened } from '../../lib/invite'
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
    sessionStorage.clear()
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

  it('mostra aviso legível quando a resposta de erro não é JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html><h1>502 Bad Gateway</h1></html>', { status: 502 }),
    )

    render(<JoinGroupModal {...defaultProps} />)
    await userEvent.type(screen.getByRole('textbox'), 'ABC123')
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

    expect(await screen.findByText('Erro de conexão. Tente novamente.')).toBeInTheDocument()
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

  it('extracts the code from the new /convite/CODE link', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: { id: 'g1', name: 'Group 1' } }),
    } as Response)

    render(<JoinGroupModal {...defaultProps} />)
    await userEvent.type(screen.getByRole('textbox'), 'https://palpitae.com.br/convite/abcd-ef23')
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
      expect(body.invite_code).toBe('ABCD-EF23')
    })
  })

  it('tracks join_group with entry_method convite_link when the code came from the link', async () => {
    rememberInviteDocument('/convite/ABCD-EF23')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: { id: 'g1', name: 'Group 1' } }),
    } as Response)

    render(<JoinGroupModal {...defaultProps} initialCode="abcd-ef23" />)
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith('join_group', {
        entry_method: 'convite_link',
      })
    })
  })

  it('tracks join_group with entry_method codigo when the code was typed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: { id: 'g2', name: 'Group 2' } }),
    } as Response)

    render(<JoinGroupModal {...defaultProps} />)
    await userEvent.type(screen.getByRole('textbox'), 'ABCD-EF23')
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith('join_group', {
        entry_method: 'codigo',
      })
    })
  })

  describe('entry_method enviado à API', () => {
    function mockJoin() {
      return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ group: { id: 'g1', name: 'Group 1' } }),
      } as Response)
    }

    const sentMethod = (spy: ReturnType<typeof mockJoin>) =>
      JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string).entry_method

    it('convite_link quando o código é o que veio no link', async () => {
      rememberInviteDocument('/convite/ABCD-EF23')
      const fetchSpy = mockJoin()

      render(<JoinGroupModal {...defaultProps} initialCode="abcd-ef23" />)
      await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

      await waitFor(() => expect(sentMethod(fetchSpy)).toBe('convite_link'))
    })

    it('convite_antigo quando o link não passou pela página de convite', async () => {
      const fetchSpy = mockJoin()

      render(<JoinGroupModal {...defaultProps} initialCode="abcd-ef23" />)
      await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

      await waitFor(() => expect(sentMethod(fetchSpy)).toBe('convite_antigo'))
    })

    it('consome a abertura ao entrar: a mesma aba não reaproveita em outra entrada', async () => {
      rememberInviteDocument('/convite/ABCD-EF23')
      const fetchSpy = mockJoin()

      render(<JoinGroupModal {...defaultProps} initialCode="abcd-ef23" />)
      await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

      await waitFor(() => expect(sentMethod(fetchSpy)).toBe('convite_link'))
      await waitFor(() => expect(wasInviteDocumentOpened('ABCD-EF23')).toBe(false))
    })

    it('preserva a abertura de outro convite ao entrar por código digitado', async () => {
      rememberInviteDocument('/convite/ABCD-EF23')
      const fetchSpy = mockJoin()

      render(<JoinGroupModal {...defaultProps} />)
      await userEvent.type(screen.getByRole('textbox'), 'WXYZ-2345')
      await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

      await waitFor(() => expect(defaultProps.onJoined).toHaveBeenCalled())
      expect(sentMethod(fetchSpy)).toBe('codigo')
      expect(wasInviteDocumentOpened('ABCD-EF23')).toBe(true)
    })

    it('mantém a abertura quando a entrada falha', async () => {
      rememberInviteDocument('/convite/ABCD-EF23')
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Falhou' }),
      } as Response)

      render(<JoinGroupModal {...defaultProps} initialCode="abcd-ef23" />)
      await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

      expect(await screen.findByText('Falhou')).toBeInTheDocument()
      expect(wasInviteDocumentOpened('ABCD-EF23')).toBe(true)
    })

    it('codigo quando foi digitado', async () => {
      const fetchSpy = mockJoin()

      render(<JoinGroupModal {...defaultProps} />)
      await userEvent.type(screen.getByRole('textbox'), 'ABCD-EF23')
      await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

      await waitFor(() => expect(sentMethod(fetchSpy)).toBe('codigo'))
    })

    it('codigo quando a pessoa troca o código que veio no link', async () => {
      const fetchSpy = mockJoin()

      render(<JoinGroupModal {...defaultProps} initialCode="ABCD-EF23" />)
      await userEvent.clear(screen.getByRole('textbox'))
      await userEvent.type(screen.getByRole('textbox'), 'WXYZ-2345')
      await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

      await waitFor(() => expect(sentMethod(fetchSpy)).toBe('codigo'))
    })
  })

  it('does not track join_group when the API refuses the code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Código de convite inválido' }),
    } as Response)

    render(<JoinGroupModal {...defaultProps} initialCode="ABCD-EF23" />)
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }))

    await screen.findByText('Código de convite inválido')
    expect(mockTrackEvent).not.toHaveBeenCalledWith('join_group', expect.anything())
  })

  describe('autoSubmit', () => {
    function mockJoin(body: unknown, ok = true) {
      return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok,
        json: async () => body,
      } as Response)
    }

    it('envia o código uma vez ao abrir, mesmo em StrictMode', async () => {
      rememberInviteDocument('/convite/ABCD-EF23')
      const group = { id: 'g1', name: 'Realidade do BR' }
      const fetchSpy = mockJoin({ group })

      render(
        <StrictMode>
          <JoinGroupModal {...defaultProps} initialCode="abcd-ef23" autoSubmit />
        </StrictMode>,
      )

      await waitFor(() => expect(defaultProps.onJoined).toHaveBeenCalledWith(group))
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
        invite_code: 'ABCD-EF23',
        entry_method: 'convite_link',
      })
      expect(mockTrackEvent).toHaveBeenCalledWith('join_group', {
        entry_method: 'convite_link',
      })
    })

    it('espera o modal abrir', async () => {
      const fetchSpy = mockJoin({ group: { id: 'g1', name: 'G' } })
      const props = { ...defaultProps, initialCode: 'ABCD-EF23', autoSubmit: true }

      const { rerender } = render(<JoinGroupModal {...props} isOpen={false} />)
      expect(fetchSpy).not.toHaveBeenCalled()

      rerender(<JoinGroupModal {...props} isOpen />)
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    })

    it('mostra o erro da API e não reenvia sozinho', async () => {
      const fetchSpy = mockJoin({ error: 'Este grupo atingiu o limite de membros' }, false)

      render(<JoinGroupModal {...defaultProps} initialCode="ABCD-EF23" autoSubmit />)

      await screen.findByText('Este grupo atingiu o limite de membros')
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(defaultProps.onJoined).not.toHaveBeenCalled()
    })

    it('sem autoSubmit espera o toque', () => {
      const fetchSpy = mockJoin({ group: { id: 'g1', name: 'G' } })

      render(<JoinGroupModal {...defaultProps} initialCode="ABCD-EF23" />)

      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
