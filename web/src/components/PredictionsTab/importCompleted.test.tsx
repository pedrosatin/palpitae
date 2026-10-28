import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GroupTabContent from '../../pages/GroupDetailPage/GroupTabContent'
import type { GroupDetail } from '../../pages/GroupDetailPage/types'
import { makeMatch } from '../matchFixtures'
import PredictionsTab from './PredictionsTab'
import { usePredictionsTab } from './usePredictionsTab'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

function setup({ imported = 1, failed = false, refetchFailed = false } = {}) {
  const completed = new Set<string>()
  let posts = 0
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const path = String(url)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (path.includes('/matches'))
      return json({ matches: [makeMatch({ id: 'm', round: '1' })], default_round: '1' })
    if (path.includes('/groups'))
      return json({ groups: [{ id: 'source', name: 'Origem', competition_id: 'c' }] })
    if (path.includes('/predictions/import')) {
      posts++
      if (failed) return json({ error: 'Falha ao importar' }, 500)
      if (imported > 0) completed.add(JSON.parse(String(init?.body)).target_group_id)
      return json({ imported })
    }
    if (path.includes('/predictions?')) {
      if (refetchFailed && posts) return json({ error: 'Indisponível' }, 503)
      const group = new URL(path).searchParams.get('group_id')!
      return json({ predictions: [], import_completed: completed.has(group) })
    }
    throw new Error(path)
  })
  return { completed, fetchMock, posts: () => posts }
}

