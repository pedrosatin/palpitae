import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PredictionsTab from './PredictionsTab'
import { makeMatch } from '../matchFixtures'
import type { Match, Prediction } from '../MatchCard'
import { draftStorageKey } from '../../lib/predictionDraftStorage'

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

function mockApi(matches: Match[], predictions: Prediction[] = []) {
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
    if (u.includes('/predictions'))
      return Promise.resolve({ ok: true, json: async () => ({ predictions }) } as Response)
    if (u.includes('/groups'))
      return Promise.resolve({ ok: true, json: async () => ({ groups: [] }) } as Response)
    return Promise.reject(new Error(`Unexpected fetch: ${u}`))
  })
}

function renderTab() {
  return render(<PredictionsTab groupId="g1" competitionId="c1" userId="u1" />)
}

function storeDraft(scores: Record<string, { home: string; away: string }>, penalties = {}) {
  localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), scores, penalties }))
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

  it('restaura o placar alterado depois de remontar, com o contador coerente', async () => {
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

  it('ignora rascunho igual ao palpite salvo', async () => {
    mockApi([makeMatch({ id: 'm1' })], [saved({ predicted_home_score: 2, predicted_away_score: 1 })])
    storeDraft({ m1: { home: '2', away: '1' } })

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
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(KEY)!) as { scores: Record<string, unknown> }
      expect(Object.keys(stored.scores)).toEqual(['m2'])
    })
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
    expect(screen.getByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()
    expect(fireBeforeUnload()).toBe(true)
  })
})
