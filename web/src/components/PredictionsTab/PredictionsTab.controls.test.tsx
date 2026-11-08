import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PredictionsTab from './PredictionsTab'
import { makeMatch } from '../matchFixtures'
import type { Match, Prediction } from '../MatchCard'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

function mockApi(matches: Match[], predictions: Prediction[] = [], defaultRound = '1') {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = url.toString()
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (u.includes('/matches')) return json({ matches, default_round: defaultRound })
    if (u.includes('/predictions')) return json({ predictions })
    if (u.includes('/groups')) return json({ groups: [] })
    throw new Error(`Unexpected fetch: ${u}`)
  })
}

const past = new Date(Date.now() - 3_600_000).toISOString()

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
})

// O tamanho de 44×44 px vem das media queries de MatchCard.module.css, que o
// jsdom não aplica (e o Vitest devolve vazio para import de .css). Aqui fica a
// ligação entre os botões e a classe que essas regras miram.
describe('MatchCard – área de toque do stepper', () => {
  it('os quatro botões −/+ do card usam a classe do stepper', async () => {
    mockApi([makeMatch({ id: 'm1' })])
    renderTab()
    const buttons = await screen.findAllByRole('button', { name: /^(Diminuir|Aumentar) placar/ })
    expect(buttons).toHaveLength(4)
    for (const button of buttons) expect(button).toHaveClass('stepBtn')
  })
})
