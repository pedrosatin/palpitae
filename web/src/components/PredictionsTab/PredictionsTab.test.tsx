import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import PredictionsTab from './PredictionsTab'
import { makeMatch } from '../matchFixtures'
import { isLeftoverRound } from '../../lib/rounds'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

function mockFetch(matches: ReturnType<typeof makeMatch>[], apiDefaultRound?: string) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = url.toString()
    if (u.includes('/matches') && apiDefaultRound !== undefined) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ matches, default_round: apiDefaultRound }),
      } as Response)
    }
    if (u.includes('/matches')) {
      // Sem `apiDefaultRound`, imita a ordem de api/src/matches/defaultRound.ts:
      // rodada com jogo futuro, com as que ficaram para trás no fim da fila e
      // desempate pelo último jogo. Empate exato pede `apiDefaultRound`.
      const nowIso = new Date().toISOString()
      const byRound = new Map<string, ReturnType<typeof makeMatch>[]>()
      for (const m of matches) byRound.set(m.round, [...(byRound.get(m.round) ?? []), m])
      const activeRound = [...byRound.entries()]
        .map(([round, list]) => {
          const max = list.reduce((acc, m) => (m.start_time > acc ? m.start_time : acc), '')
          const leftover = isLeftoverRound(list, Date.now()) ? 1 : 0
          return [round, max, leftover] as const
        })
        .filter(([, max]) => max > nowIso)
        .sort(([, a, la], [, b, lb]) => la - lb || (a < b ? -1 : 1))[0]
      const chronologicalLast = matches.reduce<ReturnType<typeof makeMatch> | undefined>(
        (acc, m) => (!acc || m.start_time >= acc.start_time ? m : acc),
        undefined,
      )
      const default_round = activeRound?.[0] ?? chronologicalLast?.round ?? null
      return Promise.resolve({
        ok: true,
        json: async () => ({ matches, default_round }),
      } as Response)
    }
    if (u.includes('/predictions')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ predictions: [] }),
      } as Response)
    }
    return Promise.reject(new Error(`Unexpected fetch: ${u}`))
  })
}

// ─── defaultRoundIndex behaviour (tested through rendered output) ───────────

describe('PredictionsTab – defaultRoundIndex', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('selects the first round that contains a scheduled match', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'finished' }),
      makeMatch({ id: 'm2', round: '2', status: 'scheduled' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      // The <select> should show Rodada 2 as the selected value
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('2')
    })
  })

  it('skips a round where all matches have already started and selects the next open round', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'finished' }),
      makeMatch({
        id: 'm2',
        round: '2',
        status: 'scheduled',
        start_time: new Date(Date.now() - 3_600_000).toISOString(),
      }),
      makeMatch({ id: 'm3', round: '3', status: 'scheduled' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('3')
    })
  })

  it('falls back to the last round when all matches are finished', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'finished' }),
      makeMatch({ id: 'm2', round: '2', status: 'finished' }),
      makeMatch({ id: 'm3', round: '3', status: 'finished' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('3')
    })
  })
})

// ─── groupedRoundMatches behaviour (tested through rendered output) ─────────

describe('PredictionsTab – groupedRoundMatches', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a group header for matches that share a group_name', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', group_name: 'A', status: 'scheduled' }),
      makeMatch({ id: 'm2', round: '1', group_name: 'A', status: 'scheduled' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('Grupo A')).toBeInTheDocument()
    })
  })

  it('renders no group header when group_name is null', async () => {
    const matches = [
      makeMatch({
        id: 'm1',
        round: '1',
        group_name: null,
        status: 'scheduled',
      }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.queryByText(/^Grupo /)).not.toBeInTheDocument()
    })
  })

  it('renders separate group sections for different group_names', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', group_name: 'A', status: 'scheduled' }),
      makeMatch({ id: 'm2', round: '1', group_name: 'B', status: 'scheduled' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByText('Grupo A')).toBeInTheDocument()
      expect(screen.getByText('Grupo B')).toBeInTheDocument()
    })
  })

  it('creates a new group section when the same group_name appears non-consecutively', async () => {
    // A, B, A → should produce 3 groups (two "Grupo A" headers)
    const matches = [
      makeMatch({ id: 'm1', round: '1', group_name: 'A', status: 'scheduled' }),
      makeMatch({ id: 'm2', round: '1', group_name: 'B', status: 'scheduled' }),
      makeMatch({ id: 'm3', round: '1', group_name: 'A', status: 'scheduled' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getAllByText('Grupo A')).toHaveLength(2)
    })
  })
})

