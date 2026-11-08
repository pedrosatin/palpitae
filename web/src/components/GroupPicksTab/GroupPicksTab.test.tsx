import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import { invalidateApiCache } from '../../lib/api-cache'
import GroupPicksTab from './GroupPicksTab'
import { makeMatch } from '../matchFixtures'
import { type Match } from '../MatchCard'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

beforeEach(() => invalidateApiCache())

interface GroupPicksResponse {
  self_user_id: string
  members: Array<{ user_id: string; display: string }>
  predictions: Array<Record<string, unknown>>
}

function mockFetch(matches: Match[], picks: GroupPicksResponse) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()
    if (u.includes('/matches')) {
      const nowIso = new Date().toISOString()
      const roundMaxStart = new Map<string, string>()
      for (const m of matches) {
        const cur = roundMaxStart.get(m.round)
        if (!cur || m.start_time > cur) roundMaxStart.set(m.round, m.start_time)
      }
      const activeRound = [...roundMaxStart.entries()]
        .filter(([, max]) => max > nowIso)
        .sort(([, a], [, b]) => (a < b ? -1 : 1))[0]
      const chronologicalLast = matches.reduce<Match | undefined>(
        (acc, m) => (!acc || m.start_time >= acc.start_time ? m : acc),
        undefined,
      )
      const default_round = activeRound?.[0] ?? chronologicalLast?.round ?? null
      return Promise.resolve({
        ok: true,
        json: async () => ({ matches, default_round }),
      } as Response)
    }
    if (u.includes('/predictions/group')) {
      return Promise.resolve({
        ok: true,
        json: async () => picks,
      } as Response)
    }
    return Promise.reject(new Error(`Unexpected fetch: ${u}`))
  })
}

