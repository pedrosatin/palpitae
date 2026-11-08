import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatClosingDate } from '../../lib/matchTime'
import { makeMatch } from '../matchFixtures'
import type { Match, Prediction } from '../MatchCard'
import PredictionsTab from './PredictionsTab'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const MIN = 60_000
const HOUR = 60 * MIN
/** Margem para o relógio andar durante o teste sem mudar o minuto exibido. */
const SLACK = 30_000
const inMs = (ms: number) => new Date(Date.now() + ms + SLACK).toISOString()

function mockApi(matches: Match[], predictions: Prediction[] = []) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = url.toString()
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (u.includes('/matches')) return json({ matches, default_round: '1' })
    if (u.includes('/predictions/bulk')) {
      const body = JSON.parse(init!.body as string) as { predictions: { match_id: string }[] }
      return json({ saved: body.predictions.map((p) => p.match_id) })
    }
    if (u.includes('/predictions') && init?.method === 'PUT') return json({ ok: true })
    if (u.includes('/predictions')) return json({ predictions })
    if (u.includes('/groups')) return json({ groups: [] })
    throw new Error(`Unexpected fetch: ${u}`)
  })
}

function pick(matchId: string, overrides: Partial<Prediction> = {}): Prediction {
  return {
    id: `p-${matchId}`,
    match_id: matchId,
    predicted_home_score: 1,
    predicted_away_score: 0,
    points_awarded: 0,
    locked: 0,
    updated_at: '',
    ...overrides,
  }
}

const teams = (home: string, away: string) => ({
  home_team_name: home,
  home_team_short_name: home.slice(0, 3).toUpperCase(),
  away_team_name: away,
  away_team_short_name: away.slice(0, 3).toUpperCase(),
})

function renderTab() {
  return render(<PredictionsTab groupId="g1" competitionId="c1" />)
}

describe('PredictionsTab – progresso da rodada', () => {
  it('mostra quantos jogos têm palpite e quanto falta para o próximo fechar', async () => {
    mockApi(
      [
        makeMatch({ id: 'm1', start_time: inMs(2 * HOUR + 15 * MIN) }),
        makeMatch({ id: 'm2', start_time: inMs(30 * HOUR), ...teams('Chile', 'Peru') }),
        makeMatch({ id: 'm3', start_time: inMs(50 * HOUR), ...teams('Uruguai', 'Paraguai') }),
      ],
      [pick('m3')],
    )
    renderTab()

    expect(await screen.findByRole('status')).toHaveTextContent('1 de 3 palpitados')
    expect(screen.getByText('próximo jogo fecha em 2 h 15 min')).toBeInTheDocument()
  })

  it('quando o jogo começa com a aba aberta, o cabeçalho e o card mudam no mesmo tique', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockApi([
      makeMatch({ id: 'm1', start_time: inMs(MIN) }),
      makeMatch({ id: 'm2', start_time: inMs(5 * HOUR), ...teams('Chile', 'Peru') }),
    ])
    renderTab()

    expect(await screen.findByText('próximo jogo fecha em 1 min')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('0 de 2 palpitados')
    expect(
      screen.getByRole('group', { name: 'Brasil contra Argentina, sem palpite' }),
    ).toBeInTheDocument()

    // Roda os efeitos da montagem, que ligam o relógio, antes de avançar a hora.
    await act(async () => {})
    act(() => {
      vi.advanceTimersByTime(2 * MIN)
    })

    expect(screen.getByText('próximo jogo fecha em 4 h 58 min')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('0 de 1 palpitado')
    expect(
      screen.getByRole('group', { name: 'Brasil contra Argentina, bloqueado' }),
    ).toBeInTheDocument()
  })

  it('com 24 h ou mais até o fechamento, mostra a data com dia da semana', async () => {
    const start = inMs(3 * 24 * HOUR)
    mockApi([makeMatch({ id: 'm1', start_time: start })])
    renderTab()

    expect(
      await screen.findByText(`próximo jogo fecha ${formatClosingDate(start)}`),
    ).toBeInTheDocument()
  })

  it('atualiza o contador na hora depois de salvar um palpite, sem recarregar', async () => {
    mockApi([
      makeMatch({ id: 'm1', start_time: inMs(5 * HOUR) }),
      makeMatch({ id: 'm2', start_time: inMs(6 * HOUR), ...teams('Chile', 'Peru') }),
    ])
    const user = userEvent.setup()
    renderTab()

    expect(await screen.findByRole('status')).toHaveTextContent('0 de 2 palpitados')
    const card = screen.getByRole('group', { name: 'Brasil contra Argentina, sem palpite' })
    await user.click(within(card).getByRole('button', { name: 'Aumentar placar Brasil' }))
    await user.click(within(card).getByRole('button', { name: 'Diminuir placar Argentina' }))
    await user.click(within(card).getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('1 de 2 palpitados')).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Brasil contra Argentina, palpite salvo' }),
    ).toBeInTheDocument()
    // Os palpites vieram da API uma vez só, na abertura da aba.
    const predictionReads = vi
      .mocked(fetch)
      .mock.calls.filter(([url, init]) => String(url).includes('/predictions?') && !init?.method)
    expect(predictionReads).toHaveLength(1)
  })

  it('atualiza o contador depois do "Salvar todos"', async () => {
    mockApi([
      makeMatch({ id: 'm1', start_time: inMs(5 * HOUR) }),
      makeMatch({ id: 'm2', start_time: inMs(6 * HOUR), ...teams('Chile', 'Peru') }),
    ])
    const user = userEvent.setup()
    renderTab()

    await screen.findByText('0 de 2 palpitados')
    await user.click(screen.getByRole('button', { name: 'Aumentar placar Brasil' }))
    await user.click(screen.getByRole('button', { name: 'Diminuir placar Argentina' }))
    await user.click(screen.getByRole('button', { name: 'Aumentar placar Chile' }))
    await user.click(screen.getByRole('button', { name: 'Aumentar placar Peru' }))
    await user.click(screen.getByRole('button', { name: /Salvar todos \(2\)/ }))

    expect(await screen.findByText('2 de 2 palpitados')).toBeInTheDocument()
  })

  it('sem jogo aberto na rodada, a linha some', async () => {
    mockApi(
      [
        makeMatch({ id: 'm1', status: 'finished' }),
        makeMatch({ id: 'm2', status: 'finished', ...teams('Chile', 'Peru') }),
      ],
      [pick('m1', { locked: 1 })],
    )
    renderTab()

    await screen.findAllByText('encerrado')
    expect(screen.queryByText(/palpitado/)).not.toBeInTheDocument()
    expect(screen.queryByText(/próximo jogo fecha/)).not.toBeInTheDocument()
  })

  it('só com jogo adiado aberto, mostra o contador sem o fechamento', async () => {
    mockApi([
      makeMatch({
        id: 'm1',
        start_time: new Date(Date.now() - 48 * HOUR).toISOString(),
        postponed: 1,
      }),
      makeMatch({ id: 'm2', status: 'finished', ...teams('Chile', 'Peru') }),
    ])
    renderTab()

    expect(await screen.findByText('0 de 1 palpitado')).toBeInTheDocument()
    expect(screen.queryByText(/próximo jogo fecha/)).not.toBeInTheDocument()
  })
})
