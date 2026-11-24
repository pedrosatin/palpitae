import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PredictionsTab from './PredictionsTab'
import { resetReplicateStatus } from '../../lib/replicateStatus'
import { makeMatch } from '../matchFixtures'
import type { Match, Prediction } from '../MatchCard/types'
import { createTestQueryClient, renderWithQuery as render } from '../../test-utils'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))

afterEach(() => {
  localStorage.clear()
  resetReplicateStatus()
  vi.restoreAllMocks()
})

function savedPick(matchId: string, home = 1, away = 0): Prediction {
  return {
    id: `p-${matchId}`,
    match_id: matchId,
    predicted_home_score: home,
    predicted_away_score: away,
    points_awarded: 0,
    locked: 0,
    updated_at: '',
  }
}

function setupApi(
  matches: Match[],
  initialPredictions: Prediction[] = [],
  handlers: {
    putSingle?: () => Promise<Response>
    putBulk?: () => Promise<Response>
  } = {},
) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = url.toString()
    if (u.includes('/matches')) {
      return new Response(JSON.stringify({ matches, default_round: '1' }), { status: 200 })
    }
    if (u.includes('/predictions/bulk') && init?.method === 'PUT') {
      if (handlers.putBulk) return handlers.putBulk()
      return new Response(JSON.stringify({ saved: [] }), { status: 200 })
    }
    if (u.includes('/predictions') && init?.method === 'PUT') {
      if (handlers.putSingle) return handlers.putSingle()
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    if (u.includes('/predictions')) {
      return new Response(JSON.stringify({ predictions: initialPredictions }), { status: 200 })
    }
    if (u.includes('/groups')) {
      return new Response(JSON.stringify({ groups: [] }), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${u}`)
  })
}

const m1 = makeMatch({ id: 'm1', home_team_name: 'Flamengo', away_team_name: 'Palmeiras' })
const m2 = makeMatch({ id: 'm2', home_team_name: 'Corinthians', away_team_name: 'Bahia' })

describe('PredictionsTab – palpite otimista', () => {
  it('mostra o palpite salvo e atualiza o progresso antes da resposta e invalida grupos ao confirmar', async () => {
    let finish!: (res: Response) => void
    setupApi([m1, m2], [], {
      putSingle: () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    })
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const user = userEvent.setup()

    render(<PredictionsTab groupId="g1" competitionId="c1" userId="u1" />, { queryClient })
    await screen.findByText('Flamengo')
    expect(screen.getByRole('status')).toHaveTextContent('0 de 2 palpitados')

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    await user.click(screen.getByRole('button', { name: 'Diminuir placar Palmeiras' }))
    await user.click(screen.getAllByRole('button', { name: 'Salvar' })[0])

    expect(screen.getByText('palpite salvo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvo' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('1 de 2 palpitados')
    expect(invalidateSpy).not.toHaveBeenCalled()

    await act(async () => {
      finish(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['groups', 'list'],
        refetchType: 'none',
      }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['groups', 'predictions'],
      refetchType: 'none',
    })
  })

  it('devolve o card e o progresso ao valor anterior quando a API recusa e não invalida grupos', async () => {
    let finish!: (res: Response) => void
    setupApi([m1, m2], [savedPick('m1', 1, 0)], {
      putSingle: () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    })
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const user = userEvent.setup()

    render(<PredictionsTab groupId="g1" competitionId="c1" userId="u1" />, { queryClient })
    await screen.findByText('Flamengo')

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    await user.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(screen.getByLabelText('Placar Flamengo')).toHaveValue(2)
    expect(screen.getByText('palpite salvo')).toBeInTheDocument()

    await act(async () => {
      finish(new Response(JSON.stringify({ error: 'Jogo já começou' }), { status: 409 }))
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Jogo já começou')
    expect(screen.getByLabelText('Placar Flamengo')).toHaveValue(1)
    expect(screen.getByLabelText('Placar Palmeiras')).toHaveValue(0)
    expect(screen.getByText('palpite salvo')).toBeInTheDocument()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('não sobrescreve rascunho digitado durante o envio nem no retorno OK nem no rollback', async () => {
    let finish!: (res: Response) => void
    setupApi([m1], [savedPick('m1', 1, 0)], {
      putSingle: () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    })
    const user = userEvent.setup()

    render(<PredictionsTab groupId="g1" competitionId="c1" userId="u1" />)
    await screen.findByText('Flamengo')

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    await user.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(screen.getByLabelText('Placar Flamengo')).toHaveValue(2)

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    expect(screen.getByLabelText('Placar Flamengo')).toHaveValue(3)
    expect(screen.getByText('alterado, não salvo')).toBeInTheDocument()

    await act(async () => {
      finish(new Response(JSON.stringify({ error: 'Jogo já começou' }), { status: 409 }))
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Jogo já começou')
    expect(screen.getByLabelText('Placar Flamengo')).toHaveValue(3)
    expect(screen.getByLabelText('Placar Palmeiras')).toHaveValue(0)
    expect(screen.getByText('alterado, não salvo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeEnabled()
  })

  it('preserva rascunho incompleto digitado enquanto um salvamento ainda está pendente', async () => {
    let finish!: (res: Response) => void
    setupApi([m1], [savedPick('m1', 1, 0)], {
      putSingle: () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    })
    const user = userEvent.setup()

    render(<PredictionsTab groupId="g1" competitionId="c1" userId="u1" />)
    await screen.findByText('Flamengo')

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    await user.click(screen.getByRole('button', { name: 'Atualizar' }))

    const awayInput = screen.getByLabelText('Placar Palmeiras')
    await user.clear(awayInput)
    expect(awayInput).toHaveValue(null)
    expect(screen.getByText('alterado, não salvo')).toBeInTheDocument()

    await act(async () => {
      finish(new Response(JSON.stringify({ error: 'Falha' }), { status: 500 }))
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha')
    expect(screen.getByLabelText('Placar Flamengo')).toHaveValue(2)
    expect(screen.getByLabelText('Placar Palmeiras')).toHaveValue(null)
    expect(screen.getByText('alterado, não salvo')).toBeInTheDocument()
  })

  it('no "Salvar todos" com aceitação parcial, mantém os de saved, reverte os recusados e atualiza o progresso', async () => {
    let finish!: (res: Response) => void
    setupApi([m1, m2], [savedPick('m2', 1, 0)], {
      putBulk: () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    })
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const user = userEvent.setup()

    render(<PredictionsTab groupId="g1" competitionId="c1" userId="u1" />, { queryClient })
    await screen.findByText('Flamengo')
    expect(screen.getByRole('status')).toHaveTextContent('1 de 2 palpitados')

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    await user.click(screen.getByRole('button', { name: 'Diminuir placar Palmeiras' }))
    await user.click(screen.getByRole('button', { name: 'Aumentar placar Corinthians' }))
    await user.click(screen.getByRole('button', { name: 'Salvar todos (2)' }))

    expect(screen.getAllByText('palpite salvo')).toHaveLength(2)
    expect(screen.getByRole('status')).toHaveTextContent('2 de 2 palpitados')
    expect(invalidateSpy).not.toHaveBeenCalled()

    await act(async () => {
      finish(new Response(JSON.stringify({ saved: ['m1'], locked: ['m2'] }), { status: 200 }))
    })
    expect(
      await screen.findByText(
        '1 palpite salvo. 1 jogo já bloqueado ficou de fora. Recarregue a página para atualizar os jogos.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Placar Flamengo')).toHaveValue(1)
    expect(screen.getByLabelText('Placar Palmeiras')).toHaveValue(0)
    expect(screen.getByLabelText('Placar Corinthians')).toHaveValue(1)
    expect(screen.getByLabelText('Placar Bahia')).toHaveValue(0)
    expect(screen.getByRole('status')).toHaveTextContent('2 de 2 palpitados')
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['groups', 'list'],
      refetchType: 'none',
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['groups', 'predictions'],
      refetchType: 'none',
    })
  })

  it('no "Salvar todos", jogo sem palpite recusado volta a ficar vazio e reduz o progresso', async () => {
    let finish!: (res: Response) => void
    setupApi([m1, m2], [], {
      putBulk: () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    })
    const user = userEvent.setup()

    render(<PredictionsTab groupId="g1" competitionId="c1" userId="u1" />)
    await screen.findByText('Flamengo')

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    await user.click(screen.getByRole('button', { name: 'Diminuir placar Palmeiras' }))
    await user.click(screen.getByRole('button', { name: 'Aumentar placar Corinthians' }))
    await user.click(screen.getByRole('button', { name: 'Diminuir placar Bahia' }))
    await user.click(screen.getByRole('button', { name: 'Salvar todos (2)' }))

    expect(screen.getByRole('status')).toHaveTextContent('2 de 2 palpitados')

    await act(async () => {
      finish(new Response(JSON.stringify({ saved: ['m1'], locked: ['m2'] }), { status: 200 }))
    })
    expect(
      await screen.findByText(
        '1 palpite salvo. 1 jogo já bloqueado ficou de fora. Recarregue a página para atualizar os jogos.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Placar Flamengo')).toHaveValue(1)
    expect(screen.getByLabelText('Placar Palmeiras')).toHaveValue(0)
    expect(screen.getByLabelText('Placar Corinthians')).toHaveValue(null)
    expect(screen.getByLabelText('Placar Bahia')).toHaveValue(null)
    expect(screen.getByText('sem palpite')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 de 2 palpitados')
  })

  it('falha total no "Salvar todos" reverte todos os jogos não editados no meio e não invalida grupos', async () => {
    let finish!: (res: Response) => void
    setupApi([m1, m2], [], {
      putBulk: () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    })
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const user = userEvent.setup()

    render(<PredictionsTab groupId="g1" competitionId="c1" userId="u1" />, { queryClient })
    await screen.findByText('Flamengo')

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    await user.click(screen.getByRole('button', { name: 'Diminuir placar Palmeiras' }))
    await user.click(screen.getByRole('button', { name: 'Aumentar placar Corinthians' }))
    await user.click(screen.getByRole('button', { name: 'Diminuir placar Bahia' }))
    await user.click(screen.getByRole('button', { name: 'Salvar todos (2)' }))

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    expect(screen.getByLabelText('Placar Flamengo')).toHaveValue(2)

    await act(async () => {
      finish(new Response(JSON.stringify({ error: 'Erro ao salvar palpites' }), { status: 500 }))
    })
    expect(await screen.findByText('Erro ao salvar palpites')).toBeInTheDocument()
    expect(screen.getByLabelText('Placar Flamengo')).toHaveValue(2)
    expect(screen.getByLabelText('Placar Palmeiras')).toHaveValue(0)
    expect(screen.getByLabelText('Placar Corinthians')).toHaveValue(null)
    expect(screen.getByLabelText('Placar Bahia')).toHaveValue(null)
    expect(screen.getByRole('button', { name: 'Salvar todos (1)' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('0 de 2 palpitados')
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('envios concorrentes em ordem invertida no card da aba abortam o anterior, não replicam placar velho e mantêm rollback em 2×0', async () => {
    const puts: Array<{
      resolve: (res: Response) => void
      reject: (err: unknown) => void
      signal?: AbortSignal
    }> = []
    const replicateCalls: Array<{ match_ids: string[] }> = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = url.toString()
      if (u.includes('/matches')) {
        return new Response(JSON.stringify({ matches: [m1], default_round: '1' }), { status: 200 })
      }
      if (u.includes('/predictions/replicate')) {
        replicateCalls.push(JSON.parse(init!.body as string) as { match_ids: string[] })
        return new Response(
          JSON.stringify({
            groups: [{ group_id: 'g2', saved: 1, replaced: 0 }],
            skipped_groups: [],
            locked_matches: [],
            missing_matches: [],
          }),
          { status: 200 },
        )
      }
      if (u.includes('/predictions') && init?.method === 'PUT') {
        return new Promise<Response>((resolve, reject) => {
          puts.push({ resolve, reject, signal: init?.signal ?? undefined })
        })
      }
      if (u.includes('/predictions')) {
        return new Response(JSON.stringify({ predictions: [] }), { status: 200 })
      }
      if (u.includes('/groups')) {
        return new Response(
          JSON.stringify({
            groups: [
              { id: 'g1', name: 'Bolão Principal', competition_id: 'c1', competition_status: 'ongoing' },
              { id: 'g2', name: 'Bolão Alfa', competition_id: 'c1', competition_status: 'ongoing' },
            ],
          }),
          { status: 200 },
        )
      }
      throw new Error(`Unexpected fetch: ${u}`)
    })

    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const user = userEvent.setup()

    render(<PredictionsTab groupId="g1" competitionId="c1" userId="u1" />, { queryClient })
    await screen.findByText('Flamengo')
    await user.click(await screen.findByLabelText(/Aplicar também em/))

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    await user.click(screen.getByRole('button', { name: 'Diminuir placar Palmeiras' }))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(puts).toHaveLength(1)
    expect(puts[0].signal?.aborted).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    await user.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(puts).toHaveLength(2)
    expect(puts[0].signal?.aborted).toBe(true)

    await act(async () => {
      puts[1].resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    await waitFor(() => expect(replicateCalls).toHaveLength(1))
    await waitFor(() =>
      expect(screen.queryByText('Aplicando nos outros grupos...')).not.toBeInTheDocument(),
    )
    const invalidationsAfterSecond = invalidateSpy.mock.calls.length

    await act(async () => {
      puts[0].resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    expect(replicateCalls).toHaveLength(1)
    expect(invalidateSpy.mock.calls.length).toBe(invalidationsAfterSecond)

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    await user.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(puts).toHaveLength(3)

    await act(async () => {
      puts[2].resolve(new Response(JSON.stringify({ error: 'Jogo já começou' }), { status: 409 }))
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Jogo já começou')
    expect(screen.getByLabelText('Placar Flamengo')).toHaveValue(2)
    expect(screen.getByLabelText('Placar Palmeiras')).toHaveValue(0)
  })

  it('falha do envio anterior enquanto o novo está pendente não encerra saving nem reverte o placar na aba', async () => {
    const puts: Array<{
      resolve: (res: Response) => void
      reject: (err: unknown) => void
    }> = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = url.toString()
      if (u.includes('/matches')) {
        return new Response(JSON.stringify({ matches: [m1], default_round: '1' }), { status: 200 })
      }
      if (u.includes('/predictions') && init?.method === 'PUT') {
        return new Promise<Response>((resolve, reject) => {
          puts.push({ resolve, reject })
        })
      }
      if (u.includes('/predictions')) {
        return new Response(JSON.stringify({ predictions: [] }), { status: 200 })
      }
      if (u.includes('/groups')) {
        return new Response(JSON.stringify({ groups: [] }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${u}`)
    })

    const user = userEvent.setup()
    render(<PredictionsTab groupId="g1" competitionId="c1" userId="u1" />)
    await screen.findByText('Flamengo')

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    await user.click(screen.getByRole('button', { name: 'Diminuir placar Palmeiras' }))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await user.click(screen.getByRole('button', { name: 'Aumentar placar Flamengo' }))
    await user.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(puts).toHaveLength(2)

    const card = screen.getByRole('group', { name: /^Flamengo contra Palmeiras/ })
    expect(card).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      puts[0].reject(new DOMException('The operation was aborted.', 'AbortError'))
    })
    expect(card).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Placar Flamengo')).toHaveValue(2)
    expect(screen.getByLabelText('Placar Palmeiras')).toHaveValue(0)

    await act(async () => {
      puts[1].resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    expect(card).toHaveAttribute('aria-busy', 'false')
  })
})

