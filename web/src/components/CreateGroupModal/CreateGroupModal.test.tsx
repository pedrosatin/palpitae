import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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

  it('hides finished competitions and groups ongoing ones first', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        competitions: [
          { ...competitions[0], id: 'copa-do-mundo', name: 'Copa do Mundo', status: 'finished' },
          { id: 'brasileirao', name: 'Brasileirão', status: 'ongoing' },
          { id: 'nordeste', name: 'Copa do Nordeste', status: 'upcoming' },
        ],
      }),
    } as Response)

    render(<CreateGroupModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Brasileirão/ })).toBeInTheDocument()
    })

    // Copa do Mundo encerrada não entra no select.
    expect(screen.queryByRole('option', { name: /Copa do Mundo/ })).not.toBeInTheDocument()

    // Com os dois grupos presentes, os <optgroup> separam andamento e futuro.
    expect(screen.getByRole('group', { name: 'Em andamento' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Em breve' })).toBeInTheDocument()
    expect(screen.getByText('Esse campeonato já começou — dá para criar o grupo e palpitar as rodadas que faltam.')).toBeInTheDocument()
  })

  it('renders a flat list when there is only one status', async () => {
    mockFetchCompetitions()
    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Copa 2026/ })).toBeInTheDocument()
    })
    expect(screen.queryByRole('group', { name: 'Em breve' })).not.toBeInTheDocument()
  })

  it('renders a flat list when every competition is ongoing (no trailing group)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        competitions: [
          { id: 'a', name: 'Brasileirão', status: 'ongoing' },
          { id: 'b', name: 'Liga dos Campeões', status: 'ongoing' },
        ],
      }),
    } as Response)
    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Liga dos Campeões/ })).toBeInTheDocument()
    })
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(screen.getByText(/já começou/)).toBeInTheDocument()
  })

  it('orders the Em andamento group before Em breve', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        competitions: [
          { id: 'z', name: 'Zebra Cup', status: 'upcoming' },
          { id: 'a', name: 'A Liga', status: 'ongoing' },
        ],
      }),
    } as Response)
    render(<CreateGroupModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Zebra Cup/ })).toBeInTheDocument()
    })
    // Ordem do DOM: "Em andamento" precede "Em breve", mesmo com o nome vindo depois.
    expect(
      screen.getAllByRole('group').map((group) => group.getAttribute('label')),
    ).toEqual(['Em andamento', 'Em breve'])
  })

  it('announces the ongoing hint to screen readers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        competitions: [{ id: 'a', name: 'Brasileirão', status: 'ongoing' }],
      }),
    } as Response)
    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/já começou/)
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

  it('mostra a mensagem do 409 de teto de grupos e mantém o formulário preenchido', async () => {
    mockFetchCompetitions()
    const capError = 'Você já tem 20 grupos criados. Exclua um para criar outro.'
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ error: capError }, { status: 409 }),
    )

    render(<CreateGroupModal {...defaultProps} />)
    await waitFor(() => screen.getByLabelText('Nome do grupo'))

    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Grupo 21')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    expect(await screen.findByText(capError)).toBeInTheDocument()
    expect(screen.queryByText('Grupo criado!')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Nome do grupo')).toHaveValue('Grupo 21')
    expect(screen.getByRole('button', { name: /criar/i })).toBeEnabled()
    expect(defaultProps.onCreated).not.toHaveBeenCalled()
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

describe('CreateGroupModal com a competição pedida pelo link', () => {
  const serieA2026 = {
    id: 'bsa-2026',
    name: 'Campeonato Brasileiro Série A',
    slug: 'campeonato-brasileiro-serie-a-2026',
    season: '2026',
    status: 'ongoing',
  }
  const serieA2027 = {
    id: 'bsa-2027',
    name: 'Campeonato Brasileiro Série A',
    slug: 'campeonato-brasileiro-serie-a-2027',
    season: '2027',
    status: 'upcoming',
  }
  const slug2027 = serieA2027.slug
  const warning = 'A competição do link ainda não está disponível. Escolha outra na lista.'

  beforeEach(() => {
    vi.restoreAllMocks()
    defaultProps.onClose.mockClear()
  })

  function mockList(list: unknown[]) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ competitions: list }),
    } as Response)
  }

  /** Imita o painel. A competição do link vale até o modal fechar. */
  function Host({ initialSlug }: { initialSlug?: string }) {
    const [open, setOpen] = useState(true)
    const [slug, setSlug] = useState(initialSlug)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Abrir de novo
        </button>
        <CreateGroupModal
          isOpen={open}
          onClose={() => {
            setOpen(false)
            setSlug(undefined)
          }}
          onCreated={vi.fn()}
          preferredCompetitionSlug={slug}
        />
      </>
    )
  }

  it('abre com a competição do link escolhida, mesmo fora da primeira posição', async () => {
    mockList([serieA2026, serieA2027])
    render(<CreateGroupModal {...defaultProps} preferredCompetitionSlug={slug2027} />)

    const select = await screen.findByLabelText('Competição')
    expect(select).toHaveValue('bsa-2027')
    expect(screen.queryByText(warning)).not.toBeInTheDocument()
    expect(select).not.toHaveAttribute('aria-describedby')
  })

  it('fica na primeira e mostra o aviso junto do select quando a competição não está na lista', async () => {
    mockList([serieA2026])
    render(<CreateGroupModal {...defaultProps} preferredCompetitionSlug={slug2027} />)

    const select = await screen.findByLabelText('Competição')
    expect(select).toHaveValue('bsa-2026')
    expect(screen.getByText(warning)).toBeInTheDocument()
    // A Série A 2026 já começou, então o aviso de campeonato em andamento também descreve o select.
    expect(select).toHaveAccessibleDescription(expect.stringContaining(warning))
    expect(select).toHaveAccessibleDescription(expect.stringContaining('Esse campeonato já começou'))
  })

  it('descreve o select só pelo aviso de campeonato em andamento quando não há competição pedida', async () => {
    mockList([serieA2026])
    render(<CreateGroupModal {...defaultProps} />)

    const select = await screen.findByLabelText('Competição')
    expect(select).toHaveAttribute('aria-describedby', 'group-competition-ongoing')
    expect(select).toHaveAccessibleDescription(expect.stringContaining('Esse campeonato já começou'))
  })

  it('tira o aviso de campeonato em andamento da descrição ao trocar para uma competição em breve', async () => {
    const premier2027 = {
      id: 'pl-2027',
      name: 'Premier League',
      slug: 'premier-league-2027',
      season: '2027',
      status: 'upcoming',
    }
    mockList([serieA2026, premier2027])
    render(<CreateGroupModal {...defaultProps} preferredCompetitionSlug={slug2027} />)

    const select = await screen.findByLabelText('Competição')
    expect(select).toHaveAttribute(
      'aria-describedby',
      'group-competition-unavailable group-competition-ongoing',
    )

    await userEvent.selectOptions(select, 'pl-2027')

    expect(select).toHaveAttribute('aria-describedby', 'group-competition-unavailable')
    expect(screen.queryByText(/Esse campeonato já começou/)).not.toBeInTheDocument()
  })

  it('não mostra o aviso de competição indisponível sem competição pedida', async () => {
    mockList([serieA2026])
    render(<CreateGroupModal {...defaultProps} />)

    expect(await screen.findByLabelText('Competição')).toHaveValue('bsa-2026')
    expect(screen.queryByText(warning)).not.toBeInTheDocument()
  })

  it('não mostra aviso quando nenhuma competição está disponível', async () => {
    mockList([])
    render(<CreateGroupModal {...defaultProps} preferredCompetitionSlug={slug2027} />)

    expect(await screen.findByText('Nenhuma competição disponível no momento.')).toBeInTheDocument()
    expect(screen.queryByText(warning)).not.toBeInTheDocument()
  })

  it.each([
    ['presente', [serieA2026, serieA2027]],
    ['ausente', [serieA2026]],
  ])(
    'com a competição %s na lista, fechar e reabrir volta ao padrão sem aviso',
    async (_caso, list) => {
      mockList(list)
      render(<Host initialSlug={slug2027} />)
      await screen.findByLabelText('Competição')

      await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Abrir de novo' }))

      expect(await screen.findByLabelText('Competição')).toHaveValue('bsa-2026')
      expect(screen.queryByText(warning)).not.toBeInTheDocument()
    },
  )
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

    await userEvent.click(screen.getByRole('button', { name: /Oculto até o jogo começar/ }))
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

