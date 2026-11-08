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
