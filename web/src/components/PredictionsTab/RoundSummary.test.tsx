import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateApiCache } from '../../lib/api-cache'
import { makeMatch } from '../matchFixtures'
import type { Match, Prediction } from '../MatchCard'
import RoundSummary from './RoundSummary'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))

const mockRender = vi.fn()
const mockMilestoneRender = vi.fn()
vi.mock('../../lib/roundShareCard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/roundShareCard')>()),
  renderRoundShareCardBlob: (...args: unknown[]) => mockRender(...args),
}))
vi.mock('../../lib/milestoneShareCard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/milestoneShareCard')>()),
  renderMilestoneShareCardBlob: (...args: unknown[]) => mockMilestoneRender(...args),
}))

beforeEach(() => invalidateApiCache())

afterEach(() => {
  vi.restoreAllMocks()
  mockRender.mockReset()
  mockMilestoneRender.mockReset()
})

const members = [
  { user_id: 'me', display: 'Pedro Satin' },
  { user_id: 'u2', display: 'Bruno' },
  { user_id: 'u3', display: 'Carla' },
]

function done(id: string, home: number, away: number): Match {
  return makeMatch({ id, status: 'finished', home_score: home, away_score: away })
}

function own(matchId: string, home: number, away: number, points: number): Prediction {
  return {
    id: `p-${matchId}`,
    match_id: matchId,
    predicted_home_score: home,
    predicted_away_score: away,
    points_awarded: points,
    locked: 1,
    updated_at: '',
  }
}

function groupPick(userId: string, matchId: string, home: number, away: number, points: number) {
  return {
    user_id: userId,
    match_id: matchId,
    predicted_home_score: home,
    predicted_away_score: away,
    points_awarded: points,
  }
}

function mockGroupApi(
  predictions: unknown[],
  ok = true,
  roundStandings: {
    round: string | null
    standings: {
      user_id: string
      round_points: number
      position_change: number | null
      streak?: number
      exact_hits?: number
      exact_milestone?: number | null
      exact_milestones_crossed?: number[]
    }[]
  } = { round: '34', standings: [] },
) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/round-standings')) {
      return new Response(JSON.stringify(roundStandings), { status: 200 })
    }
    if (!ok) return new Response('{}', { status: 500 })
    return new Response(
      JSON.stringify({ self_user_id: 'me', members, predictions, open_pickers: {} }),
      { status: 200 },
    )
  })
}

function renderSummary(
  matches: Match[],
  mine: Prediction[],
  extras: { inviteCode?: string; publicId?: string; isOwner?: boolean } = {},
) {
  return render(
    <RoundSummary
      groupId="g1"
      groupName="Realidade do BR"
      roundLabel="Rodada 34"
      selectedRound="34"
      roundMatches={matches}
      predictions={new Map(mine.map((p) => [p.match_id, p]))}
      pointsExact={3}
      inviteCode={extras.inviteCode}
      publicId={extras.publicId}
      isOwner={extras.isOwner}
    />,
  )
}

const matches = [done('a', 2, 1), done('b', 0, 0), done('c', 1, 3)]

