import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { replicatePreferenceKey } from '../../lib/replicatePreference'
import { resetReplicateStatus } from '../../lib/replicateStatus'
import { makeMatch } from '../matchFixtures'
import type { Prediction } from '../MatchCard'
import PredictionsTab from './PredictionsTab'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))

function saved(): Prediction {
  return {
    id: 'p1',
    match_id: 'm1',
    predicted_home_score: 1,
    predicted_away_score: 0,
    points_awarded: 0,
    locked: 0,
    updated_at: '2026-01-01T00:00:00Z',
  }
}

type Replicate = { source_group_id: string; target_group_ids: string[]; match_ids: string[] }

function mockApi({
  siblings = [
    { id: 'g2', name: 'Bolão Alfa', competition_id: 'c1', competition_status: 'ongoing' },
    { id: 'g3', name: 'Bolão Beta', competition_id: 'c1', competition_status: 'ongoing' },
    { id: 'gx', name: 'Outro campeonato', competition_id: 'c2', competition_status: 'ongoing' },
  ] as Record<string, unknown>[],
  response = {
    groups: [
      { group_id: 'g2', saved: 1, replaced: 1 },
      { group_id: 'g3', saved: 1, replaced: 0 },
    ],
    skipped_groups: [],
    locked_matches: [],
    missing_matches: [],
  } as Record<string, unknown>,
  replicateFails = 0,
  matches = [makeMatch({ id: 'm1' })],
  /** Segura a resposta da replicação até `release()`. */
  holdReplicate = false,
  /** Segura a resposta do "Salvar todos" até `release()`. */
  holdBulk = false,
} = {}) {
  const replicateCalls: Replicate[] = []
  const held: (() => void)[] = []
  let failuresLeft = replicateFails
  const json = (body: unknown, ok = true) =>
    Promise.resolve({ ok, json: async () => body } as Response)
  const hold = (respond: () => Promise<Response>) =>
    new Promise<Response>((resolve) => held.push(() => resolve(respond())))
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const u = url.toString()
    if (u.includes('/matches')) return json({ matches, default_round: '1' })
    if (u.includes('/predictions/replicate')) {
      replicateCalls.push(JSON.parse(init!.body as string) as Replicate)
      const fails = failuresLeft > 0
      if (fails) failuresLeft -= 1
      const respond = () => (fails ? json({ error: 'Indisponível' }, false) : json(response))
      return holdReplicate ? hold(respond) : respond()
    }
    if (u.includes('/predictions/bulk')) {
      const respond = () =>
        json({
          saved: (JSON.parse(init!.body as string).predictions as { match_id: string }[]).map(
            (p) => p.match_id,
          ),
        })
      return holdBulk ? hold(respond) : respond()
    }
    if (u.includes('/predictions') && init?.method === 'PUT') return json({ ok: true })
    if (u.includes('/predictions')) return json({ predictions: [saved()] })
    if (u.includes('/groups'))
      return json({ groups: [{ id: 'g1', name: 'Bolão Gama', competition_id: 'c1' }, ...siblings] })
    return Promise.reject(new Error(`Unexpected fetch: ${u}`))
  })
  /** Entrega as respostas seguradas, na ordem em que os pedidos saíram. */
  function release() {
    for (const respond of held.splice(0)) respond()
  }
  return { replicateCalls, release }
}

// StrictMode como no app: a montagem dupla não pode contar como saída do contexto.
function renderTab(pointsExact?: number, groupId = 'g1') {
  return render(
    <StrictMode>
      <PredictionsTab
        key={groupId}
        groupId={groupId}
        competitionId="c1"
        userId="u1"
        pointsExact={pointsExact}
      />
    </StrictMode>,
  )
}

const twoRounds = [makeMatch({ id: 'm1' }), makeMatch({ id: 'm2', round: '2' })]

async function saveCardWithReplicate() {
  await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
  await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
}

async function leaveAndReturn() {
  await userEvent.click(screen.getByRole('button', { name: 'Próxima rodada' }))
  await userEvent.click(screen.getByRole('button', { name: 'Rodada anterior' }))
}

