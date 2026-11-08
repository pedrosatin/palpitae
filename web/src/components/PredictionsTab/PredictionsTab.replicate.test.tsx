import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { replicatePreferenceKey } from '../../lib/replicatePreference'
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
    { id: 'g2', name: 'Borracharia', competition_id: 'c1', competition_status: 'ongoing' },
    { id: 'g3', name: 'Open the tcheka', competition_id: 'c1', competition_status: 'ongoing' },
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
  replicateFails = false,
} = {}) {
  const replicateCalls: Replicate[] = []
  const json = (body: unknown, ok = true) =>
    Promise.resolve({ ok, json: async () => body } as Response)
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const u = url.toString()
    if (u.includes('/matches'))
      return json({ matches: [makeMatch({ id: 'm1' })], default_round: '1' })
    if (u.includes('/predictions/replicate')) {
      replicateCalls.push(JSON.parse(init!.body as string) as Replicate)
      return replicateFails ? json({ error: 'Indisponível' }, false) : json(response)
    }
    if (u.includes('/predictions/bulk'))
      return json({
        saved: (JSON.parse(init!.body as string).predictions as { match_id: string }[]).map(
          (p) => p.match_id,
        ),
      })
    if (u.includes('/predictions') && init?.method === 'PUT') return json({ ok: true })
    if (u.includes('/predictions')) return json({ predictions: [saved()] })
    if (u.includes('/groups'))
      return json({ groups: [{ id: 'g1', name: 'Realidade', competition_id: 'c1' }, ...siblings] })
    return Promise.reject(new Error(`Unexpected fetch: ${u}`))
  })
  return { replicateCalls }
}

function renderTab() {
  return render(<PredictionsTab groupId="g1" competitionId="c1" userId="u1" />)
}

describe('Aplicar o palpite nos outros grupos', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })
  afterEach(() => localStorage.clear())

  it('lista os outros grupos do mesmo campeonato antes de salvar', async () => {
    mockApi()
    renderTab()
    const option = await screen.findByLabelText('Aplicar também em: Borracharia, Open the tcheka')
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
      screen.getByText(/Palpite diferente substituído em Borracharia \(1 jogo\)\./),
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
        'Salvo em 2 grupos. 2 jogos já travados ficaram de fora. Não aplicado em Open the tcheka.',
      ),
    ).toBeInTheDocument()
  })

  it('mostra o erro da replicação sem perder o palpite salvo', async () => {
    mockApi({ replicateFails: true })
    renderTab()
    await userEvent.click(await screen.findByLabelText(/Aplicar também em/))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(
      await screen.findByText(
        'Salvo neste grupo, mas não foi possível aplicar nos outros. Indisponível',
      ),
    ).toBeInTheDocument()
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
})