describe('Barra de importação', () => {
  it('recolhe após sucesso, mantém confirmação, permite repetir e persiste ao remontar', async () => {
    const state = setup()
    const user = userEvent.setup()
    const view = render(<PredictionsTab groupId="target" competitionId="c" />)
    await user.click(await screen.findByRole('button', { name: 'Importar' }))
    expect(await screen.findByRole('button', { name: 'Importar novamente' })).toBeInTheDocument()
    expect(screen.queryByText('Importar palpites de:')).not.toBeInTheDocument()
    expect(screen.getByText('Palpites importados.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Importar novamente' }))
    await user.click(screen.getByRole('button', { name: 'Importar' }))
    expect(state.posts()).toBe(2)
    view.unmount()
    const next = render(<PredictionsTab groupId="target" competitionId="c" />)
    await screen.findByRole('button', { name: 'Importar novamente' })
    expect(screen.queryByText('Importar palpites de:')).not.toBeInTheDocument()
    next.rerender(<PredictionsTab groupId="other" competitionId="c" />)
    await screen.findByText('Importar palpites de:')
    next.unmount()
    state.completed.clear() // Nova conta, sem conclusão no backend.
    render(<PredictionsTab groupId="target" competitionId="c" />)
    await screen.findByText('Importar palpites de:')
  })

  it.each([{ imported: 0 }, { failed: true }])(
    'mantém seletor com resultado $imported / falha $failed',
    async (options) => {
      setup(options)
      const user = userEvent.setup()
      render(<PredictionsTab groupId="target" competitionId="c" />)
      await user.click(await screen.findByRole('button', { name: 'Importar' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Importar' })).toBeEnabled())
      expect(screen.getByText('Importar palpites de:')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Importar novamente' })).not.toBeInTheDocument()
    },
  )

  it('informa sucesso gravado e falha no refetch, preservando palpites e drafts locais', async () => {
    setup({ refetchFailed: true })
    const { result } = renderHook(() => usePredictionsTab('target', 'c'))
    await waitFor(() => expect(result.current.importSourceId).toBe('source'))
    act(() => result.current.handleDraftChange('m', '4', '2'))
    await act(() => result.current.handleImport())
    expect(result.current.importCompleted).toBe(true)
    expect(result.current.predictions.size).toBe(0)
    expect(result.current.drafts.get('m')).toEqual({ home: '4', away: '2' })
    expect(result.current.importFeedback?.message).toContain(
      'Não foi possível atualizar os palpites na tela',
    )
  })

  it('descarta POST antigo após trocar grupo e após desmontar', async () => {
    const { fetchMock } = setup()
    const original = fetchMock.getMockImplementation()!
    let finish!: (response: Response) => void
    fetchMock.mockImplementation((url, init) =>
      String(url).includes('/predictions/import')
        ? new Promise<Response>((resolve) => {
            finish = resolve
          })
        : original(url, init),
    )
    const view = renderHook(({ group }) => usePredictionsTab(group, 'c'), {
      initialProps: { group: 'target' },
    })
    await waitFor(() => expect(view.result.current.importSourceId).toBe('source'))
    let pending!: Promise<void>
    act(() => {
      pending = view.result.current.handleImport()
    })
    view.rerender({ group: 'other' })
    await act(async () => {
      finish(new Response(JSON.stringify({ imported: 1 })))
      await pending
    })
    expect(view.result.current.importCompleted).toBe(false)
    expect(view.result.current.importFeedback).toBeNull()
    await waitFor(() => expect(view.result.current.importSourceId).toBe('source'))
    act(() => {
      pending = view.result.current.handleImport()
    })
    view.unmount()
    await act(async () => {
      finish(new Response(JSON.stringify({ imported: 1 })))
      await pending
    })
    const next = renderHook(() => usePredictionsTab('other', 'c'))
    await waitFor(() => expect(next.result.current.loading).toBe(false))
    expect(next.result.current.importCompleted).toBe(false)
  })

  it('descarta listagem e POST pendentes ao trocar a conta no mesmo grupo', async () => {
    const { fetchMock } = setup()
    const original = fetchMock.getMockImplementation()!
    const pending: Array<(response: Response) => void> = []
    fetchMock.mockImplementation((url, init) =>
      String(url).includes('/predictions?')
        ? new Promise<Response>((resolve) => {
            pending.push(resolve)
          })
        : original(url, init),
    )
    const group = { competition_id: 'c', points_exact: 3 } as GroupDetail
    const content = (userId: string) => (
      <GroupTabContent
        activeTab="predictions"
        groupId="target"
        group={group}
        showStandings={false}
        isAdmin={false}
        userId={userId}
      />
    )
    const view = render(content('a'))
    await waitFor(() => expect(pending).toHaveLength(1))
    view.rerender(content('b'))
    await waitFor(() => expect(pending).toHaveLength(2))
    await act(async () => {
      pending[1](new Response(JSON.stringify({ predictions: [], import_completed: false })))
    })
    await screen.findByRole('button', { name: 'Importar' })
    await act(async () => {
      pending[0](new Response(JSON.stringify({ predictions: [], import_completed: true })))
    })
    expect(screen.queryByRole('button', { name: 'Importar novamente' })).not.toBeInTheDocument()

    let finish!: (response: Response) => void
    fetchMock.mockImplementation((url, init) =>
      String(url).includes('/predictions/import')
        ? new Promise<Response>((resolve) => {
            finish = resolve
          })
        : original(url, init),
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Importar' }))
    view.rerender(content('c'))
    await screen.findByRole('button', { name: 'Importar' })
    await act(async () => {
      finish(new Response(JSON.stringify({ imported: 1 })))
    })
    expect(screen.queryByRole('button', { name: 'Importar novamente' })).not.toBeInTheDocument()
    expect(screen.queryByText(/importado\(s\) com sucesso/)).not.toBeInTheDocument()
  })

  it('descarta atualização de palpites da importação após trocar de grupo', async () => {
    const { fetchMock } = setup()
    const original = fetchMock.getMockImplementation()!
    const view = renderHook(({ group }) => usePredictionsTab(group, 'c'), {
      initialProps: { group: 'target' },
    })
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    await waitFor(() => expect(view.result.current.importSourceId).toBe('source'))
    let finish!: (response: Response) => void
    fetchMock.mockImplementation((url, init) =>
      String(url).includes('/predictions?group_id=target')
        ? new Promise<Response>((resolve) => {
            finish = resolve
          })
        : original(url, init),
    )
    let importing!: Promise<void>
    act(() => {
      importing = view.result.current.handleImport()
    })
    await waitFor(() => expect(view.result.current.importCompleted).toBe(true))
    view.rerender({ group: 'other' })
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    await act(async () => {
      finish(new Response(JSON.stringify({ predictions: [{ match_id: 'old' }] })))
      await importing
    })
    expect(view.result.current.predictions.size).toBe(0)
    expect(view.result.current.importCompleted).toBe(false)
    expect(view.result.current.importFeedback).toBeNull()
  })

  describe('com import_sources', () => {
    function mockSources(body: {
      import_completed: boolean
      import_sources: Record<string, string[]>
      predictions: Array<{ match_id: string }>
    }) {
      const posts: unknown[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const path = String(url)
        const json = (data: unknown) => new Response(JSON.stringify(data))
        if (path.includes('/predictions/import')) {
          posts.push(JSON.parse(String(init?.body)))
          return json({ imported: 1 })
        }
        if (path.includes('/matches'))
          return json({
            matches: [
              makeMatch({ id: 'm', round: '1' }),
              makeMatch({ id: 'm2', round: '2' }),
              makeMatch({ id: 'done', round: '1', status: 'finished' }),
            ],
            default_round: '2',
          })
        if (path.includes('/groups'))
          return json({
            groups: [
              { id: 'source', name: 'Origem', competition_id: 'c' },
              { id: 'empty', name: 'Vazio', competition_id: 'c' },
            ],
          })
        if (path.includes('/predictions?')) return json(body)
        throw new Error(path)
      })
      return posts
    }

    it('reabre o seletor quando a rodada nova tem palpites em outro grupo', async () => {
      const posts = mockSources({
        import_completed: true,
        // `done` travou depois da resposta da API e não entra na contagem.
        import_sources: { source: ['m', 'm2', 'done'] },
        predictions: [{ match_id: 'm' }],
      })
      render(<PredictionsTab groupId="target" competitionId="c" />)
      expect(await screen.findByText('Novos palpites para importar de:')).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Origem (1 palpite novo)' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /Vazio/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Importar novamente' })).not.toBeInTheDocument()
      await userEvent.setup().click(screen.getByRole('button', { name: 'Importar' }))
      await waitFor(() =>
        expect(posts).toEqual([
          { source_group_id: 'source', target_group_id: 'target', only_missing: true },
        ]),
      )
    })

    it('mantém recolhido quando nada falta e sobrescreve no Importar novamente', async () => {
      const posts = mockSources({
        import_completed: true,
        import_sources: { source: ['m'] },
        predictions: [{ match_id: 'm' }],
      })
      render(<PredictionsTab groupId="target" competitionId="c" />)
      await screen.findByRole('button', { name: 'Importar novamente' })
      await userEvent.setup().click(screen.getByRole('button', { name: 'Importar novamente' }))
      expect(screen.getByText('Importar palpites de:')).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Vazio' })).toBeInTheDocument()
      await userEvent.setup().click(screen.getByRole('button', { name: 'Importar' }))
      await waitFor(() =>
        expect(posts).toEqual([{ source_group_id: 'source', target_group_id: 'target' }]),
      )
    })

    it('sem pendências nem importação anterior, recolhe num link que sobrescreve', async () => {
      const posts = mockSources({ import_completed: false, import_sources: {}, predictions: [] })
      render(<PredictionsTab groupId="target" competitionId="c" />)
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Importar de outro grupo' }))
      expect(screen.getByText('Importar palpites de:')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Importar' }))
      await waitFor(() =>
        expect(posts).toEqual([{ source_group_id: 'source', target_group_id: 'target' }]),
      )
    })

    it('primeira importação com pendências preenche só o que falta', async () => {
      const posts = mockSources({
        import_completed: false,
        import_sources: { source: ['m'], empty: ['m', 'm2'] },
        predictions: [],
      })
      render(<PredictionsTab groupId="target" competitionId="c" />)
      expect(await screen.findByText('Importar palpites de:')).toBeInTheDocument()
      // O grupo com mais pendências vem selecionado, mesmo não sendo o primeiro de /groups.
      expect(screen.getByRole('option', { name: 'Vazio (2 palpites novos)' })).toHaveProperty(
        'selected',
        true,
      )
      await userEvent.setup().click(screen.getByRole('button', { name: 'Importar' }))
      await waitFor(() =>
        expect(posts).toEqual([
          { source_group_id: 'empty', target_group_id: 'target', only_missing: true },
        ]),
      )
    })

    it('a contagem cai quando o palpite é salvo no próprio grupo', async () => {
      mockSources({ import_completed: false, import_sources: { source: ['m2'] }, predictions: [] })
      const { result } = renderHook(() => usePredictionsTab('target', 'c'))
      await waitFor(() => expect(result.current.importOptions).toHaveLength(1))
      expect(result.current.importOptions[0]).toMatchObject({ id: 'source', missing: 1 })
      act(() => result.current.handleSaved('m2', 1, 0, null))
      expect(result.current.importPending).toBe(false)
      expect(result.current.importOptions).toEqual([])
    })
  })
})
