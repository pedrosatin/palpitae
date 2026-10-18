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
})
