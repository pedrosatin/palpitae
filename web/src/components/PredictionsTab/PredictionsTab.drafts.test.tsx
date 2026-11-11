import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PredictionsTab from './PredictionsTab'
import { makeMatch } from '../matchFixtures'
import type { Match, Prediction } from '../MatchCard'
import { draftStorageKey } from '../../lib/predictionDraftStorage'
import { savedBase, type PenaltyWinner } from '../../lib/predictionDrafts'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))

const KEY = draftStorageKey('u1', 'g1')

function saved(overrides: Partial<Prediction> = {}): Prediction {
  return {
    id: 'p1',
    match_id: 'm1',
    predicted_home_score: 1,
    predicted_away_score: 0,
    points_awarded: 0,
    locked: 0,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** API simulada. `setPredictions` troca o que o servidor devolve na próxima busca. */
function mockApi(
  matches: Match[],
  predictions: Prediction[] = [],
  { predictionsFail = false } = {},
) {
  let current = predictions
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const u = url.toString()
    if (u.includes('/matches'))
      return Promise.resolve({
        ok: true,
        json: async () => ({ matches, default_round: '1' }),
      } as Response)
    if (u.includes('/predictions/bulk')) {
      const body = JSON.parse(init!.body as string) as { predictions: { match_id: string }[] }
      return Promise.resolve({
        ok: true,
        json: async () => ({ saved: body.predictions.map((p) => p.match_id) }),
      } as Response)
    }
    if (u.includes('/predictions') && init?.method === 'PUT')
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response)
    if (u.includes('/predictions'))
      return Promise.resolve(
        predictionsFail
          ? ({ ok: false, json: async () => ({}) } as Response)
          : ({ ok: true, json: async () => ({ predictions: current }) } as Response),
      )
    if (u.includes('/groups'))
      return Promise.resolve({ ok: true, json: async () => ({ groups: [] }) } as Response)
    return Promise.reject(new Error(`Unexpected fetch: ${u}`))
  })
  return {
    setPredictions(next: Prediction[]) {
      current = next
    },
  }
}

function renderTab() {
  return render(<PredictionsTab groupId="g1" competitionId="c1" userId="u1" />)
}

/** Grava rascunhos digitados agora sobre `base`, por padrão um jogo sem palpite. */
function storeDraft(
  scores: Record<string, { home: string; away: string }>,
  penalties: Record<string, PenaltyWinner> = {},
  base = savedBase(undefined),
) {
  const at = Date.now()
  const entries = <T,>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).map(([id, value]) => [id, { value, base, at }]))
  localStorage.setItem(
    KEY,
    JSON.stringify({ scores: entries(scores), penalties: entries(penalties) }),
  )
}

function storedIds() {
  const raw = localStorage.getItem(KEY)
  if (!raw) return null
  const stored = JSON.parse(raw) as { scores: object; penalties: object }
  return { scores: Object.keys(stored.scores), penalties: Object.keys(stored.penalties) }
}

