import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PredictionsTab from './PredictionsTab'
import { makeMatch } from '../matchFixtures'
import type { Match, Prediction } from '../MatchCard'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mockApi(
  matches: Match[],
  predictions: Prediction[] = [],
  defaultRound = '1',
  bulk?: () => Promise<Response>,
) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = url.toString()
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (u.includes('/matches')) return json({ matches, default_round: defaultRound })
    if (u.includes('/predictions/bulk') && bulk) return bulk()
    if (u.includes('/predictions')) return json({ predictions })
    if (u.includes('/groups')) return json({ groups: [] })
    throw new Error(`Unexpected fetch: ${u}`)
  })
}

const past = new Date(Date.now() - 3_600_000).toISOString()

function savedPick(matchId: string): Prediction {
  return {
    id: `p-${matchId}`,
    match_id: matchId,
    predicted_home_score: 1,
    predicted_away_score: 0,
    points_awarded: 0,
    locked: 0,
    updated_at: '',
  }
}

function renderTab() {
  return render(<PredictionsTab groupId="g1" competitionId="c1" />)
}

async function waitForCards() {
  await screen.findAllByText('Brasil')
}

describe('PredictionsTab – barra Salvar todos', () => {
  it('aparece, com espaço reservado no fim da página, quando há jogo editável', async () => {
    mockApi([makeMatch({ id: 'm1' }), makeMatch({ id: 'm2', status: 'finished' })])
    const { container } = renderTab()
    expect(await screen.findByRole('button', { name: /^Salvar todos$/i })).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('rootWithSaveBar')
  })

  it.each([
    ['rodada toda encerrada', [makeMatch({ id: 'm1', status: 'finished' })], []],
    ['jogo travado pela API', [makeMatch({ id: 'm1', locked_at: past })], []],
    ['horário de início vencido', [makeMatch({ id: 'm1', start_time: past })], []],
    [
      'palpite já travado',
      [makeMatch({ id: 'm1' })],
      [
        {
          id: 'p1',
          match_id: 'm1',
          predicted_home_score: 1,
          predicted_away_score: 0,
          points_awarded: 0,
          locked: 1 as const,
          updated_at: '',
        },
      ],
    ],
  ])('some com %s e não reserva espaço', async (_label, matches, predictions) => {
    mockApi(matches, predictions)
    const { container } = renderTab()
    await waitForCards()
    expect(screen.queryByRole('button', { name: /Salvar todos/i })).not.toBeInTheDocument()
    expect(container.firstElementChild).not.toHaveClass('rootWithSaveBar')
  })

  it('volta ao trocar de uma rodada encerrada para uma com jogo aberto', async () => {
    mockApi([
      makeMatch({ id: 'final', round: '1', status: 'finished' }),
      makeMatch({ id: 'open', round: '2' }),
    ])
    renderTab()
    await waitForCards()
    expect(screen.queryByRole('button', { name: /Salvar todos/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /próxima rodada/i }))
    expect(await screen.findByRole('button', { name: /^Salvar todos$/i })).toBeInTheDocument()
  })

  it('mantém o rascunho e o contador ao passar por uma rodada encerrada e voltar', async () => {
    mockApi(
      [
        makeMatch({ id: 'final', round: '1', status: 'finished' }),
        makeMatch({ id: 'open', round: '2' }),
      ],
      [savedPick('open')],
      '2',
    )
    renderTab()
    await waitForCards()
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    expect(screen.getByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: /rodada anterior/i }))
    expect(screen.queryByRole('button', { name: /Salvar todos/i })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /próxima rodada/i }))
    expect(await screen.findByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()
    expect(screen.getByLabelText('Placar Argentina')).toHaveValue(1)
  })

  it('fica na tela com o envio e o erro quando o último jogo aberto começa no meio', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-01T15:59:00Z'))
    let finish!: (response: Response) => void
    mockApi(
      [makeMatch({ id: 'm1', start_time: '2026-06-01T16:00:00Z' })],
      [savedPick('m1')],
      '1',
      () => new Promise<Response>((resolve) => (finish = resolve)),
    )
    const view = renderTab()
    await waitForCards()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await user.click(screen.getByRole('button', { name: /Salvar todos \(1\)/i }))

    vi.setSystemTime(new Date('2026-06-01T16:00:05Z'))
    view.rerender(<PredictionsTab groupId="g1" competitionId="c1" />)
    expect(screen.getByRole('button', { name: 'Salvando...' })).toBeInTheDocument()

    await act(async () => {
      finish(new Response(JSON.stringify({ error: 'Jogo já começou' }), { status: 409 }))
    })
    expect(await screen.findByText('Jogo já começou')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Salvar todos$/i })).toBeDisabled()
  })
})