describe('RoundSummary', () => {
  it('rodada encerrada mostra pontos, exatos, resultados certos e colocação', async () => {
    mockGroupApi([
      groupPick('me', 'a', 2, 1, 3),
      groupPick('me', 'b', 1, 1, 1),
      groupPick('u2', 'a', 1, 0, 1),
      groupPick('u2', 'b', 0, 0, 3),
      groupPick('u2', 'c', 0, 2, 1),
    ])
    renderSummary(matches, [own('a', 2, 1, 3), own('b', 1, 1, 1)])

    const region = screen.getByRole('region', { name: 'Resumo da rodada' })
    // 3 + 1 = 4 pontos, igual à soma dos chips dos cards.
    expect(region).toHaveTextContent(/4\s*pontos/)
    expect(region).toHaveTextContent(/1\s*placar exato/)
    expect(region).toHaveTextContent(/1\s*resultado certo/)
    expect(region).toHaveTextContent('1 jogo ficou sem palpite.')

    expect(await screen.findByText(/2º de 3/)).toBeInTheDocument()
    expect(
      screen.getByText('Bruno levou o título de rei da rodada, com 5 pontos.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/ainda vale pontos/)).not.toBeInTheDocument()
  })

  it('rodada com jogo adiado mostra o resumo parcial e o aviso', async () => {
    mockGroupApi([groupPick('me', 'a', 2, 1, 3)])
    renderSummary(
      [done('a', 2, 1), makeMatch({ id: 'p', status: 'scheduled', postponed: 1 })],
      [own('a', 2, 1, 3)],
    )
    expect(screen.getByText('1 jogo adiado ainda vale pontos.')).toBeInTheDocument()
    expect(await screen.findByText(/1º de 3/)).toBeInTheDocument()
  })

  it('empate no destaque lista os nomes', async () => {
    mockGroupApi([
      groupPick('me', 'a', 2, 1, 3),
      groupPick('u2', 'a', 2, 1, 3),
      groupPick('u3', 'a', 2, 1, 3),
    ])
    renderSummary([done('a', 2, 1)], [own('a', 2, 1, 3)])
    expect(
      await screen.findByText(
        'Você, Bruno e Carla dividiram o título de rei da rodada, com 3 pontos.',
      ),
    ).toBeInTheDocument()
  })

  it('rodada em andamento ou futura não mostra resumo nem busca o grupo', () => {
    const fetchSpy = mockGroupApi([])
    renderSummary([done('a', 1, 0), makeMatch({ id: 'b' })], [])
    expect(screen.queryByRole('region', { name: 'Resumo da rodada' })).not.toBeInTheDocument()
    // Sem escopo de rodada encerrada: nenhum fetch (nem palpites, nem round-standings).
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sem resposta do grupo mostra só os números próprios e esconde o cartão', async () => {
    mockGroupApi([], false)
    renderSummary([done('a', 2, 1)], [own('a', 2, 1, 3)])
    expect(screen.getByRole('region', { name: 'Resumo da rodada' })).toHaveTextContent(/3\s*pontos/)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Compartilhar rodada' })).not.toBeInTheDocument()
  })

  it('compartilha pelo menu nativo quando o aparelho aceita arquivo', async () => {
    mockGroupApi([groupPick('me', 'a', 2, 1, 3)])
    mockRender.mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    renderSummary([done('a', 2, 1)], [own('a', 2, 1, 3)])
    await userEvent.click(await screen.findByRole('button', { name: 'Compartilhar rodada' }))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const arg = share.mock.calls[0][0] as { files: File[]; text: string }
    expect(arg.files[0].name).toBe('palpitae-rodada-34.png')
    expect(arg.text).toContain('Fiz 3 pontos na rodada 34')

    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })

  it('baixa a imagem quando não há menu nativo', async () => {
    mockGroupApi([groupPick('me', 'a', 2, 1, 3)])
    mockRender.mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderSummary([done('a', 2, 1)], [own('a', 2, 1, 3)])
    await userEvent.click(await screen.findByRole('button', { name: 'Compartilhar rodada' }))

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalled()
  })

  it('trocar entre rodadas encerradas reaproveita a resposta do grupo', async () => {
    const fetchSpy = mockGroupApi([groupPick('me', 'a', 2, 1, 3)])
    const mine = new Map([['a', own('a', 2, 1, 3)]])
    const props = {
      groupId: 'g1',
      roundLabel: 'Rodada 34',
      selectedRound: '34',
      predictions: mine,
      pointsExact: 3,
    }
    const { rerender } = render(<RoundSummary {...props} roundMatches={[done('a', 2, 1)]} />)
    await screen.findByRole('button', { name: 'Compartilhar rodada' })

    rerender(<RoundSummary {...props} roundLabel="Rodada 35" roundMatches={[done('b', 1, 1)]} />)
    rerender(<RoundSummary {...props} roundMatches={[done('a', 2, 1)]} />)
    await screen.findByRole('button', { name: 'Compartilhar rodada' })

    const groupCalls = fetchSpy.mock.calls.filter((call) =>
      String(call[0]).includes('/predictions/group'),
    )
    expect(groupCalls).toHaveLength(1)
  })

  it('destaca o marco só na rodada de referência e oferece o cartão com o link', async () => {
    mockGroupApi([groupPick('me', 'a', 2, 1, 3)], true, {
      round: '34',
      standings: [
        {
          user_id: 'me',
          round_points: 3,
          position_change: null,
          exact_hits: 5,
          exact_milestone: 5,
          exact_milestones_crossed: [5],
        },
      ],
    })

    renderSummary([done('a', 2, 1)], [own('a', 2, 1, 3)], {
      inviteCode: 'AAAA-BBBB',
      isOwner: true,
    })

    expect(
      await screen.findByText('Você cruzou o marco de 5 placares exatos neste grupo.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compartilhar marco' })).toBeInTheDocument()
  })

  it('não redispara o destaque do marco quando a API não reporta cruzamento', async () => {
    mockGroupApi([groupPick('me', 'a', 2, 1, 3)], true, {
      round: '34',
      standings: [
        {
          user_id: 'me',
          round_points: 3,
          position_change: null,
          exact_hits: 6,
          exact_milestone: 5,
          exact_milestones_crossed: [],
        },
      ],
    })
    renderSummary([done('a', 2, 1)], [own('a', 2, 1, 3)])

    await screen.findByRole('button', { name: 'Compartilhar rodada' })
    expect(screen.queryByText(/cruzou o marco/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compartilhar marco' })).not.toBeInTheDocument()
  })

  it('avisa quando a geração do cartão falha', async () => {
    mockGroupApi([groupPick('me', 'a', 2, 1, 3)])
    mockRender.mockRejectedValue(new Error('canvas'))

    renderSummary([done('a', 2, 1)], [own('a', 2, 1, 3)])
    await userEvent.click(await screen.findByRole('button', { name: 'Compartilhar rodada' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível gerar a imagem')
    expect(screen.getByRole('button', { name: 'Compartilhar rodada' })).toBeEnabled()
  })

  it('compartilha o marco pelo menu nativo e inclui a URL completa do convite', async () => {
    mockGroupApi([groupPick('me', 'a', 2, 1, 3)], true, {
      round: '34',
      standings: [
        {
          user_id: 'me',
          round_points: 3,
          position_change: null,
          exact_hits: 5,
          exact_milestone: 5,
          exact_milestones_crossed: [5],
        },
      ],
    })
    mockMilestoneRender.mockResolvedValue(new Blob(['m'], { type: 'image/png' }))
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    renderSummary([done('a', 2, 1)], [own('a', 2, 1, 3)], {
      inviteCode: 'AAAA-BBBB',
      isOwner: true,
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Compartilhar marco' }))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const arg = share.mock.calls[0][0] as { files: File[]; text: string }
    expect(arg.files[0].name).toBe('palpitae-marco-5-exatos.png')
    const inviteUrl = `${window.location.origin}/convite/AAAA-BBBB`
    expect(arg.text).toContain(inviteUrl)
    expect(arg.text).toMatch(/^Cruzei o marco/)
    expect(mockMilestoneRender.mock.calls[0][0]).toMatchObject({ groupLink: inviteUrl })

    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })

  it('membro comum compartilha o link público e nunca o código de convite', async () => {
    const publicId = 'abcdef0123456789abcdef0123456789'
    mockGroupApi([groupPick('me', 'a', 2, 1, 3)], true, {
      round: '34',
      standings: [
        {
          user_id: 'me',
          round_points: 3,
          position_change: null,
          exact_hits: 5,
          exact_milestone: 5,
          exact_milestones_crossed: [5],
        },
      ],
    })
    mockMilestoneRender.mockResolvedValue(new Blob(['m'], { type: 'image/png' }))
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    renderSummary([done('a', 2, 1)], [own('a', 2, 1, 3)], {
      inviteCode: 'AAAA-BBBB',
      publicId,
      isOwner: false,
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Compartilhar marco' }))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const arg = share.mock.calls[0][0] as { files: File[]; text: string }
    const groupUrl = `${window.location.origin}/grupo/${publicId}`
    expect(arg.text).toContain(groupUrl)
    expect(arg.text).not.toContain('AAAA-BBBB')
    expect(arg.text).not.toContain('/convite/')
    expect(mockMilestoneRender.mock.calls[0][0]).toMatchObject({ groupLink: groupUrl })

    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })

  it('no download do marco copia o link e confirma de forma acessível', async () => {
    mockGroupApi([groupPick('me', 'a', 2, 1, 3)], true, {
      round: '34',
      standings: [
        {
          user_id: 'me',
          round_points: 3,
          position_change: null,
          exact_hits: 5,
          exact_milestone: 5,
          exact_milestones_crossed: [5],
        },
      ],
    })
    mockMilestoneRender.mockResolvedValue(new Blob(['m'], { type: 'image/png' }))
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:m'),
      revokeObjectURL: vi.fn(),
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderSummary([done('a', 2, 1)], [own('a', 2, 1, 3)], {
      inviteCode: 'AAAA-BBBB',
      isOwner: true,
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Compartilhar marco' }))

    const inviteUrl = `${window.location.origin}/convite/AAAA-BBBB`
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(inviteUrl))
    expect(writeText.mock.calls[0][0]).toMatch(/^Cruzei o marco/)
    expect(mockMilestoneRender.mock.calls[0][0]).toMatchObject({ groupLink: inviteUrl })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Imagem baixada e link copiado',
    )

    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
  })

  it('no download sem clipboard mostra o link para copiar', async () => {
    mockGroupApi([groupPick('me', 'a', 2, 1, 3)], true, {
      round: '34',
      standings: [
        {
          user_id: 'me',
          round_points: 3,
          position_change: null,
          exact_hits: 5,
          exact_milestone: 5,
          exact_milestones_crossed: [5],
        },
      ],
    })
    mockMilestoneRender.mockResolvedValue(new Blob(['m'], { type: 'image/png' }))
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true })
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:m'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderSummary([done('a', 2, 1)], [own('a', 2, 1, 3)], {
      inviteCode: 'AAAA-BBBB',
      isOwner: true,
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Compartilhar marco' }))

    const inviteUrl = `${window.location.origin}/convite/AAAA-BBBB`
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Imagem baixada. Copie o link:')
    expect(status.querySelector('a')).toHaveAttribute('href', inviteUrl)

    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
  })

  it('avisa quando a geração do cartão do marco falha', async () => {
    mockGroupApi([groupPick('me', 'a', 2, 1, 3)], true, {
      round: '34',
      standings: [
        {
          user_id: 'me',
          round_points: 3,
          position_change: null,
          exact_hits: 5,
          exact_milestone: 5,
          exact_milestones_crossed: [5],
        },
      ],
    })
    mockMilestoneRender.mockRejectedValue(new Error('canvas'))

    renderSummary([done('a', 2, 1)], [own('a', 2, 1, 3)])
    await userEvent.click(await screen.findByRole('button', { name: 'Compartilhar marco' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível gerar a imagem')
    expect(screen.getByRole('button', { name: 'Compartilhar marco' })).toBeEnabled()
  })

  it('rótulos no singular quando há 1 ponto, 1 exato e 1 acerto', async () => {
    mockGroupApi([groupPick('me', 'a', 2, 1, 3)])
    renderSummary([done('a', 2, 1)], [own('a', 2, 1, 3)])

    const region = screen.getByRole('region', { name: 'Resumo da rodada' })
    expect(region).toHaveTextContent(/3\s*pontos/)
    expect(region).toHaveTextContent(/1\s*placar exato/)
    expect(await screen.findByText(/1º de 3/)).toBeInTheDocument()
  })
})
