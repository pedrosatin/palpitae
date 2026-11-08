import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import LeaderboardTab from './LeaderboardTab'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

const members = [
  {
    user_id: 'u1',
    display_name: 'Pedro',
    avatar_url: null,
    role: 'owner',
    joined_at: '2026-01-01T00:00:00Z',
    total_points: 20,
    exact_hits: 3,
  },
  {
    user_id: 'u2',
    display_name: 'Ana',
    avatar_url: null,
    role: 'member',
    joined_at: '2026-01-02T00:00:00Z',
    total_points: 10,
    exact_hits: 1,
  },
]

type RoundStandingsBody = {
  round: string | null
  standings: { user_id: string; round_points: number; position_change: number | null }[]
}

const noRound: RoundStandingsBody = { round: null, standings: [] }

function mockFetch(roundStandings: RoundStandingsBody | Error | Promise<Response> = noRound) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()
    if (u.includes('/predictions/user')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ predictions: [] }),
      } as Response)
    }
    if (u.includes('/round-standings')) {
      if (roundStandings instanceof Promise) return roundStandings
      if (roundStandings instanceof Error) return Promise.reject(roundStandings)
      return Promise.resolve({
        ok: true,
        json: async () => roundStandings,
      } as Response)
    }
    if (u.includes('/members')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ members }),
      } as Response)
    }
    return Promise.reject(new Error(`Unexpected fetch: ${u}`))
  })
}

describe('LeaderboardTab header and badges', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('names the numeric columns in full for screen readers, with short visible labels', async () => {
    mockFetch()
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    const exact = screen.getByRole('columnheader', { name: 'Placares exatos' })
    expect(exact).not.toHaveAttribute('aria-label')
    expect(within(exact).getByText('Ex.')).toHaveAttribute('aria-hidden', 'true')
    expect(within(exact).getByText('Placares exatos')).not.toHaveAttribute('aria-hidden')
    const points = screen.getByRole('columnheader', { name: 'Pontos' })
    expect(points).not.toHaveAttribute('aria-label')
    expect(within(points).getByText('Pts')).toHaveAttribute('aria-hidden', 'true')
  })

  it('groups the admin and você badges under the member name', async () => {
    mockFetch()
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Pedro'))
    const badges = screen.getByText('admin').parentElement as HTMLElement
    expect(badges).toContainElement(screen.getByText('você'))
    expect(badges.parentElement).toContainElement(screen.getByText('Pedro'))
  })
})