describe('CreateGroupModal – cada abertura tem o próprio envio', () => {
  const createdGroup = { id: 'g1', name: 'Primeiro', invite_code: 'INV123' }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  /** Imita o painel: o botão reabre o modal depois de fechado. */
  function Host({ onCreated }: { onCreated: (group: unknown) => void }) {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Abrir de novo
        </button>
        <CreateGroupModal isOpen={open} onClose={() => setOpen(false)} onCreated={onCreated} />
      </>
    )
  }

  /** Lista de competições e um POST /groups que só responde quando o teste mandar. */
  function mockPendingPost() {
    let respond!: (response: Response) => void
    let fail!: (err: Error) => void
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ competitions }) } as Response)
      .mockReturnValueOnce(
        new Promise<Response>((resolve, reject) => {
          respond = resolve
          fail = reject
        }),
      )
    return { fetchSpy, respond: (r: Response) => respond(r), fail: (e: Error) => fail(e) }
  }

  async function submitThenCloseAndReopen() {
    await waitFor(() => screen.getByRole('option', { name: /Copa 2026/ }))
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Primeiro')
    await userEvent.click(screen.getByRole('button', { name: 'Criar grupo' }))
    expect(screen.getByRole('button', { name: 'Criando...' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Abrir de novo' }))
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Segundo')
  }

  it('sucesso de um envio antigo não troca o formulário reaberto pela tela de pronto', async () => {
    const onCreated = vi.fn()
    const post = mockPendingPost()
    render(<Host onCreated={onCreated} />)

    await submitThenCloseAndReopen()
    await act(async () => {
      post.respond({ ok: true, json: async () => ({ group: createdGroup }) } as Response)
    })

    // O grupo foi criado: o painel atualiza a lista mesmo com o modal reaberto.
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdGroup))
    expect(screen.queryByText('Grupo criado!')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Nome do grupo')).toHaveValue('Segundo')
    expect(screen.getByRole('button', { name: 'Criar grupo' })).toBeEnabled()
  })

  it('falha de um envio antigo não aparece no formulário reaberto', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onCreated = vi.fn()
    const post = mockPendingPost()
    render(<Host onCreated={onCreated} />)

    await submitThenCloseAndReopen()
    await act(async () => {
      post.fail(new Error('Network offline'))
    })

    expect(screen.queryByText('Erro de conexão. Tente novamente.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Nome do grupo')).toHaveValue('Segundo')
    expect(screen.getByRole('button', { name: 'Criar grupo' })).toBeEnabled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('segundo envio antes da resposta não cria outro grupo', async () => {
    const onCreated = vi.fn()
    const post = mockPendingPost()
    render(<Host onCreated={onCreated} />)

    await waitFor(() => screen.getByRole('option', { name: /Copa 2026/ }))
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Primeiro')
    const form = screen.getByLabelText('Nome do grupo').closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)

    await act(async () => {
      post.respond({ ok: true, json: async () => ({ group: createdGroup }) } as Response)
    })

    await waitFor(() => expect(screen.getByText('Grupo criado!')).toBeInTheDocument())
    const posts = post.fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('depois de uma falha, tenta de novo com os mesmos valores', async () => {
    const onCreated = vi.fn()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ competitions }) } as Response)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Falhou' }), { status: 500 }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ group: createdGroup }) } as Response)
    render(<Host onCreated={onCreated} />)

    await waitFor(() => screen.getByRole('option', { name: /Copa 2026/ }))
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Primeiro')
    await userEvent.click(screen.getByRole('button', { name: 'Só vencedor' }))
    await userEvent.click(screen.getByRole('button', { name: 'Criar grupo' }))

    expect(await screen.findByText('Falhou')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome do grupo')).toHaveValue('Primeiro')

    await userEvent.click(screen.getByRole('button', { name: 'Criar grupo' }))
    await waitFor(() => expect(screen.getByText('Grupo criado!')).toBeInTheDocument())

    const bodies = fetchSpy.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init!.body)))
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual(bodies[0])
    expect(bodies[1]).toMatchObject({ name: 'Primeiro', points_exact: 0, points_winner: 1 })
    expect(onCreated).toHaveBeenCalledTimes(1)
  })
})
