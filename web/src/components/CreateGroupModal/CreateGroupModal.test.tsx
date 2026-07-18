import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import CreateGroupModal from './CreateGroupModal'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

const competitions = [
  {
    id: 'c1',
    name: 'Copa 2026',
    slug: 'copa-2026',
    season: '2026',
    status: 'upcoming',
  },
]

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onCreated: vi.fn(),
}

function mockFetchCompetitions() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: async () => ({ competitions }),
  } as Response)
}

describe('CreateGroupModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    defaultProps.onClose.mockClear()
    defaultProps.onCreated.mockClear()
  })

  it('does not render when isOpen is false', () => {
    render(<CreateGroupModal {...defaultProps} isOpen={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the form when open', async () => {
    mockFetchCompetitions()
    render(<CreateGroupModal {...defaultProps} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome do grupo')).toBeInTheDocument()
  })

  it('loads and displays competitions', async () => {
    mockFetchCompetitions()
    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Copa 2026/ })).toBeInTheDocument()
    })
  })

  it('calls onCreated and shows success screen on successful submission', async () => {
    mockFetchCompetitions()
    const createdGroup = { id: 'g1', name: 'Os Craques', invite_code: 'INV123' }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: createdGroup }),
    } as Response)

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))

    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Os Craques')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await waitFor(() => {
      expect(defaultProps.onCreated).toHaveBeenCalledWith(createdGroup)
      expect(screen.getByText('Grupo criado!')).toBeInTheDocument()
      expect(screen.getByText('INV123')).toBeInTheDocument()
    })
  })

  it('shows error message on API failure', async () => {
    mockFetchCompetitions()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Nome já em uso' }),
    } as Response)

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))

    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Grupo X')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await waitFor(() => {
      expect(screen.getByText('Nome já em uso')).toBeInTheDocument()
    })
  })

  it('shows connection error on fetch failure', async () => {
    mockFetchCompetitions()
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))

    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Grupo X')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await waitFor(() => {
      expect(screen.getByText('Erro de conexão. Tente novamente.')).toBeInTheDocument()
    })
  })
})

describe('CreateGroupModal – analytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
    defaultProps.onClose.mockClear()
    defaultProps.onCreated.mockClear()
  })

  it('fires submit_criar_grupo when the group is created successfully', async () => {
    mockFetchCompetitions()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: { id: 'g1', name: 'Os Craques', invite_code: 'INV123' },
      }),
    } as Response)

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Os Craques')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await waitFor(() => screen.getByText('Grupo criado!'))
    expect(mockTrackEvent).toHaveBeenCalledWith('submit_criar_grupo')
  })

  it('fires click_create_group_copiar_codigo when Copiar is clicked after creation', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    mockFetchCompetitions()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: { id: 'g1', name: 'Os Craques', invite_code: 'INV123' },
      }),
    } as Response)

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Os Craques')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))
    await waitFor(() => screen.getByText('Grupo criado!'))

    await userEvent.click(screen.getByRole('button', { name: /^Copiar$/ }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_create_group_copiar_codigo')
  })

  it('fires click_create_group_copiar_link when Copiar link is clicked after creation', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    mockFetchCompetitions()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: { id: 'g1', name: 'Os Craques', invite_code: 'INV123' },
      }),
    } as Response)

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Os Craques')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))
    await waitFor(() => screen.getByText('Grupo criado!'))

    await userEvent.click(screen.getByRole('button', { name: /Copiar link/ }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_create_group_copiar_link')
  })

  it('fires preset and visibility analytics on selection', async () => {
    mockFetchCompetitions()
    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))

    await userEvent.click(screen.getByRole('button', { name: 'Personalizado' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_create_group_preset_selecionado', {
      preset: 'custom',
    })

    await userEvent.click(screen.getByRole('button', { name: /Sempre visível/ }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_create_group_visibilidade_publica')

    await userEvent.click(screen.getByRole('button', { name: /Oculto até palpitar/ }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_create_group_visibilidade_oculta')
  })
})

describe('CreateGroupModal – scoring config', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
    defaultProps.onClose.mockClear()
    defaultProps.onCreated.mockClear()
  })

  it('sends classic 3/1 hidden by default in the POST body', async () => {
    mockFetchCompetitions()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: { id: 'g1', name: 'X', invite_code: 'INV' },
      }),
    } as Response)

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Grupo')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
    const body = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string)
    expect(body.points_exact).toBe(3)
    expect(body.points_winner).toBe(1)
    expect(body.predictions_visibility).toBe('hidden')
  })

  it('toggles the scoring help text on tap (works without hover) and tracks it', async () => {
    mockFetchCompetitions()
    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))

    const infoBtn = screen.getByRole('button', { name: 'Vencedor' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await userEvent.click(infoBtn)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/empate/i)
    expect(mockTrackEvent).toHaveBeenCalledWith('click_create_group_ajuda_pontuacao', {
      campo: 'winner',
    })

    // tapping again closes it
    await userEvent.click(infoBtn)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('keeps points inputs disabled unless "Personalizado" is selected', async () => {
    mockFetchCompetitions()
    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))

    expect(screen.getByLabelText(/placar exato/i, { selector: 'input' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Personalizado' }))
    expect(screen.getByLabelText(/placar exato/i, { selector: 'input' })).toBeEnabled()
  })

  it('"Só vencedor" preset sets points to 0/1 (1X2 mode)', async () => {
    mockFetchCompetitions()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: { id: 'g1', name: 'X', invite_code: 'INV' },
      }),
    } as Response)

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Grupo')
    await userEvent.click(screen.getByRole('button', { name: 'Só vencedor' }))
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
    const body = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string)
    expect(body.points_exact).toBe(0)
    expect(body.points_winner).toBe(1)
  })

  it('blocks submit when custom points_exact < points_winner', async () => {
    mockFetchCompetitions()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Grupo')
    await userEvent.click(screen.getByRole('button', { name: 'Personalizado' }))

    const exact = screen.getByLabelText(/placar exato/i, { selector: 'input' })
    const winner = screen.getByLabelText(/vencedor/i, { selector: 'input' })
    await userEvent.clear(exact)
    await userEvent.type(exact, '1')
    await userEvent.clear(winner)
    await userEvent.type(winner, '3')

    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    expect(screen.getByText(/maior ou igual a pontos por vencedor/)).toBeInTheDocument()
    // only the competitions fetch ran — no POST
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