describe('GroupPicksTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows each member prediction for a revealed match, flagging the current user', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: [
        { user_id: 'user-1', display: 'Pedro' },
        { user_id: 'user-2', display: 'Ana' },
      ],
      predictions: [
        {
          match_id: 'm1',
          user_id: 'user-1',
          user_display: 'Pedro',
          predicted_home_score: 2,
          predicted_away_score: 1,
          points_awarded: 0,
          locked: 0,
        },
        {
          match_id: 'm1',
          user_id: 'user-2',
          user_display: 'Ana',
          predicted_home_score: 0,
          predicted_away_score: 0,
          points_awarded: 0,
          locked: 0,
        },
      ],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('Pedro')).toBeInTheDocument()
    })
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('(você)')).toBeInTheDocument()
    expect(screen.getByText('Pedro').closest('li')).toHaveTextContent('2 × 1')
    expect(screen.getByText('Ana').closest('li')).toHaveTextContent('0 × 0')
  })

  it('hides predictions for a match the user has not predicted yet', async () => {
    const matches = [makeMatch({ id: 'm2', round: '1', status: 'scheduled' })]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: [{ user_id: 'user-1', display: 'Pedro' }],
      predictions: [], // user-1 has not predicted m2 → nothing revealed
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(
        screen.getByText(/palpites dos outros membros aparecem quando o jogo começar/i),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('(você)')).not.toBeInTheDocument()
  })

  it('shows the penalty-winner pick for a draw in a knockout match', async () => {
    const matches = [
      makeMatch({
        id: 'm1',
        round: '1',
        status: 'scheduled',
        decides_on_penalties: true,
      }),
    ]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: [
        { user_id: 'user-1', display: 'Pedro' },
        { user_id: 'user-2', display: 'Ana' },
      ],
      predictions: [
        {
          match_id: 'm1',
          user_id: 'user-1',
          user_display: 'Pedro',
          predicted_home_score: 1,
          predicted_away_score: 1,
          predicted_penalty_winner: 'home',
          points_awarded: 0,
          penalty_points: 0,
          locked: 0,
        },
        {
          match_id: 'm1',
          user_id: 'user-2',
          user_display: 'Ana',
          predicted_home_score: 1,
          predicted_away_score: 1,
          predicted_penalty_winner: 'away',
          points_awarded: 0,
          penalty_points: 0,
          locked: 0,
        },
      ],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('Pedro')).toBeInTheDocument()
    })
    // Same 1×1 score, told apart only by who each backed in the shootout.
    expect(screen.getByText('Pedro').closest('li')).toHaveTextContent('BRA')
    expect(screen.getByText('Ana').closest('li')).toHaveTextContent('ARG')
  })

  it('omits the penalty pick when the draw is not in a knockout', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: [{ user_id: 'user-1', display: 'Pedro' }],
      predictions: [
        {
          match_id: 'm1',
          user_id: 'user-1',
          user_display: 'Pedro',
          predicted_home_score: 1,
          predicted_away_score: 1,
          predicted_penalty_winner: null,
          points_awarded: 0,
          penalty_points: 0,
          locked: 0,
        },
      ],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('Pedro')).toBeInTheDocument()
    })
    const li = screen.getByText('Pedro').closest('li') as HTMLElement
    expect(within(li).queryByLabelText(/pênaltis/i)).not.toBeInTheDocument()
  })

  it('folds penalty and classified bonuses into the displayed points total', async () => {
    const matches = [
      makeMatch({
        id: 'm1',
        round: '1',
        status: 'finished',
        home_score: 1,
        away_score: 1,
        decides_on_penalties: true,
      }),
    ]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: [{ user_id: 'user-1', display: 'Pedro' }],
      predictions: [
        {
          match_id: 'm1',
          user_id: 'user-1',
          user_display: 'Pedro',
          predicted_home_score: 1,
          predicted_away_score: 1,
          predicted_penalty_winner: 'home',
          points_awarded: 3,
          penalty_points: 1,
          classified_points: 2,
          predicted_classified: 'away',
          locked: 1,
        },
      ],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('6 pt')).toBeInTheDocument()
      expect(screen.getByText(/classificado: ARG/)).toBeInTheDocument()
    })
  })

  it('shows awarded points for a finished match', async () => {
    const matches = [
      makeMatch({
        id: 'm1',
        round: '1',
        status: 'finished',
        home_score: 2,
        away_score: 1,
      }),
    ]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: [{ user_id: 'user-1', display: 'Pedro' }],
      predictions: [
        {
          match_id: 'm1',
          user_id: 'user-1',
          user_display: 'Pedro',
          predicted_home_score: 2,
          predicted_away_score: 1,
          points_awarded: 3,
          locked: 1,
        },
      ],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('3 pt')).toBeInTheDocument()
    })
  })
})