// ─── Round navigation ───────────────────────────────────────────────────────

describe('PredictionsTab – Round navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function twoRoundMatches() {
    return [
      makeMatch({ id: 'm1', round: '1', status: 'finished' }),
      makeMatch({
        id: 'm2',
        round: '2',
        status: 'scheduled',
        home_team_name: 'Itália',
        home_team_short_name: 'ITA',
        away_team_name: 'França',
        away_team_short_name: 'FRA',
      }),
    ]
  }

  it('disables "Anterior" button on the first round', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'scheduled' }),
      makeMatch({ id: 'm2', round: '2', status: 'finished' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Rodada anterior/i })).toBeDisabled()
    })
  })

  it('disables "Próxima" button on the last round', async () => {
    const matches = twoRoundMatches()
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    // Default index will be 1 (round '2' is scheduled) — that is the last one
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Próxima rodada/i })).toBeDisabled()
    })
  })

  it('navigates to the next round when "Próxima" is clicked', async () => {
    const matches = [
      makeMatch({
        id: 'm1',
        round: '1',
        status: 'scheduled',
        home_team_name: 'Itália',
        home_team_short_name: 'ITA',
        away_team_name: 'França',
        away_team_short_name: 'FRA',
      }),
      makeMatch({
        id: 'm2',
        round: '2',
        status: 'scheduled',
        home_team_name: 'Japão',
        home_team_short_name: 'JPN',
        away_team_name: 'Coreia',
        away_team_short_name: 'KOR',
      }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    // Wait for loading to finish; default lands on round '1' (first scheduled)
    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('1')
    })

    await userEvent.click(screen.getByRole('button', { name: /Próxima rodada/i }))

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('2')
    })
  })

  it('changes the displayed round when the <select> value is changed', async () => {
    const matches = twoRoundMatches()
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    // Default is round '2'; switch to round '1'
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Rodada 1')

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('1')
  })
})

// ─── Initialisation ─────────────────────────────────────────────────────────

describe('PredictionsTab – Initialisation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('counts a new draft after changing only one score from the 0 default', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Salvar todos$/i })).toBeDisabled()
    })

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))

    expect(screen.getByRole('button', { name: /Salvar todos \(1\)/i })).toBeEnabled()
  })

  it('includes a default 0×0 knockout draw in "Salvar todos" when only the penalty winner is set', async () => {
    const matches = [
      makeMatch({
        id: 'm1',
        round: '1',
        status: 'scheduled',
        decides_on_penalties: true,
      }),
    ]
    let bulkBody: { predictions: Array<Record<string, unknown>> } | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      const u = url.toString()
      if (u.includes('/matches'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ matches, default_round: '1' }),
        } as Response)
      if (u.includes('/predictions/bulk')) {
        bulkBody = JSON.parse(init!.body as string)
        return Promise.resolve({
          ok: true,
          json: async () => ({ saved: ['m1'] }),
        } as Response)
      }
      if (u.includes('/predictions'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ predictions: [] }),
        } as Response)
      if (u.includes('/groups'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ groups: [] }),
        } as Response)
      return Promise.reject(new Error(`Unexpected: ${u}`))
    })

    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    await waitFor(() => screen.getByRole('button', { name: /^Salvar todos$/i }))

    // Score stays at the 0×0 default; user only picks the shootout winner.
    await userEvent.click(screen.getByRole('radio', { name: 'BRA' }))

    const saveAll = await screen.findByRole('button', {
      name: /Salvar todos \(1\)/i,
    })
    await userEvent.click(saveAll)

    await waitFor(() => expect(bulkBody).not.toBeNull())
    expect(bulkBody!.predictions).toEqual([
      {
        match_id: 'm1',
        predicted_home_score: 0,
        predicted_away_score: 0,
        predicted_penalty_winner: 'home',
      },
    ])
  })

  it('selects the first round with a scheduled match on load', async () => {
    const matches = [
      makeMatch({ id: 'm1', round: '1', status: 'finished' }),
      makeMatch({ id: 'm2', round: '2', status: 'scheduled' }),
      makeMatch({ id: 'm3', round: '3', status: 'scheduled' }),
    ]
    mockFetch(matches)

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('2')
    })
  })
})