function fireBeforeUnload() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('PredictionsTab – rascunho guardado no navegador', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })
  afterEach(() => localStorage.clear())

  it('restaura o placar alterado depois de remontar, com "Salvar todos (1)"', async () => {
    mockApi([makeMatch({ id: 'm1' })], [saved()])
    const first = renderTab()
    await screen.findByRole('button', { name: /^Salvar todos$/i })

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    expect(screen.getByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()
    await waitFor(() => expect(localStorage.getItem(KEY)).not.toBeNull())
    first.unmount()

    renderTab()
    expect(await screen.findByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()
    expect(screen.getByLabelText('Placar Brasil')).toHaveValue(1)
    expect(screen.getByLabelText('Placar Argentina')).toHaveValue(1)
  })

  it('descarta o rascunho quando o palpite salvo mudou em outro aparelho', async () => {
    const api = mockApi([makeMatch({ id: 'm1' })], [saved()])
    const user = userEvent.setup()
    const first = renderTab()
    await screen.findByRole('button', { name: /^Salvar todos$/i })

    // Salvo 1×0, rascunho 3×0 sem salvar.
    await user.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await user.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    expect(screen.getByLabelText('Placar Brasil')).toHaveValue(3)
    await waitFor(() => expect(storedIds()?.scores).toEqual(['m1']))
    first.unmount()

    // O mesmo palpite foi salvo como 2×2 em outro aparelho.
    api.setPredictions([saved({ predicted_home_score: 2, predicted_away_score: 2 })])
    renderTab()
    expect(await screen.findByRole('button', { name: /^Salvar todos$/i })).toBeDisabled()
    expect(screen.getByLabelText('Placar Brasil')).toHaveValue(2)
    expect(screen.getByLabelText('Placar Argentina')).toHaveValue(2)
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull())
    expect(fireBeforeUnload()).toBe(false)
  })

  it('restaura o pênalti escolhido no mata-mata', async () => {
    mockApi([makeMatch({ id: 'm1', decides_on_penalties: true })])
    storeDraft({ m1: { home: '1', away: '1' } }, { m1: 'away' })

    renderTab()
    expect(await screen.findByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()
    expect(screen.getByLabelText('Placar Brasil')).toHaveValue(1)
    // Pênalti escolhido vira o chip com o vencedor, sem os botões de escolha.
    expect(screen.queryByRole('radiogroup', { name: /pênaltis/i })).not.toBeInTheDocument()
    expect(screen.getByText('ARG')).toBeInTheDocument()
  })

  it('salvar todos limpa o rascunho guardado e o aviso de saída', async () => {
    mockApi([makeMatch({ id: 'm1' })])
    storeDraft({ m1: { home: '2', away: '1' } })

    renderTab()
    await waitFor(() => expect(fireBeforeUnload()).toBe(true))
    await userEvent.click(await screen.findByRole('button', { name: /Salvar todos \(1\)/i }))

    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull())
    expect(fireBeforeUnload()).toBe(false)
  })

  it('salvar um card tira do storage só o rascunho daquele jogo', async () => {
    mockApi([makeMatch({ id: 'm1' }), makeMatch({ id: 'm2' })])
    storeDraft({ m1: { home: '2', away: '1' }, m2: { home: '0', away: '3' } })

    renderTab()
    expect(await screen.findByRole('button', { name: /Salvar todos \(2\)/i })).toBeEnabled()
    await userEvent.click(screen.getAllByRole('button', { name: 'Salvar' })[0])

    await waitFor(() => expect(storedIds()).toEqual({ scores: ['m2'], penalties: [] }))
    expect(screen.getByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()
  })

  it('ignora rascunho igual ao palpite salvo', async () => {
    const current = saved({ predicted_home_score: 2, predicted_away_score: 1 })
    mockApi([makeMatch({ id: 'm1' })], [current])
    storeDraft({ m1: { home: '2', away: '1' } }, {}, savedBase(current))

    renderTab()
    expect(await screen.findByRole('button', { name: /^Salvar todos$/i })).toBeDisabled()
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull())
    expect(fireBeforeUnload()).toBe(false)
  })

  it('descarta o rascunho de jogo que travou', async () => {
    const started = new Date(Date.now() - 60_000).toISOString()
    mockApi([makeMatch({ id: 'm1', start_time: started }), makeMatch({ id: 'm2' })])
    storeDraft({ m1: { home: '3', away: '3' }, m2: { home: '1', away: '0' } })

    renderTab()
    expect(await screen.findByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()
    await waitFor(() => expect(storedIds()?.scores).toEqual(['m2']))
  })

  it('mantém o storage intacto quando a busca dos palpites falha', async () => {
    mockApi([makeMatch({ id: 'm1' })], [], { predictionsFail: true })
    storeDraft({ m1: { home: '2', away: '1' } })
    const before = localStorage.getItem(KEY)

    renderTab()
    expect(await screen.findByText('Erro ao carregar palpites')).toBeInTheDocument()
    expect(localStorage.getItem(KEY)).toBe(before)
  })

  it('marca no seletor a rodada com rascunho não salvo', async () => {
    mockApi([makeMatch({ id: 'm1', round: '1' }), makeMatch({ id: 'm2', round: '2' })])
    storeDraft({ m2: { home: '1', away: '0' } })

    renderTab()
    expect(await screen.findByRole('option', { name: 'Rodada 2 · não salvo' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Rodada 1' })).toBeInTheDocument()

    // Jogo sem palpite começa vazio. O rascunho conta com os dois placares escolhidos.
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: /Diminuir placar Brasil/i }))
    expect(screen.getByRole('option', { name: 'Rodada 1 · não salvo' })).toBeInTheDocument()
  })

  it('sem rascunho pendente, não pede confirmação ao sair', async () => {
    mockApi([makeMatch({ id: 'm1' })], [saved()])
    renderTab()
    await screen.findByRole('button', { name: /^Salvar todos$/i })
    expect(fireBeforeUnload()).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    expect(fireBeforeUnload()).toBe(true)
  })

  it('funciona como antes quando o storage está indisponível', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    mockApi([makeMatch({ id: 'm1' })])

    renderTab()
    await screen.findByRole('button', { name: /^Salvar todos$/i })
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: /Diminuir placar Brasil/i }))
    expect(screen.getByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()
    expect(fireBeforeUnload()).toBe(true)
  })
})