describe('GroupPicksTab member list', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const roster = [
    { user_id: 'user-1', display: 'Pedro' },
    { user_id: 'user-2', display: 'Isabelly' },
    { user_id: 'user-3', display: 'Bruno' },
    { user_id: 'user-4', display: 'Carla' },
  ]

  function pick(userId: string, display: string, extra: Record<string, unknown> = {}) {
    return {
      match_id: 'm1',
      user_id: userId,
      user_display: display,
      predicted_home_score: 1,
      predicted_away_score: 0,
      points_awarded: 0,
      locked: 1,
      ...extra,
    }
  }

  it('lists every member in a finished match, with 0 pt for members who did not predict', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'finished', home_score: 1, away_score: 0 }),
    ]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: roster,
      predictions: [
        pick('user-1', 'Pedro', { points_awarded: 5 }),
        pick('user-2', 'Isabelly', { points_awarded: 5 }),
      ],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(4)
    })
    expect(screen.getByText('Pedro').closest('li')).toHaveTextContent('5 pt')
    expect(screen.getByText('Isabelly').closest('li')).toHaveTextContent('1 × 0')
    for (const name of ['Bruno', 'Carla']) {
      const li = screen.getByText(name).closest('li') as HTMLElement
      expect(within(li).getByText('sem palpite')).toBeInTheDocument()
      expect(li).toHaveTextContent('0 pt')
    }
    expect(screen.queryByText(/aparecem quando o jogo começar/i)).not.toBeInTheDocument()
  })

  it('lists every member in a live match, without points yet', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'live' })]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: roster,
      predictions: [pick('user-2', 'Isabelly')],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(4)
    })
    expect(screen.getAllByText('sem palpite')).toHaveLength(3)
    // O próprio usuário sem palpite continua marcado como "(você)".
    expect(screen.getByText('Pedro').closest('li')).toHaveTextContent('(você)')
    expect(screen.queryByText(/\d+ pt/)).not.toBeInTheDocument()
  })

  it("shows only the user's own pick before kickoff in a hidden group", async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: roster,
      predictions: [pick('user-1', 'Pedro', { locked: 0 })],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" predictionsVisibility="hidden" />)

    await waitFor(() => {
      expect(screen.getByText('Pedro')).toBeInTheDocument()
    })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText('Isabelly')).not.toBeInTheDocument()
    expect(screen.queryByText('sem palpite')).not.toBeInTheDocument()
    expect(
      screen.getByText(/palpites dos outros membros aparecem quando o jogo começar/i),
    ).toBeInTheDocument()
  })

  it("shows only the user's own pick when the local clock is past kickoff but the API answered before the lock", async () => {
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString()
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'scheduled', start_time: oneMinuteAgo }),
    ]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: roster,
      predictions: [pick('user-1', 'Pedro', { locked: 0 })],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" predictionsVisibility="hidden" />)

    await waitFor(() => {
      expect(screen.getByText('Pedro')).toBeInTheDocument()
    })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText('Isabelly')).not.toBeInTheDocument()
    expect(screen.queryByText('sem palpite')).not.toBeInTheDocument()
    expect(screen.queryByText(/aparecem quando o jogo começar/i)).not.toBeInTheDocument()
  })

  it('lists every member when the API already locked the picks but the local clock is behind', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: roster,
      predictions: [pick('user-2', 'Isabelly', { locked: 1 })],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" predictionsVisibility="hidden" />)

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(4)
    })
    expect(screen.getByText('Isabelly').closest('li')).toHaveTextContent('1 × 0')
    expect(screen.getAllByText('sem palpite')).toHaveLength(3)
    expect(screen.queryByText(/aparecem quando o jogo começar/i)).not.toBeInTheDocument()
  })

  it('lists every member before kickoff in an always-visible group', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: roster,
      predictions: [pick('user-2', 'Isabelly', { locked: 0 })],
    })

    render(<GroupPicksTab groupId="g1" competitionId="c1" predictionsVisibility="public" />)

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(4)
    })
    expect(screen.getByText('Isabelly').closest('li')).toHaveTextContent('1 × 0')
    expect(screen.getAllByText('sem palpite')).toHaveLength(3)
    expect(screen.queryByText(/aparecem quando o jogo começar/i)).not.toBeInTheDocument()
  })
})