// ─── Analytics ──────────────────────────────────────────────────────────────

describe('PredictionsTab – analytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  function twoRounds() {
    return [
      makeMatch({
        id: 'm1',
        round: '1',
        status: 'scheduled',
        home_team_name: 'Itália',
        home_team_short_name: 'ITA',
        away_team_name: 'França',
        away_team_short_name: 'FRA',
      }),
      makeMatch({
        id: 'm2',
        round: '2',
        status: 'scheduled',
        home_team_name: 'Japão',
        home_team_short_name: 'JPN',
        away_team_name: 'Coreia',
        away_team_short_name: 'KOR',
      }),
    ]
  }

  it('fires click_predictions_proxima_rodada when Próxima is clicked', async () => {
    mockFetch(twoRounds())
    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('1')
    })
    await userEvent.click(screen.getByRole('button', { name: /Próxima rodada/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_proxima_rodada', { round: '2' })
  })

  it('fires click_predictions_rodada_anterior when Anterior is clicked', async () => {
    mockFetch(twoRounds())
    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    // Default is round '1'; advance to '2' first
    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('1')
    })
    await userEvent.click(screen.getByRole('button', { name: /Próxima rodada/i }))
    mockTrackEvent.mockClear()
    await userEvent.click(screen.getByRole('button', { name: /Rodada anterior/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_rodada_anterior', {
      round: '1',
    })
  })

  it('fires click_predictions_salvar_todos with count and round when Salvar todos is clicked', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = url.toString()
      if (u.includes('/matches'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ matches, default_round: '1' }),
        } as Response)
      if (u.includes('/predictions/bulk'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ saved: ['m1'] }),
        } as Response)
      if (u.includes('/predictions'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ predictions: [] }),
        } as Response)
      if (u.includes('/groups'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ groups: [] }),
        } as Response)
      return Promise.reject(new Error(`Unexpected: ${u}`))
    })

    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    await waitFor(() => screen.getByRole('button', { name: /^Salvar todos$/i }))

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: /Salvar todos \(1\)/i }))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_salvar_todos', {
      count: 1,
      round: '1',
    })
  })

  it('fires change_predictions_rodada when the round select is changed', async () => {
    mockFetch([
      makeMatch({ id: 'm1', round: '1', status: 'scheduled' }),
      makeMatch({ id: 'm2', round: '2', status: 'scheduled' }),
    ])
    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('1')
    })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Rodada 2')
    expect(mockTrackEvent).toHaveBeenCalledWith('change_predictions_rodada', {
      round: '2',
    })
  })

  it('fires click_predictions_importar when Importar is clicked', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = url.toString()
      if (u.includes('/groups'))
        return Promise.resolve({
          ok: true,
          json: async () => ({
            groups: [{ id: 'g-other', name: 'Outro', competition_id: 'c1' }],
          }),
        } as Response)
      if (u.includes('/matches'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ matches, default_round: '1' }),
        } as Response)
      if (u.includes('/predictions/import'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, imported: 3, locked_skipped: 0 }),
        } as Response)
      if (u.includes('/predictions'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ predictions: [] }),
        } as Response)
      return Promise.reject(new Error(`Unexpected: ${u}`))
    })

    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    await waitFor(() => screen.getByText(/Importar palpites de:/i))
    await userEvent.click(screen.getByRole('button', { name: 'Importar' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_importar')
  })
})

// ─── Aviso de rodada com jogo adiado (ADR-013) ─────────────────────────────