describe('PredictionsTab – rascunho de pênalti na volta', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })
  afterEach(() => localStorage.clear())

  const teams = {
    vasco: { name: 'Vasco', short: 'VAS' },
    gremio: { name: 'Grêmio', short: 'GRE' },
  }
  const ida = makeMatch({
    id: 'ida',
    tie_role: 'leg1',
    home_team_name: teams.vasco.name,
    home_team_short_name: teams.vasco.short,
    away_team_name: teams.gremio.name,
    away_team_short_name: teams.gremio.short,
  })
  const volta = makeMatch({
    id: 'volta',
    tie_role: 'leg2',
    leg1_match_id: 'ida',
    decides_on_penalties: true,
    home_team_name: teams.gremio.name,
    home_team_short_name: teams.gremio.short,
    away_team_name: teams.vasco.name,
    away_team_short_name: teams.vasco.short,
  })

  it('o pênalti escolhido some quando o empate do agregado se desfaz', async () => {
    // Ida 1×0 para o Vasco e volta 1×0 para o Grêmio empatam o agregado em 1×1.
    mockApi([ida, volta], [saved({ match_id: 'ida' }), saved({ id: 'p2', match_id: 'volta' })])
    const user = userEvent.setup()
    renderTab()
    await user.click(await screen.findByRole('radio', { name: 'GRE' }))
    expect(screen.getByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()
    await waitFor(() => expect(storedIds()?.penalties).toEqual(['volta']))

    // A ida passa a 2×0 e o agregado deixa de empatar.
    await user.click(screen.getAllByRole('button', { name: 'Aumentar placar Vasco' })[0])
    expect(screen.queryByRole('radiogroup', { name: /pênaltis/i })).not.toBeInTheDocument()
    await waitFor(() => expect(storedIds()).toEqual({ scores: ['ida'], penalties: [] }))
    expect(screen.getByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()

    // Só a ida mudou. A volta segue salva, sem a escolha dos pênaltis na tela.
    expect(screen.getAllByRole('button', { name: 'Atualizar' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull())
    expect(screen.getAllByRole('button', { name: 'Salvo' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /^Salvar todos$/i })).toBeDisabled()
    expect(fireBeforeUnload()).toBe(false)
  })
})

describe('PredictionsTab – rascunho e importação', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })
  afterEach(() => localStorage.clear())

  it('importar o jogo descarta o rascunho dele; remontar mostra o importado e contador 0', async () => {
    let current: Prediction[] = []
    const imported = saved({ predicted_home_score: 3, predicted_away_score: 2 })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = url.toString()
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
      if (u.includes('/matches'))
        return json({ matches: [makeMatch({ id: 'm1' })], default_round: '1' })
      if (u.includes('/groups'))
        return json({ groups: [{ id: 'origem', name: 'Origem', competition_id: 'c1' }] })
      if (u.includes('/predictions/import')) {
        current = [imported]
        return json({ ok: true, imported: 1, locked_skipped: 0 })
      }
      if (u.includes('/predictions')) return json({ predictions: current })
      throw new Error(`Unexpected fetch: ${u}`)
    })
    const user = userEvent.setup()

    const first = renderTab()
    await user.click(await screen.findByRole('button', { name: /Aumentar placar Argentina/i }))
    await user.click(screen.getByRole('button', { name: /Diminuir placar Brasil/i }))
    expect(screen.getByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()
    await waitFor(() => expect(localStorage.getItem(KEY)).not.toBeNull())

    await user.click(screen.getByRole('button', { name: 'Importar' }))
    expect(await screen.findByRole('button', { name: /^Salvar todos$/i })).toBeDisabled()
    expect(screen.getByLabelText('Placar Brasil')).toHaveValue(3)
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull())
    expect(fireBeforeUnload()).toBe(false)
    first.unmount()

    renderTab()
    expect(await screen.findByRole('button', { name: /^Salvar todos$/i })).toBeDisabled()
    expect(screen.getByLabelText('Placar Brasil')).toHaveValue(3)
    expect(screen.getByLabelText('Placar Argentina')).toHaveValue(2)
  })
})

describe('PredictionsTab – resposta de um card que saiu da tela', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })
  afterEach(() => localStorage.clear())

  it('a resposta do 2×1 que chega depois da troca de rodada não apaga o 3×1', async () => {
    mockApi([makeMatch({ id: 'm1', round: '1' }), makeMatch({ id: 'm2', round: '2' })])
    const api = vi.mocked(globalThis.fetch).getMockImplementation()!
    let respond: (res: Response) => void = () => {}
    vi.mocked(globalThis.fetch).mockImplementation((url, init) => {
      if (!url.toString().includes('/predictions') || init?.method !== 'PUT') return api(url, init)
      return new Promise<Response>((resolve) => {
        respond = resolve
      })
    })
    const user = userEvent.setup()
    renderTab()

    // Salva 2×1 no jogo da rodada 1, e o PUT fica pendente.
    await user.type(await screen.findByLabelText('Placar Brasil'), '2')
    await user.type(screen.getByLabelText('Placar Argentina'), '1')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    // Troca de rodada com o envio pendente, volta e muda para 3×1.
    await user.click(screen.getByRole('button', { name: 'Próxima rodada' }))
    await user.click(screen.getByRole('button', { name: 'Rodada anterior' }))
    expect(screen.getByLabelText('Placar Brasil')).toHaveValue(2)
    await user.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))

    // A resposta do 2×1 chega por último.
    await act(async () => {
      respond(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })

    expect(screen.getByLabelText('Placar Brasil')).toHaveValue(3)
    expect(screen.getByLabelText('Placar Argentina')).toHaveValue(1)
    expect(screen.getByText('alterado, não salvo')).toBeInTheDocument()
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(KEY)!).scores.m1.value).toEqual({
        home: '3',
        away: '1',
      }),
    )
  })
})