describe('GroupPicksTab quem já palpitou', () => {
  // 14/11/2026 é sábado. Em Brasília o jogo começa às 18:30.
  const NOW = '2026-11-10T12:00:00.000Z'
  const KICKOFF = '2026-11-14T21:30:00.000Z'

  const roster = [
    { user_id: 'user-1', display: 'Pedro' },
    { user_id: 'user-2', display: 'Ana Lima' },
    { user_id: 'user-3', display: 'Bruno' },
    { user_id: 'user-4', display: 'Carla' },
  ]

  function ownPick(extra: Record<string, unknown> = {}) {
    return {
      match_id: 'm1',
      user_id: 'user-1',
      user_display: 'Pedro',
      predicted_home_score: 2,
      predicted_away_score: 1,
      points_awarded: 0,
      locked: 0,
      ...extra,
    }
  }

  function renderHidden(
    pickers: Record<string, string[]> | undefined,
    predictions: Array<Record<string, unknown>> = [ownPick()],
    matches: Match[] = [makeMatch({ id: 'm1', round: '35', start_time: KICKOFF })],
  ) {
    mockFetch(matches, {
      self_user_id: 'user-1',
      members: roster,
      predictions,
      ...(pickers ? { open_pickers: pickers } : {}),
    } as GroupPicksResponse)
    render(
      <GroupPicksTab
        groupId="g1"
        competitionId="c1"
        groupName="Realidade do BR"
        predictionsVisibility="hidden"
      />,
    )
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mostra data, horário e contagem no jogo aberto, sem placar de outro membro', async () => {
    renderHidden({ m1: ['user-1', 'user-2'] })

    expect(await screen.findByText('sáb, 14/11 · 18:30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2 de 4 palpitaram/ })).toBeInTheDocument()
    // Só o próprio palpite chega como linha do card.
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Pedro').closest('li')).toHaveTextContent('2 × 1')
  })

  it('identifica quem palpitou pelas iniciais e abre os nomes no toque', async () => {
    renderHidden({ m1: ['user-1', 'user-2'] })

    const toggle = await screen.findByRole('button', { name: /2 de 4 palpitaram/ })
    expect(screen.getByText('AL')).toHaveAttribute('title', 'Ana Lima')
    expect(screen.getByText('PE')).toBeInTheDocument()
    expect(screen.queryByText('você e Ana Lima')).not.toBeInTheDocument()

    await userEvent.click(toggle)

    expect(screen.getByText('você e Ana Lima')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_picks_ver_quem_palpitou', {
      open: true,
    })
  })

  it('mostra o aviso de palpites ocultos uma vez por rodada', async () => {
    renderHidden(
      {},
      [],
      [
        makeMatch({ id: 'm1', round: '35', start_time: KICKOFF }),
        makeMatch({ id: 'm2', round: '35', start_time: KICKOFF }),
        makeMatch({ id: 'm3', round: '35', start_time: KICKOFF }),
      ],
    )

    expect(await screen.findAllByText(/aparecem quando o jogo começar/i)).toHaveLength(1)
  })

  it('lista quem falta e monta a mensagem do WhatsApp', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderHidden({ m1: ['user-1', 'user-2'] })

    expect(await screen.findByText('Faltam palpitar: Bruno e Carla')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Lembrar no WhatsApp' }))

    const text = new URL(open.mock.calls[0][0] as string).searchParams.get('text') as string
    expect(text).toBe(
      'Rodada 35 do bolão "Realidade do BR". Bruno e Carla ainda não palpitaram. ' +
        `O próximo prazo é sáb, 14/11 às 18:30. ${window.location.origin}/grupos/g1?rodada=35`,
    )
    expect(text).not.toMatch(/[—–]/)
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_picks_lembrete_whatsapp')
  })

  it('mostra o estado completo quando todo mundo palpitou', async () => {
    renderHidden({ m1: ['user-1', 'user-2', 'user-3', 'user-4'] })

    expect(await screen.findByText(/Todo mundo palpitou/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lembrar no WhatsApp' })).not.toBeInTheDocument()
  })

  it('mostra o lembrete para quem também não palpitou', async () => {
    renderHidden({ m1: ['user-2', 'user-3'] }, [])

    expect(await screen.findByText('Faltam palpitar: Carla e você')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lembrar no WhatsApp' })).toBeInTheDocument()
  })

  it('esconde o lembrete quando só falta quem está vendo', async () => {
    renderHidden({ m1: ['user-2', 'user-3', 'user-4'] }, [])

    expect(await screen.findByText('Só falta você palpitar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lembrar no WhatsApp' })).not.toBeInTheDocument()
  })

  it('não afirma quem palpitou quando a API não traz open_pickers', async () => {
    renderHidden(undefined)

    expect(await screen.findByText('sáb, 14/11 · 18:30')).toBeInTheDocument()
    expect(screen.queryByText(/palpitaram/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Faltam palpitar|Todo mundo palpitou/)).not.toBeInTheDocument()
  })

  it('mostra "data a definir" no jogo adiado e o tira do resumo', async () => {
    renderHidden(
      { m1: ['user-1', 'user-2', 'user-3', 'user-4'], m2: ['user-1'] },
      [],
      [
        makeMatch({ id: 'm1', round: '35', start_time: KICKOFF }),
        makeMatch({ id: 'm2', round: '35', start_time: '2026-10-01T21:30:00.000Z', postponed: 1 }),
      ],
    )

    expect(await screen.findByText('data a definir')).toBeInTheDocument()
    expect(screen.getByText('1 de 4 palpitou', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/Todo mundo palpitou/)).toBeInTheDocument()
  })

  it('mantém a lista de palpites em jogo iniciado, sem data nem contagem', async () => {
    const started = '2026-11-10T11:00:00.000Z'
    renderHidden(
      {},
      [ownPick({ locked: 1 })],
      [makeMatch({ id: 'm1', round: '35', status: 'live', start_time: started })],
    )

    expect(await screen.findAllByRole('listitem')).toHaveLength(4)
    expect(screen.getAllByText('sem palpite')).toHaveLength(3)
    expect(screen.queryByText(/palpitaram/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Faltam palpitar/)).not.toBeInTheDocument()
  })

  it('trata o jogo como iniciado quando o relógio local passou do início sem prova do servidor', async () => {
    const started = '2026-11-10T11:59:00.000Z'
    renderHidden(
      { m1: ['user-1'] },
      [ownPick()],
      [makeMatch({ id: 'm1', round: '35', start_time: started })],
    )

    await screen.findByText('Pedro')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText('sem palpite')).not.toBeInTheDocument()
    expect(screen.queryByText(/palpitou|palpitaram/)).not.toBeInTheDocument()
    expect(screen.queryByText(/aparecem quando o jogo começar/i)).not.toBeInTheDocument()
  })

  it('trata o jogo como travado quando o servidor confirma, mesmo com o relógio atrasado', async () => {
    renderHidden({}, [ownPick({ locked: 1 })])

    expect(await screen.findAllByRole('listitem')).toHaveLength(4)
    expect(screen.queryByText(/palpitaram/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Faltam palpitar/)).not.toBeInTheDocument()
  })

  it('no grupo "Sempre visível" mantém a lista e mostra a contagem sem iniciais', async () => {
    mockFetch([makeMatch({ id: 'm1', round: '35', start_time: KICKOFF })], {
      self_user_id: 'user-1',
      members: roster,
      predictions: [ownPick()],
      open_pickers: { m1: ['user-1'] },
    } as GroupPicksResponse)
    render(
      <GroupPicksTab
        groupId="g1"
        competitionId="c1"
        groupName="Realidade do BR"
        predictionsVisibility="public"
      />,
    )

    expect(await screen.findByText('1 de 4 palpitou')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /de 4 palpit/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText('Pedro').closest('li')).toHaveTextContent('2 × 1')
    expect(screen.queryByText(/aparecem quando o jogo começar/i)).not.toBeInTheDocument()
  })
})

describe('GroupPicksTab – analytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  function twoRounds() {
    return {
      matches: [
        makeMatch({ id: 'm1', round: '1', status: 'scheduled' }),
        makeMatch({ id: 'm2', round: '2', status: 'scheduled' }),
      ],
      picks: {
        self_user_id: 'user-1',
        members: [{ user_id: 'user-1', display: 'Pedro' }],
        predictions: [],
      },
    }
  }

  it('fires click_group_picks_proxima_rodada when Próxima is clicked', async () => {
    const { matches, picks } = twoRounds()
    mockFetch(matches, picks)
    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('1')
    })
    await userEvent.click(screen.getByRole('button', { name: /Próxima rodada/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_picks_proxima_rodada', { round: '2' })
  })

  it('fires click_group_picks_rodada_anterior when Anterior is clicked', async () => {
    const { matches, picks } = twoRounds()
    mockFetch(matches, picks)
    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('1')
    })
    await userEvent.click(screen.getByRole('button', { name: /Próxima rodada/i }))
    mockTrackEvent.mockClear()
    await userEvent.click(screen.getByRole('button', { name: /Rodada anterior/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_picks_rodada_anterior', {
      round: '1',
    })
  })

  it('fires change_group_picks_rodada when the round select is changed', async () => {
    const { matches, picks } = twoRounds()
    mockFetch(matches, picks)
    render(<GroupPicksTab groupId="g1" competitionId="c1" />)

    await waitFor(() => screen.getByRole('combobox'))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Rodada 2')
    expect(mockTrackEvent).toHaveBeenCalledWith('change_group_picks_rodada', {
      round: '2',
    })
  })
})