describe('PredictionsTab – rodada com jogo adiado', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const past = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

  // Reproduz a rodada 21 do Brasileirão: alguns jogos já foram, os adiados
  // guardam o horário original (passado). A rodada cai fora do default_round,
  // então o default vai para a 22 — e o palpite reaberto ficaria invisível.
  function brasileiraoLikeMatches() {
    return [
      makeMatch({ id: 'm21a', round: '21', status: 'finished', start_time: past(48) }),
      makeMatch({
        id: 'm21b',
        round: '21',
        status: 'scheduled',
        start_time: past(72),
        postponed: 1,
      }),
      makeMatch({
        id: 'm21c',
        round: '21',
        status: 'scheduled',
        start_time: past(72),
        postponed: 1,
      }),
      makeMatch({ id: 'm22a', round: '22', status: 'scheduled' }),
    ]
  }

  it('abre na rodada 22 e avisa que a 21 tem jogos adiados', async () => {
    mockFetch(brasileiraoLikeMatches())

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('22')
    })
    expect(screen.getByText(/2 jogos adiados/i)).toHaveTextContent(
      'Rodada 21 tem 2 jogos adiados. O palpite segue aberto. Ver rodada',
    )
    expect(screen.getByRole('button', { name: /ver rodada/i })).toBeInTheDocument()
  })

  it('"Ver rodada" pula para a rodada adiada e rastreia o clique', async () => {
    const user = userEvent.setup({ delay: null })
    mockFetch(brasileiraoLikeMatches())

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ver rodada/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /ver rodada/i }))

    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('21')
    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_rodada_adiada', {
      round: '21',
    })
  })

  it('some o aviso quando a rodada adiada já é a aberta (os cards já mostram o badge)', async () => {
    const user = userEvent.setup({ delay: null })
    mockFetch(brasileiraoLikeMatches())

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ver rodada/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /ver rodada/i }))

    expect(screen.queryByRole('button', { name: /ver rodada/i })).not.toBeInTheDocument()
  })

  it('sem jogo adiado, nenhum aviso aparece', async () => {
    mockFetch([
      makeMatch({ id: 'm1', round: '21', status: 'finished', start_time: past(48) }),
      makeMatch({ id: 'm2', round: '22', status: 'scheduled' }),
    ])

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('22')
    })
    expect(screen.queryByRole('button', { name: /ver rodada/i })).not.toBeInTheDocument()
  })
})

// ─── Múltiplas rodadas adiadas: só a mais próxima antes da aberta ───────────

describe('PredictionsTab – múltiplas rodadas com jogo adiado', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const past = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

  // Cenário real do Brasileirão 2026: a rodada 4 tem um Flamengo×Mirassol parado
  // desde fevereiro e a 21 tem 2 adiados de julho. O default é a 22. Avisar da
  // rodada 4 primeiro fazia o usuário pular 17 rodadas pra trás e só então
  // descobrir que a 21 também tinha.
  function twoPostponedRounds() {
    return [
      makeMatch({
        id: 'm4a',
        round: '4',
        status: 'scheduled',
        start_time: past(4000),
        postponed: 1,
      }),
      makeMatch({ id: 'm4b', round: '4', status: 'finished', start_time: past(3999) }),
      makeMatch({ id: 'm21a', round: '21', status: 'finished', start_time: past(48) }),
      makeMatch({
        id: 'm21b',
        round: '21',
        status: 'scheduled',
        start_time: past(72),
        postponed: 1,
      }),
      makeMatch({
        id: 'm21c',
        round: '21',
        status: 'scheduled',
        start_time: past(72),
        postponed: 1,
      }),
      makeMatch({ id: 'm22a', round: '22', status: 'scheduled' }),
    ]
  }

  it('avisa da rodada 21 (a mais próxima), não da 4', async () => {
    mockFetch(twoPostponedRounds())

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('22')
    })
    expect(screen.getByText(/2 jogos adiados/i)).toBeInTheDocument()
    expect(screen.queryByText(/1 jogo adiado/i)).not.toBeInTheDocument()
  })

  it('não encadeia: ao pular para a 21, nenhum aviso aponta para a 4', async () => {
    const user = userEvent.setup({ delay: null })
    mockFetch(twoPostponedRounds())

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ver rodada/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /ver rodada/i }))

    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('21')
    expect(screen.queryByRole('button', { name: /ver rodada/i })).not.toBeInTheDocument()
  })

  it('o seletor continua marcando TODAS as rodadas adiadas', async () => {
    mockFetch(twoPostponedRounds())

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Rodada 4 · 1 adiado' })).toBeInTheDocument()
    })
    expect(screen.getByRole('option', { name: 'Rodada 21 · 2 adiados' })).toBeInTheDocument()
  })
})