describe('Aplicar o palpite nos outros grupos', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    resetReplicateStatus()
  })
  afterEach(() => localStorage.clear())

  it('lista os outros grupos do mesmo campeonato antes de salvar', async () => {
    mockApi()
    renderTab()
    const option = await screen.findByLabelText('Aplicar também em: Bolão Alfa, Bolão Beta')
    expect(option).not.toBeChecked()
  })

  it('não mostra a opção sem outro grupo ativo do campeonato', async () => {
    mockApi({
      siblings: [
        { id: 'g2', name: 'Encerrado', competition_id: 'c1', competition_status: 'finished' },
        { id: 'gx', name: 'Outro campeonato', competition_id: 'c2' },
      ],
    })
    renderTab()
    await screen.findByRole('button', { name: /^Salvar todos$/i })
    expect(screen.queryByText(/Aplicar também em/)).not.toBeInTheDocument()
  })

  it('desmarcada, salva só neste grupo e não chama a API de replicação', async () => {
    const api = mockApi()
    renderTab()
    await screen.findByLabelText(/Aplicar também em/)
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(await screen.findByRole('button', { name: /Salvar todos \(1\)/i }))
    await screen.findByText('Tudo salvo!')
    expect(api.replicateCalls).toEqual([])
  })

  it('marcada, aplica o jogo salvo no card e diz em quantos grupos salvou', async () => {
    const api = mockApi()
    renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(await screen.findByText(/Salvo em 3 grupos\./)).toBeInTheDocument()
    expect(
      screen.getByText(/Palpite diferente substituído em Bolão Alfa \(1 jogo\)\./),
    ).toBeInTheDocument()
    expect(api.replicateCalls).toEqual([
      { source_group_id: 'g1', target_group_ids: ['g2', 'g3'], match_ids: ['m1'] },
    ])
  })

  it('marcada, aplica os jogos do "Salvar todos" numa chamada só', async () => {
    const api = mockApi()
    renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(await screen.findByRole('button', { name: /Salvar todos \(1\)/i }))
    expect(await screen.findByText(/Salvo em 3 grupos\./)).toBeInTheDocument()
    expect(api.replicateCalls).toHaveLength(1)
    expect(api.replicateCalls[0].match_ids).toEqual(['m1'])
  })

  it('avisa do jogo travado e do grupo que ficou de fora', async () => {
    mockApi({
      response: {
        groups: [{ group_id: 'g2', saved: 1, replaced: 0 }],
        skipped_groups: ['g3'],
        locked_matches: ['m9', 'm8'],
        missing_matches: [],
      },
    })
    renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(
      await screen.findByText(
        'Salvo em 2 grupos. 2 jogos já bloqueados ficaram de fora. Não aplicado em Bolão Beta.',
      ),
    ).toBeInTheDocument()
  })

  it('mostra o erro da replicação sem perder o palpite salvo', async () => {
    mockApi({ replicateFails: 1 })
    renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(
      await screen.findByText(
        'Salvo só neste grupo. Não foi possível aplicar nos outros. Indisponível',
      ),
    ).toBeInTheDocument()
  })

  it('mostra a confirmação na barra fixa de Salvar todos, com aria-live', async () => {
    mockApi()
    renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    const confirmation = await screen.findByText(/Salvo em 3 grupos\./)
    const bar = screen.getByRole('button', { name: /salvar todos|tudo salvo/i }).parentElement
    expect(bar).toContainElement(confirmation)
    expect(confirmation.closest('[aria-live="polite"]')).not.toBeNull()
    const option = screen.getByLabelText(/Aplicar também em/)
    expect(bar).not.toContainElement(option)
  })

  it('oferece tentar de novo com os mesmos jogos depois de uma falha', async () => {
    const api = mockApi({ replicateFails: 1 })
    renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText(/Salvo em 3 grupos\./)).toBeInTheDocument()
    expect(screen.queryByText(/Não foi possível aplicar/)).not.toBeInTheDocument()
    expect(api.replicateCalls).toHaveLength(2)
    expect(api.replicateCalls[1]).toEqual(api.replicateCalls[0])
  })

  it('limita a 10 grupos e explica quantos ficam de fora', async () => {
    const siblings = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      name: `Bolão ${i}`,
      competition_id: 'c1',
      competition_status: 'ongoing',
    }))
    const api = mockApi({ siblings })
    renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    expect(
      screen.getByText(/O limite é de 10 grupos por vez\. 2 grupos ficam de fora\./),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(api.replicateCalls).toHaveLength(1))
    expect(api.replicateCalls[0].target_group_ids).toHaveLength(10)
  })

  it('num grupo só vencedor, não lista os grupos que pontuam o placar exato', async () => {
    mockApi({
      siblings: [
        { id: 'g2', name: 'Bolão Alfa', competition_id: 'c1', points_exact: 3 },
        { id: 'g3', name: 'Bolão Beta', competition_id: 'c1', points_exact: 0 },
      ],
    })
    renderTab(0)
    expect(await screen.findByLabelText('Aplicar também em: Bolão Beta')).toBeInTheDocument()
  })

  it('mantém a confirmação anterior quando outro salvamento chega', async () => {
    mockApi()
    renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await screen.findByText(/Salvo em 3 grupos\./)
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(screen.getAllByText(/Salvo em 3 grupos\./)).toHaveLength(2))
  })

  it('limpa a confirmação ao trocar de rodada', async () => {
    mockApi({
      matches: [makeMatch({ id: 'm1' }), makeMatch({ id: 'm2', round: '2' })],
    })
    renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await screen.findByText(/Salvo em 3 grupos\./)
    await userEvent.click(screen.getByRole('button', { name: 'Próxima rodada' }))
    await waitFor(() => expect(screen.queryByText(/Salvo em 3 grupos\./)).not.toBeInTheDocument())
  })

  it('guarda a escolha por usuário e campeonato e a restaura ao remontar', async () => {
    mockApi()
    const first = renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    expect(localStorage.getItem(replicatePreferenceKey('u1', 'c1'))).toBe('1')
    first.unmount()

    renderTab()
    expect(await screen.findByLabelText(/Aplicar também em/)).toBeChecked()
    await userEvent.click(screen.getByLabelText(/Aplicar também em/))
    await waitFor(() => expect(localStorage.getItem(replicatePreferenceKey('u1', 'c1'))).toBe('0'))
    expect(localStorage.getItem(replicatePreferenceKey('u2', 'c1'))).toBeNull()
  })
  it('resposta que volta depois da troca de rodada fica na rodada de origem', async () => {
    const api = mockApi({
      holdReplicate: true,
      matches: [makeMatch({ id: 'm1' }), makeMatch({ id: 'm2', round: '2' })],
    })
    renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await screen.findByText('Aplicando nos outros grupos...')

    await userEvent.click(screen.getByRole('button', { name: 'Próxima rodada' }))
    expect(screen.queryByText('Aplicando nos outros grupos...')).not.toBeInTheDocument()
    await act(async () => api.release())
    expect(screen.queryByText(/Salvo em 3 grupos\./)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Rodada anterior' }))
    expect(await screen.findByText(/Salvo em 3 grupos\./)).toBeInTheDocument()
    expect(screen.queryByText('Aplicando nos outros grupos...')).not.toBeInTheDocument()
  })

  it('"Salvar todos" que termina depois da troca de rodada confirma na rodada de origem', async () => {
    const api = mockApi({
      holdBulk: true,
      matches: [makeMatch({ id: 'm1' }), makeMatch({ id: 'm2', round: '2' })],
    })
    renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(await screen.findByRole('button', { name: /Salvar todos \(1\)/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Próxima rodada' }))

    await act(async () => api.release())
    await waitFor(() => expect(api.replicateCalls).toHaveLength(1))
    expect(api.replicateCalls[0].match_ids).toEqual(['m1'])
    await act(async () => {})
    expect(screen.queryByText(/Salvo em 3 grupos\./)).not.toBeInTheDocument()
    expect(screen.queryByText('Aplicando nos outros grupos...')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Rodada anterior' }))
    expect(await screen.findByText(/Salvo em 3 grupos\./)).toBeInTheDocument()
  })

  it('falha que volta depois da troca de grupo fica no grupo de origem e a nova tentativa não trava', async () => {
    const api = mockApi({ holdReplicate: true, replicateFails: 1 })
    const origin = renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await screen.findByText('Aplicando nos outros grupos...')
    origin.unmount()

    const other = renderTab(undefined, 'g2')
    await screen.findByLabelText(/Aplicar também em/)
    expect(screen.queryByText('Aplicando nos outros grupos...')).not.toBeInTheDocument()
    await act(async () => api.release())
    expect(screen.queryByText(/Não foi possível aplicar/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
    other.unmount()

    renderTab()
    expect(
      await screen.findByText(
        'Salvo só neste grupo. Não foi possível aplicar nos outros. Indisponível',
      ),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await screen.findByText('Aplicando nos outros grupos...')
    await act(async () => api.release())
    expect(await screen.findByText(/Salvo em 3 grupos\./)).toBeInTheDocument()
    expect(screen.queryByText('Aplicando nos outros grupos...')).not.toBeInTheDocument()
    expect(api.replicateCalls).toHaveLength(2)
    expect(api.replicateCalls[1]).toEqual(api.replicateCalls[0])
  })
  it('confirmação de sucesso sai depois de vista; falha fica até nova tentativa', async () => {
    const api = mockApi({ replicateFails: 1, matches: twoRounds })
    renderTab()
    await saveCardWithReplicate()
    const failure = 'Salvo só neste grupo. Não foi possível aplicar nos outros. Indisponível'
    await screen.findByText(failure)

    await leaveAndReturn()
    expect(await screen.findByText(failure)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText(/Salvo em 3 grupos\./)).toBeInTheDocument()
    expect(screen.queryByText(failure)).not.toBeInTheDocument()

    await leaveAndReturn()
    await screen.findByLabelText(/Aplicar também em/)
    expect(screen.queryByText(/Salvo em 3 grupos\./)).not.toBeInTheDocument()
    expect(api.replicateCalls).toHaveLength(2)
  })

  it('desmarcar a opção em outra rodada apaga a falha da rodada de origem', async () => {
    const api = mockApi({ replicateFails: 1, matches: twoRounds })
    renderTab()
    await saveCardWithReplicate()
    await screen.findByText(/Não foi possível aplicar/)

    await userEvent.click(screen.getByRole('button', { name: 'Próxima rodada' }))
    await userEvent.click(screen.getByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: 'Rodada anterior' }))
    await screen.findByLabelText(/Aplicar também em/)
    expect(screen.queryByText(/Não foi possível aplicar/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
    expect(api.replicateCalls).toHaveLength(1)
  })

  it('desmarcar a opção apaga a confirmação que chegou enquanto a pessoa estava em outra rodada', async () => {
    const api = mockApi({ holdReplicate: true, matches: twoRounds })
    renderTab()
    await saveCardWithReplicate()
    await screen.findByText('Aplicando nos outros grupos...')
    await userEvent.click(screen.getByRole('button', { name: 'Próxima rodada' }))
    await act(async () => api.release())

    await userEvent.click(screen.getByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: 'Rodada anterior' }))
    await screen.findByLabelText(/Aplicar também em/)
    expect(screen.queryByText(/Salvo em 3 grupos\./)).not.toBeInTheDocument()
  })

  it('com a opção desmarcada, a falha que chega depois não oferece "Tentar de novo"', async () => {
    const api = mockApi({ holdReplicate: true, replicateFails: 1 })
    renderTab()
    await saveCardWithReplicate()
    await screen.findByText('Aplicando nos outros grupos...')
    await userEvent.click(screen.getByLabelText(/Aplicar também em/))
    await act(async () => api.release())

    expect(await screen.findByText(/Não foi possível aplicar/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
    expect(api.replicateCalls).toHaveLength(1)
  })
})
