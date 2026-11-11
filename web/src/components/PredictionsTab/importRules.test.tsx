import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeMatch } from '../matchFixtures'
import PredictionsTab from './PredictionsTab'
import { usePredictionsTab } from './usePredictionsTab'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const prediction = (matchId: string, home: number, away: number) => ({
  id: `p-${matchId}`,
  match_id: matchId,
  predicted_home_score: home,
  predicted_away_score: away,
  predicted_penalty_winner: null,
  points_awarded: null,
  locked: false,
})

/** Dois jogos abertos e um grupo irmão `source` que palpitou os dois. */
function setup(
  siblings: unknown[] = [{ id: 'source', name: 'Origem', competition_id: 'c' }],
  initial: unknown[] = [],
) {
  const pendingGets: Array<(response: Response) => void> = []
  let holdGets = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const path = String(url)
    if (path.includes('/matches'))
      return json({
        matches: [makeMatch({ id: 'm', round: '1' }), makeMatch({ id: 'm2', round: '1' })],
        default_round: '1',
      })
    if (path.includes('/groups')) return json({ groups: siblings })
    if (path.includes('/predictions/import')) return json({ imported: 2, locked_skipped: 0 })
    if (path.includes('/predictions?')) {
      if (holdGets) return new Promise<Response>((resolve) => pendingGets.push(resolve))
      return json({ predictions: initial, import_sources: { source: ['m', 'm2'] } })
    }
    throw new Error(path)
  })
  return {
    pendingGets,
    hold: () => {
      holdGets = true
    },
  }
}

describe('Leitura antiga depois de uma escrita', () => {
  it('a listagem pedida pela importação não desfaz o palpite salvo enquanto ela chegava', async () => {
    const state = setup()
    const { result } = renderHook(() => usePredictionsTab('target', 'c'))
    await waitFor(() => expect(result.current.importSourceId).toBe('source'))

    state.hold()
    let importing!: Promise<void>
    act(() => {
      importing = result.current.handleImport()
    })
    await waitFor(() => expect(state.pendingGets).toHaveLength(1))
    // A listagem já saiu com o importado (2x1). O card salva 3x1 antes de ela chegar.
    act(() => result.current.handleSaved('m', 3, 1, null))
    await act(async () => {
      state.pendingGets[0](
        json({
          predictions: [prediction('m', 2, 1), prediction('m2', 0, 0)],
          import_sources: { source: ['m', 'm2'] },
        }),
      )
      await importing
    })

    expect(result.current.predictions.get('m')).toMatchObject({
      predicted_home_score: 3,
      predicted_away_score: 1,
    })
    // O que a importação trouxe para os outros jogos entra na tela.
    expect(result.current.predictions.get('m2')).toMatchObject({
      predicted_home_score: 0,
      predicted_away_score: 0,
    })
  })
})

describe('Leitura antiga com palpites preexistentes', () => {
  it('conserva só o jogo salvo depois que a listagem saiu e mostra o importado nos outros', async () => {
    const state = setup(undefined, [prediction('m', 1, 1), prediction('m2', 0, 0)])
    const { result } = renderHook(() => usePredictionsTab('target', 'c'))
    await waitFor(() => expect(result.current.otherGroups).toHaveLength(1))
    // Os dois jogos já têm palpite: só o seletor completo sobrescreve.
    act(() => result.current.setImportExpanded(true))
    await waitFor(() => expect(result.current.importSourceId).toBe('source'))

    state.hold()
    let importing!: Promise<void>
    act(() => {
      importing = result.current.handleImport()
    })
    await waitFor(() => expect(state.pendingGets).toHaveLength(1))
    // A importação sobrescreveu os dois (2x1 e 4x2). O card salva 3x1 só em `m`.
    act(() => result.current.handleSaved('m', 3, 1, null))
    await act(async () => {
      state.pendingGets[0](
        json({
          predictions: [prediction('m', 2, 1), prediction('m2', 4, 2)],
          import_sources: { source: ['m', 'm2'] },
        }),
      )
      await importing
    })

    expect(result.current.predictions.get('m')).toMatchObject({
      predicted_home_score: 3,
      predicted_away_score: 1,
    })
    expect(result.current.predictions.get('m2')).toMatchObject({
      predicted_home_score: 4,
      predicted_away_score: 2,
    })
  })
})

describe('Barra de importação, modo do grupo', () => {
  const siblings = [
    { id: 'source', name: 'Só vencedor', competition_id: 'c', points_exact: 0 },
    { id: 'exact', name: 'Placar', competition_id: 'c', points_exact: 3 },
  ]

  it('grupo de placar exato não oferece importar de grupo só vencedor', async () => {
    setup(siblings)
    const { result } = renderHook(() =>
      usePredictionsTab('target', 'c', undefined, null, undefined, 3),
    )
    // O seletor completo, aberto pelo link, lista só o grupo de placar.
    act(() => result.current.setImportExpanded(true))
    await waitFor(() => expect(result.current.importOptions.map((g) => g.id)).toEqual(['exact']))
    act(() => result.current.setImportExpanded(false))
    // Só o grupo só vencedor tem palpite faltando aqui, e ele não vira pendência.
    expect(result.current.importOptions).toEqual([])
    expect(result.current.importPending).toBe(false)
  })

  it('grupo só vencedor oferece importar dos dois modos', async () => {
    setup(siblings)
    render(<PredictionsTab groupId="target" competitionId="c" pointsExact={0} />)
    expect(await screen.findByRole('option', { name: /Só vencedor/ })).toBeInTheDocument()
  })

  it('sem grupo compatível, não mostra o link de importação', async () => {
    setup([siblings[0]])
    const view = renderHook(() => usePredictionsTab('target', 'c', undefined, null, undefined, 3))
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    // A lista de grupos vem do cache preenchido pelo hook acima.
    render(<PredictionsTab groupId="target" competitionId="c" pointsExact={3} />)
    await screen.findByText(/Rodada/)
    await act(async () => {})
    expect(screen.queryByText('Importar palpites de:')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Importar de outro grupo' }),
    ).not.toBeInTheDocument()
  })
})