// ─── Jogo remarcado numa rodada que ficou para trás (ADR-019) ──────────────

describe('PredictionsTab – rodada antiga com jogo remarcado', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const days = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()

  // Brasileirão em 07/11/2026: a rodada 21 tem 9 jogos encerrados de julho a
  // outubro e Chapecoense × Vasco remarcado para 14/11, sem flag de adiado. A 35
  // é toda futura e é o default.
  function rescheduledRound21() {
    return [
      ...Array.from({ length: 9 }, (_, i) =>
        makeMatch({ id: `m21-${i}`, round: '21', status: 'finished', start_time: days(-100 + i * 10) }),
      ),
      makeMatch({ id: 'm21-cha-vas', round: '21', status: 'scheduled', start_time: days(7) }),
      makeMatch({ id: 'm34', round: '34', status: 'finished', start_time: days(-5) }),
      makeMatch({ id: 'm35a', round: '35', status: 'scheduled', start_time: days(6.9) }),
      makeMatch({ id: 'm35b', round: '35', status: 'scheduled', start_time: days(12) }),
    ]
  }

  it('abre na rodada 35 e avisa do jogo remarcado da 21 com atalho', async () => {
    const user = userEvent.setup({ delay: null })
    mockFetch(rescheduledRound21())

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('35')
    })
    expect(screen.getByText(/1 jogo remarcado/i)).toHaveTextContent(
      'Rodada 21 tem 1 jogo remarcado. O palpite segue aberto. Ver rodada',
    )
    expect(screen.getByRole('option', { name: 'Rodada 21 · 1 remarcado' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /ver rodada/i }))
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('21')
    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_rodada_adiada', { round: '21' })
    expect(screen.queryByRole('button', { name: /ver rodada/i })).not.toBeInTheDocument()
  })

  it('no empate de fim de temporada a dica aponta a rodada que a API não escolheu', async () => {
    // Rodadas 9 e 21 com um remarcado no mesmo horário e a 38 encerrada. A API
    // devolve a 21 (ADR-019). A 9 fica com a dica e o remarcado continua visível.
    const user = userEvent.setup({ delay: null })
    const rescheduledAt = days(7)
    const leftover = (round: string, from: number) => [
      ...Array.from({ length: 9 }, (_, i) =>
        makeMatch({ id: `m${round}-${i}`, round, status: 'finished', start_time: days(from + i) }),
      ),
      makeMatch({ id: `m${round}-remarcado`, round, status: 'scheduled', start_time: rescheduledAt }),
    ]
    mockFetch(
      [
        ...leftover('9', -170),
        ...leftover('21', -110),
        ...Array.from({ length: 10 }, (_, i) =>
          makeMatch({ id: `m38-${i}`, round: '38', status: 'finished', start_time: days(-6) }),
        ),
      ],
      '21',
    )

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('21')
    })
    expect(screen.getByText(/1 jogo remarcado/i)).toHaveTextContent(
      'Rodada 9 tem 1 jogo remarcado. O palpite segue aberto. Ver rodada',
    )
    expect(screen.getByRole('option', { name: 'Rodada 9 · 1 remarcado' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Rodada 21' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /ver rodada/i }))
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('9')
    expect(mockTrackEvent).toHaveBeenCalledWith('click_predictions_rodada_adiada', { round: '9' })
  })

  it('rodada em andamento não vira aviso de remarcado', async () => {
    mockFetch([
      makeMatch({ id: 'm1', round: '20', status: 'finished', start_time: days(-1) }),
      makeMatch({ id: 'm2', round: '20', status: 'scheduled', start_time: days(1) }),
      makeMatch({ id: 'm3', round: '21', status: 'scheduled', start_time: days(5) }),
    ])

    render(<PredictionsTab groupId="g1" competitionId="c1" />)

    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('20')
    })
    expect(screen.queryByText(/remarcado/i)).not.toBeInTheDocument()
  })
})
