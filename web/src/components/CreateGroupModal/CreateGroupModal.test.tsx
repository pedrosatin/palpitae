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
      expect(
        screen.getByRole('option', { name: /Copa 2026/ }),
      ).toBeInTheDocument()
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
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('Network error'),
    )

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))

    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Grupo X')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await waitFor(() => {
      expect(
        screen.getByText('Erro de conexão. Tente novamente.'),
      ).toBeInTheDocument()
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
      json: async () => ({ group: { id: 'g1', name: 'Os Craques', invite_code: 'INV123' } }),
    } as Response)

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Os Craques')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await waitFor(() => screen.getByText('Grupo criado!'))
    expect(mockTrackEvent).toHaveBeenCalledWith('submit_criar_grupo')
  })

  it('fires click_criar_grupo_copiar_codigo when Copiar is clicked after creation', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    mockFetchCompetitions()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: { id: 'g1', name: 'Os Craques', invite_code: 'INV123' } }),
    } as Response)

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Os Craques')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))
    await waitFor(() => screen.getByText('Grupo criado!'))

    await userEvent.click(screen.getByRole('button', { name: /^Copiar$/ }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_criar_grupo_copiar_codigo')
  })

  it('fires click_criar_grupo_copiar_link when Copiar link is clicked after creation', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    mockFetchCompetitions()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: { id: 'g1', name: 'Os Craques', invite_code: 'INV123' } }),
    } as Response)

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Os Craques')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))
    await waitFor(() => screen.getByText('Grupo criado!'))

    await userEvent.click(screen.getByRole('button', { name: /Copiar link/ }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_criar_grupo_copiar_link')
  })
})