describe('LeaderboardTab rodada', () => {
  const round34: RoundStandingsBody = {
    round: '34',
    standings: [
      { user_id: 'u1', round_points: 7, position_change: 2 },
      { user_id: 'u2', round_points: 0, position_change: -1 },
    ],
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function rowOf(name: string) {
    return screen.getByText(name).closest('tr') as HTMLElement
  }

  it('mostra a coluna da rodada entre Jogador e Pontos, com nome completo para leitor de tela', async () => {
    mockFetch(round34)
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers[1]).toBe('Jogador')
    expect(headers[3]).toContain('Pontos')

    const column = screen.getByRole('columnheader', { name: 'Pontos na rodada 34' })
    expect(within(column).getByText('Rodada 34')).toHaveAttribute('aria-hidden', 'true')
    expect(within(column).getByText('R34')).toHaveAttribute('aria-hidden', 'true')
    expect(within(column).getByText('Pontos na rodada 34')).not.toHaveAttribute('aria-hidden')
  })

  it('mostra +N para pontos positivos e 0 para zero', async () => {
    mockFetch(round34)
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    expect(within(rowOf('Pedro')).getByText('+7')).toBeInTheDocument()
    expect(within(rowOf('Ana')).getByText('0')).toBeInTheDocument()
  })

  it('mostra traço para membro sem linha na resposta', async () => {
    mockFetch({
      round: '34',
      standings: [{ user_id: 'u1', round_points: 7, position_change: 0 }],
    })
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    expect(within(rowOf('Ana')).getByText('–')).toBeInTheDocument()
  })

  it('mostra as setas com a variação em texto para leitor de tela', async () => {
    mockFetch(round34)
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    const pedro = within(rowOf('Pedro'))
    expect(pedro.getByText('▲2')).toHaveAttribute('aria-hidden', 'true')
    expect(pedro.getByText('subiu 2 posições')).toBeInTheDocument()
    const ana = within(rowOf('Ana'))
    expect(ana.getByText('▼1')).toHaveAttribute('aria-hidden', 'true')
    expect(ana.getByText('caiu 1 posição')).toBeInTheDocument()
  })

  it('não mostra seta para variação 0 ou null', async () => {
    mockFetch({
      round: '34',
      standings: [
        { user_id: 'u1', round_points: 7, position_change: 0 },
        { user_id: 'u2', round_points: 3, position_change: null },
      ],
    })
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    expect(screen.queryByText(/[▲▼]/)).not.toBeInTheDocument()
    expect(screen.queryByText(/subiu|caiu/)).not.toBeInTheDocument()
  })

  it('não mostra a coluna nem o aviso com round null', async () => {
    mockFetch(noRound)
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    expect(screen.getAllByRole('columnheader')).toHaveLength(4)
    expect(screen.queryByText(/As setas comparam/)).not.toBeInTheDocument()
  })

  it('mostra o aviso das setas quando há ao menos uma variação', async () => {
    mockFetch(round34)
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    expect(
      screen.getByText('As setas comparam com a posição antes da rodada 34.'),
    ).toBeInTheDocument()
  })

  it('não mostra o aviso das setas na primeira rodada, em que toda variação é null', async () => {
    mockFetch({
      round: '1',
      standings: [
        { user_id: 'u1', round_points: 7, position_change: null },
        { user_id: 'u2', round_points: 3, position_change: null },
      ],
    })
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    expect(screen.getByRole('columnheader', { name: 'Pontos na rodada 1' })).toBeInTheDocument()
    expect(screen.queryByText(/As setas comparam/)).not.toBeInTheDocument()
  })

  it('segue sem erro de tela e sem coluna quando o endpoint da rodada falha', async () => {
    mockFetch(new Error('falhou'))
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    expect(screen.getAllByRole('columnheader')).toHaveLength(4)
    expect(screen.queryByText(/[▲▼]/)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('só desenha a tabela depois da resposta da rodada', async () => {
    let finish: (r: Response) => void = () => {}
    mockFetch(new Promise<Response>((resolve) => (finish = resolve)))
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch).mock.calls.map((c) => c[0].toString())).toEqual(
        expect.arrayContaining([expect.stringContaining('/members')]),
      ),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText('Ana')).not.toBeInTheDocument()
    expect(screen.getByText('Carregando classificação...')).toBeInTheDocument()

    finish({ ok: true, json: async () => round34 } as Response)

    await waitFor(() => screen.getByText('Ana'))
    expect(screen.getByRole('columnheader', { name: 'Pontos na rodada 34' })).toBeInTheDocument()
  })

  it('mostra o erro assim que a lista de membros falha, sem esperar a rodada', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (url.toString().includes('/round-standings')) return new Promise<Response>(() => {})
      return Promise.resolve({ ok: false, json: async () => ({}) } as Response)
    })
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Erro ao carregar membros'))
  })
})

describe('LeaderboardTab – analytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  it('fires click_leaderboard_ver_palpites when a member row is clicked', async () => {
    mockFetch()
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    await userEvent.click(screen.getByText('Ana'))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_leaderboard_ver_palpites')
  })
})

describe('LeaderboardTab regras', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('mostra o desempate sob a tabela e abre as regras pelo link', async () => {
    mockFetch()
    const onOpenRules = vi.fn()
    render(
      <LeaderboardTab
        groupId="g1"
        currentUserId="u1"
        tiebreakNote="Ordem do ranking: mais pontos."
        onOpenRules={onOpenRules}
      />,
    )

    await waitFor(() => screen.getByText('Ana'))
    expect(screen.getByText('Ordem do ranking: mais pontos.')).toBeInTheDocument()

    const link = screen.getByRole('button', { name: 'Como pontua' })
    await userEvent.click(link)

    expect(onOpenRules).toHaveBeenCalledOnce()
  })

  it('não mostra a linha de regras sem as props', async () => {
    mockFetch()
    render(<LeaderboardTab groupId="g1" currentUserId="u1" />)

    await waitFor(() => screen.getByText('Ana'))
    expect(screen.queryByRole('button', { name: 'Como pontua' })).not.toBeInTheDocument()
  })
})