describe('PredictionsTab – resultado do "Salvar todos"', () => {
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))
  const round1 = [
    makeMatch({ id: 'm1', home_team_name: 'Flamengo', away_team_name: 'Palmeiras' }),
    makeMatch({ id: 'm2', home_team_name: 'Corinthians', away_team_name: 'Bahia' }),
    makeMatch({ id: 'm3', home_team_name: 'Grêmio', away_team_name: 'Cruzeiro' }),
  ]
  const round2 = makeMatch({ id: 'm4', round: '2' })

  async function editRound1(teams = ['Palmeiras', 'Bahia', 'Cruzeiro']) {
    await screen.findByText('Flamengo')
    for (const team of teams) {
      await userEvent.click(screen.getByRole('button', { name: `Aumentar placar ${team}` }))
    }
  }

  it('com jogo aceito, travado e não encontrado, explica a recusa e não diz "Tudo salvo!"', async () => {
    mockApi([...round1, round2], [savedPick('m1'), savedPick('m2'), savedPick('m3')], '1', () =>
      json({ ok: true, saved: ['m1'], locked: ['m2'], not_found: ['m3'] }),
    )
    const { container } = renderTab()
    await editRound1()
    await userEvent.click(screen.getByRole('button', { name: 'Salvar todos (3)' }))

    expect(
      await screen.findByText(
        '1 palpite salvo. 1 jogo já bloqueado ficou de fora. 1 jogo não foi encontrado neste ' +
          'campeonato. Recarregue a página para atualizar os jogos.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tudo salvo!' })).not.toBeInTheDocument()
    // O aceito sai do rascunho. Os recusados continuam no card e no contador.
    expect(screen.getByRole('button', { name: 'Salvar todos (2)' })).toBeEnabled()
    expect(screen.getAllByText('alterado, não salvo')).toHaveLength(2)
    // O aviso ocupa até três linhas na barra fixa, e o último card não fica atrás dela.
    expect(container.firstElementChild).toHaveClass('rootWithSaveBarTall')

    await userEvent.click(screen.getByRole('button', { name: /próxima rodada/i }))
    expect(screen.queryByText(/ficou de fora/)).not.toBeInTheDocument()
  })

  it('sem motivo na resposta, pede para tentar de novo', async () => {
    mockApi([...round1], [savedPick('m1'), savedPick('m2')], '1', () => json({ saved: ['m1'] }))
    renderTab()
    await editRound1(['Palmeiras', 'Bahia'])
    await userEvent.click(screen.getByRole('button', { name: 'Salvar todos (2)' }))

    expect(
      await screen.findByText('1 palpite salvo. 1 palpite não foi salvo. Tente novamente.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar todos (1)' })).toBeEnabled()
  })

  it('o erro do envio não aparece na rodada seguinte', async () => {
    mockApi([...round1, round2], [savedPick('m1')], '1', () =>
      json({ error: 'Erro ao salvar palpites' }, 500),
    )
    renderTab()
    await editRound1(['Palmeiras'])
    await userEvent.click(screen.getByRole('button', { name: 'Salvar todos (1)' }))
    expect(await screen.findByText('Erro ao salvar palpites')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /próxima rodada/i }))
    expect(screen.queryByText('Erro ao salvar palpites')).not.toBeInTheDocument()
  })

  /** Envio que só responde quando o teste chama `finish`. */
  function deferredBulk(respond: () => Promise<Response>) {
    const control = { finish: () => {} }
    mockApi(
      [...round1, round2],
      [savedPick('m1')],
      '1',
      () =>
        new Promise<Response>((resolve) => {
          control.finish = () => void respond().then(resolve)
        }),
    )
    return control
  }

  async function saveAndLeaveRound1() {
    renderTab()
    await editRound1(['Palmeiras'])
    await userEvent.click(screen.getByRole('button', { name: 'Salvar todos (1)' }))
    await userEvent.click(screen.getByRole('button', { name: /próxima rodada/i }))
    expect(screen.getByRole('combobox')).toHaveValue('2')
  }

  it('o sucesso de um envio que volta depois da troca de rodada fica na rodada dele', async () => {
    const bulk = deferredBulk(() => json({ ok: true, saved: ['m1'], locked: [], not_found: [] }))
    await saveAndLeaveRound1()

    await act(async () => bulk.finish())
    expect(await screen.findByRole('button', { name: 'Salvar todos' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tudo salvo!' })).not.toBeInTheDocument()

    // O palpite aceito continua gravado: na rodada 1 não há mais o que salvar.
    await userEvent.click(screen.getByRole('button', { name: /rodada anterior/i }))
    expect(screen.getByRole('button', { name: 'Salvar todos' })).toBeDisabled()
    expect(screen.getByLabelText('Placar Palmeiras')).toHaveValue(1)
  })

  it('o erro de um envio que volta depois da troca de rodada não aparece na rodada nova', async () => {
    const bulk = deferredBulk(() => json({ error: 'Erro ao salvar palpites' }, 500))
    await saveAndLeaveRound1()

    await act(async () => bulk.finish())
    expect(await screen.findByRole('button', { name: 'Salvar todos' })).toBeInTheDocument()
    expect(screen.queryByText('Erro ao salvar palpites')).not.toBeInTheDocument()
  })
})

// O jsdom não aplica as media queries, e o Vitest carrega só os nomes de classe,
// sem o CSS. O teste confere que os −/+ usam a classe que essas regras miram.
describe('MatchCard – área de toque do stepper', () => {
  it('os quatro botões −/+ do card usam a classe do stepper', async () => {
    mockApi([makeMatch({ id: 'm1' })])
    renderTab()
    const buttons = await screen.findAllByRole('button', { name: /^(Diminuir|Aumentar) placar/ })
    expect(buttons).toHaveLength(4)
    for (const button of buttons) expect(button).toHaveClass('stepBtn')
  })
})
