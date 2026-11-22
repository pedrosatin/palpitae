import { act, screen } from '@testing-library/react'
import { renderWithQuery as render } from '../../test-utils'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import MatchCard, { type Match, type Prediction, OUTCOMES } from './MatchCard'
import { teamShortName } from './types'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 'match-1',
    start_time: new Date(Date.now() + 3_600_000).toISOString(),
    status: 'scheduled',
    home_score: null,
    away_score: null,
    phase: 'group',
    round: '1',
    round_label: 'Rodada 1',
    group_name: null,
    home_team_id: 'ht-1',
    home_team_name: 'Brasil',
    home_team_short_name: 'BRA',
    home_team_logo: '/bra.png',
    away_team_id: 'at-1',
    away_team_name: 'Argentina',
    away_team_short_name: 'ARG',
    away_team_logo: '/arg.png',
    ...overrides,
  }
}

function makePrediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    id: 'pred-1',
    match_id: 'match-1',
    predicted_home_score: 1,
    predicted_away_score: 2,
    points_awarded: 0,
    locked: 0,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderCard(
  match: Match,
  prediction: Prediction | undefined,
  onSaved = vi.fn(),
  extras: { now?: number } = {},
) {
  return render(
    <MatchCard
      match={match}
      prediction={prediction}
      groupId="group-1"
      onSaved={onSaved}
      now={extras.now}
    />,
  )
}

describe('MatchCard – estado do palpite', () => {
  it('jogo sem palpite começa com os campos vazios, o rótulo "sem palpite" e o salvar desabilitado', () => {
    renderCard(makeMatch(), undefined)

    const homeInput = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    const awayInput = screen.getByRole('spinbutton', {
      name: /Placar Argentina/i,
    }) as HTMLInputElement

    expect(homeInput.value).toBe('')
    expect(awayInput.value).toBe('')
    expect(homeInput).toHaveAttribute('placeholder', '–')
    expect(screen.getByText('sem palpite')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('o leitor de tela ouve o jogo e o estado juntos', () => {
    renderCard(makeMatch(), undefined)

    expect(
      screen.getByRole('group', { name: 'Brasil contra Argentina, sem palpite' }),
    ).toBeInTheDocument()
  })

  it('jogo sem palpite libera o salvar só com os dois placares escolhidos', async () => {
    renderCard(makeMatch(), undefined)

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    expect(screen.getByText('alterado, não salvo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /Diminuir placar Argentina/i }))
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled()
  })

  it('palpite salvo mostra "Salvo" com a marca, sem `disabled` e sem o botão "Atualizar"', () => {
    renderCard(makeMatch(), makePrediction())

    const done = screen.getByRole('button', { name: 'Salvo' })
    expect(done).not.toBeDisabled()
    expect(done).toHaveAttribute('aria-disabled', 'true')
    expect(done.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('palpite salvo')).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Brasil contra Argentina, palpite salvo' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Atualizar' })).not.toBeInTheDocument()
  })

  it('clicar em "Salvo" não envia nada', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderCard(makeMatch(), makePrediction())

    await userEvent.click(screen.getByRole('button', { name: 'Salvo' }))

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('o botão não recebe `disabled` do clique ao "Salvo" e segue com o foco', async () => {
    let respond: (res: Response) => void = () => {}
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve
        }),
    )
    const match = makeMatch()
    function Parent() {
      const [prediction, setPrediction] = useState<Prediction | undefined>(undefined)
      return (
        <MatchCard
          match={match}
          prediction={prediction}
          groupId="group-1"
          onSaved={(_id, home, away) =>
            setPrediction(
              makePrediction({ predicted_home_score: home, predicted_away_score: away }),
            )
          }
        />
      )
    }
    const user = userEvent.setup()
    render(<Parent />)
    await user.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await user.click(screen.getByRole('button', { name: /Diminuir placar Argentina/i }))

    const button = screen.getByRole('button', { name: 'Salvar' })
    const changes: MutationRecord[] = []
    const observer = new MutationObserver((records) => changes.push(...records))
    observer.observe(button, { attributes: true, attributeFilter: ['disabled'] })

    await user.click(button)
    expect(button).toHaveTextContent('Salvo')
    expect(screen.getByText('palpite salvo')).toBeInTheDocument()
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await user.click(button)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    respond(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    expect(await screen.findByRole('button', { name: 'Salvo' })).toBe(button)
    changes.push(...observer.takeRecords())
    observer.disconnect()

    expect(changes).toHaveLength(0)
    expect(button).not.toBeDisabled()
    expect(document.activeElement).toBe(button)
    fetchMock.mockRestore()
  })

  it('alterar o placar salvo muda o rótulo para "alterado, não salvo" e o botão para "Atualizar"', async () => {
    renderCard(makeMatch(), makePrediction())

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))

    expect(screen.getByText('alterado, não salvo')).toBeInTheDocument()
    expect(screen.queryByText('palpite salvo')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeEnabled()
    expect(
      screen.getByRole('group', { name: 'Brasil contra Argentina, alterado, não salvo' }),
    ).toBeInTheDocument()
  })

  it('voltar ao placar salvo mostra "Salvo" de novo', async () => {
    renderCard(makeMatch(), makePrediction())

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await userEvent.click(screen.getByRole('button', { name: /Diminuir placar Brasil/i }))

    expect(screen.getByText('palpite salvo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvo' })).toBeInTheDocument()
  })

  it('apagar um campo do palpite salvo conta como alteração e trava o salvar', async () => {
    renderCard(makeMatch(), makePrediction())

    await userEvent.clear(screen.getByRole('spinbutton', { name: 'Placar Brasil' }))

    expect(screen.getByText('alterado, não salvo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeDisabled()
  })

  it('jogo bloqueado não mostra o estado de jogo aberto', () => {
    renderCard(makeMatch(), makePrediction({ locked: 1 }))

    expect(screen.queryByText('palpite salvo')).not.toBeInTheDocument()
    expect(screen.queryByText('sem palpite')).not.toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Brasil contra Argentina, bloqueado' }),
    ).toBeInTheDocument()
  })

  it('modo só vencedor também mostra o estado', () => {
    render(
      <MatchCard
        match={makeMatch()}
        prediction={undefined}
        groupId="group-1"
        outcomeOnly
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByText('sem palpite')).toBeInTheDocument()
  })
})

describe('MatchCard – data do jogo', () => {
  it('mostra o dia da semana abreviado, a data e a hora de Brasília', () => {
    renderCard(makeMatch({ start_time: '2026-11-14T21:30:00Z' }), undefined)

    expect(screen.getByText('sáb, 14/11 · 18:30')).toBeInTheDocument()
  })
})

describe('MatchCard – Stepper "+"', () => {
  it('increments from 0 to 1 when "+" is clicked', async () => {
    renderCard(makeMatch(), undefined)

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))

    const input = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    expect(input.value).toBe('1')
  })

  it('does not exceed 99 when "+" is clicked at the maximum', async () => {
    renderCard(makeMatch(), makePrediction({ predicted_home_score: 99, predicted_away_score: 0 }))

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))

    const input = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    expect(input.value).toBe('99')
  })

  it('leva um campo vazio a 1 quando "+" é clicado', async () => {
    renderCard(makeMatch(), undefined)

    const input = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    expect(input.value).toBe('')

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))

    expect(input.value).toBe('1')
    expect(screen.getByRole('spinbutton', { name: /Placar Argentina/i })).toHaveValue(null)
  })
})

describe('MatchCard – Stepper "−"', () => {
  it('decrements from 2 to 1 when "−" is clicked', async () => {
    renderCard(makeMatch(), makePrediction({ predicted_home_score: 2, predicted_away_score: 0 }))

    await userEvent.click(screen.getByRole('button', { name: /Diminuir placar Brasil/i }))

    const input = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    expect(input.value).toBe('1')
  })

  it('does not go below 0 when "−" is clicked at the minimum', async () => {
    renderCard(makeMatch(), makePrediction({ predicted_home_score: 0, predicted_away_score: 0 }))

    await userEvent.click(screen.getByRole('button', { name: /Diminuir placar Brasil/i }))

    const input = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    expect(input.value).toBe('0')
  })

  it('leva um campo vazio a 0 quando "−" é clicado', async () => {
    renderCard(makeMatch(), undefined)

    const input = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    expect(input.value).toBe('')

    await userEvent.click(screen.getByRole('button', { name: /Diminuir placar Brasil/i }))

    expect(input.value).toBe('0')
  })
})

describe('MatchCard – analytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  it('fires click_matchcard_salvar with the match_id when the save button is clicked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response)

    const match = makeMatch()
    renderCard(match, undefined)

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await userEvent.click(screen.getByRole('button', { name: /Diminuir placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: /Salvar/i }))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_matchcard_salvar', {
      match_id: 'match-1',
    })
  })
})

describe('MatchCard – outcome-only (1X2) mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  it('renders Casa/Empate/Fora buttons instead of score inputs', () => {
    render(
      <MatchCard
        match={makeMatch()}
        prediction={undefined}
        groupId="group-1"
        outcomeOnly
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByRole('radio', { name: 'Casa' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Empate' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Fora' })).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /Placar Brasil/i })).not.toBeInTheDocument()
  })

  it('saves (1,0) and tracks the outcome when "Casa" is clicked', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response)
    const onSaved = vi.fn()

    render(
      <MatchCard
        match={makeMatch()}
        prediction={undefined}
        groupId="group-1"
        outcomeOnly
        onSaved={onSaved}
      />,
    )

    await userEvent.click(screen.getByRole('radio', { name: 'Casa' }))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_matchcard_resultado', {
      match_id: 'match-1',
      outcome: 'home',
    })
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.predicted_home_score).toBe(1)
    expect(body.predicted_away_score).toBe(0)
    expect(onSaved).toHaveBeenCalledWith('match-1', 1, 0, null)
  })

  it('marks the button matching the existing prediction as active', () => {
    render(
      <MatchCard
        match={makeMatch()}
        prediction={makePrediction({
          predicted_home_score: 0,
          predicted_away_score: 1,
        })}
        groupId="group-1"
        outcomeOnly
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByRole('radio', { name: 'Fora' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Casa' })).toHaveAttribute('aria-checked', 'false')
  })

  it('shows the outcome label (not a score) for a locked prediction', () => {
    render(
      <MatchCard
        match={makeMatch()}
        prediction={makePrediction({
          predicted_home_score: 2,
          predicted_away_score: 0,
          locked: 1,
        })}
        groupId="group-1"
        outcomeOnly
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByText('seu palpite')).toBeInTheDocument()
    expect(screen.getByText('Casa')).toBeInTheDocument()
  })
})

describe('MatchCard – Locked state', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('hides the steppers and input row when prediction.locked = 1', () => {
    renderCard(makeMatch(), makePrediction({ locked: 1 }))

    expect(
      screen.queryByRole('button', { name: /Aumentar placar Brasil/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Diminuir placar Brasil/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('seu palpite')).toBeInTheDocument()
  })

  it('hides the steppers and input row when match start_time has already passed', () => {
    const pastMatch = makeMatch({
      start_time: new Date(Date.now() - 3_600_000).toISOString(),
    })
    renderCard(pastMatch, undefined)

    expect(
      screen.queryByRole('button', { name: /Aumentar placar Brasil/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Diminuir placar Brasil/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('sem palpite registrado')).toBeInTheDocument()
  })
})

describe('MatchCard – penalty shootout pick', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockTrackEvent.mockClear()
  })

  const penaltyMatch = () => makeMatch({ decides_on_penalties: true })

  it('shows the penalty picker only while the score is a draw (score mode)', async () => {
    renderCard(penaltyMatch(), undefined)

    const label = 'Quem vence nos pênaltis?'
    expect(screen.queryByRole('radiogroup', { name: label })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    expect(screen.queryByRole('radiogroup', { name: label })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    expect(screen.getByRole('radiogroup', { name: label })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    expect(screen.queryByRole('radiogroup', { name: label })).not.toBeInTheDocument()
  })

  it('blocks save on a draw until a penalty winner is chosen', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)

    renderCard(penaltyMatch(), undefined)
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))

    const saveBtn = screen.getByRole('button', { name: /Salvar/i })
    expect(saveBtn).toBeDisabled()

    await userEvent.click(screen.getByRole('radio', { name: 'BRA' }))
    expect(saveBtn).toBeEnabled()

    await userEvent.click(saveBtn)
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.predicted_penalty_winner).toBe('home')
  })

  it('collapses to a chip once a winner is chosen and re-opens on click', async () => {
    renderCard(penaltyMatch(), undefined)
    const label = 'Quem vence nos pênaltis?'
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    expect(screen.getByRole('radiogroup', { name: label })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'BRA' }))
    expect(screen.queryByRole('radiogroup', { name: label })).not.toBeInTheDocument()
    const chip = screen.getByRole('button', { name: /trocar/i })
    expect(chip).toBeInTheDocument()

    await userEvent.click(chip)
    expect(screen.getByRole('radiogroup', { name: label })).toBeInTheDocument()
  })

  it('removes the penalty pick entirely when the score leaves a draw', async () => {
    renderCard(penaltyMatch(), undefined)
    const label = 'Quem vence nos pênaltis?'
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    await userEvent.click(screen.getByRole('radio', { name: 'BRA' }))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    expect(screen.queryByRole('radiogroup', { name: label })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /trocar/i })).not.toBeInTheDocument()
  })

  it('does not show the picker for a non-penalty match', async () => {
    renderCard(makeMatch({ decides_on_penalties: false }), undefined)
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    expect(
      screen.queryByRole('radiogroup', { name: 'Quem vence nos pênaltis?' }),
    ).not.toBeInTheDocument()
  })

  it('outcome mode: clicking Empate waits for the penalty winner before persisting', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)
    const onSaved = vi.fn()

    const penaltyMatch = () => makeMatch({ decides_on_penalties: true })

    render(
      <MatchCard
        match={penaltyMatch()}
        prediction={undefined}
        groupId="group-1"
        outcomeOnly
        onSaved={onSaved}
      />,
    )

    await userEvent.click(screen.getByRole('radio', { name: 'Empate' }))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('radiogroup', { name: 'Quem vence nos pênaltis?' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'ARG' }))
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.predicted_home_score).toBe(0)
    expect(body.predicted_away_score).toBe(0)
    expect(body.predicted_penalty_winner).toBe('away')
    expect(onSaved).toHaveBeenCalledWith('match-1', 0, 0, 'away')
  })
})

describe('MatchCard – Finished state', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the "encerrado" badge and final score', () => {
    const match = makeMatch({
      status: 'finished',
      home_score: 2,
      away_score: 1,
    })
    renderCard(match, makePrediction({ predicted_home_score: 0, predicted_away_score: 0 }))

    expect(screen.getByText('encerrado')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('renders total points including penalty bonus', () => {
    const match = makeMatch({
      status: 'finished',
      home_score: 1,
      away_score: 1,
      penalty_winner: 'home',
      home_penalty_goals: 4,
      away_penalty_goals: 3,
    })
    const prediction = makePrediction({
      points_awarded: 5,
      penalty_points: 2,
      locked: 1,
    })
    renderCard(match, prediction)

    expect(screen.getByText('7 pontos')).toBeInTheDocument()
    expect(screen.getByText('(+2 pênalti)')).toBeInTheDocument()
    expect(screen.getByText('(4-3 pênaltis)')).toBeInTheDocument()
  })
})

describe('MatchCard – Error state', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows an error message when saving fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Database timeout' }),
    } as Response)

    renderCard(makeMatch(), undefined)

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await userEvent.click(screen.getByRole('button', { name: /Diminuir placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: /Salvar/i }))

    expect(await screen.findByText('Database timeout')).toBeInTheDocument()
  })

  it('shows generic error message if api fails without error description', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    } as Response)

    renderCard(makeMatch(), undefined)

    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await userEvent.click(screen.getByRole('button', { name: /Diminuir placar Argentina/i }))
    await userEvent.click(screen.getByRole('button', { name: /Salvar/i }))

    expect(await screen.findByText('Erro ao salvar palpite')).toBeInTheDocument()
  })
})

describe('MatchCard – Score inputs', () => {
  it('updates the score on typing', async () => {
    renderCard(makeMatch(), undefined)

    const homeInput = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    const awayInput = screen.getByRole('spinbutton', {
      name: /Placar Argentina/i,
    }) as HTMLInputElement

    await userEvent.clear(homeInput)
    await userEvent.type(homeInput, '3')

    await userEvent.clear(awayInput)
    await userEvent.type(awayInput, '2')

    expect(homeInput.value).toBe('3')
    expect(awayInput.value).toBe('2')
  })
})

describe('MatchCard – resultado pendente (atraso de feed)', () => {
  const fourHoursAgo = new Date(Date.now() - 4 * 3_600_000).toISOString()
  const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString()

  it('mostra "resultado pendente" após kickoff + 3 h sem placar', () => {
    renderCard(
      makeMatch({ start_time: fourHoursAgo, status: 'scheduled', postponed: 0 }),
      undefined,
      vi.fn(),
      { now: Date.now() },
    )

    expect(screen.getByText(/resultado pendente/i)).toBeInTheDocument()
    expect(screen.queryByText(/^bloqueado$/i)).not.toBeInTheDocument()
    expect(screen.getByRole('group').getAttribute('aria-label')).toMatch(/resultado pendente/)
  })

  it('não troca placar existente por resultado inventado', () => {
    renderCard(
      makeMatch({
        start_time: fourHoursAgo,
        status: 'live',
        postponed: 0,
        home_score: null,
        away_score: null,
      }),
      undefined,
      vi.fn(),
      { now: Date.now() },
    )

    expect(screen.getByText(/resultado pendente/i)).toBeInTheDocument()
    expect(screen.getByText('vs')).toBeInTheDocument()
    expect(screen.queryByText(/^\d+\s*×\s*\d+$/)).not.toBeInTheDocument()
  })

  it('dentro da janela de 3 h continua só "bloqueado"', () => {
    renderCard(
      makeMatch({ start_time: twoHoursAgo, status: 'scheduled', postponed: 0 }),
      undefined,
      vi.fn(),
      { now: Date.now() },
    )

    expect(screen.getByText(/bloqueado/i)).toBeInTheDocument()
    expect(screen.queryByText(/resultado pendente/i)).not.toBeInTheDocument()
  })

  it('adiado conhecido não vira resultado pendente', () => {
    renderCard(
      makeMatch({ start_time: fourHoursAgo, status: 'scheduled', postponed: 1 }),
      undefined,
      vi.fn(),
      { now: Date.now() },
    )

    expect(screen.getByText(/adiado/i)).toBeInTheDocument()
    expect(screen.queryByText(/resultado pendente/i)).not.toBeInTheDocument()
  })
})

describe('MatchCard – jogo adiado (postponed)', () => {
  const pastStart = new Date(Date.now() - 86_400_000).toISOString()

  it('mostra badge "adiado" e esconde a data original', () => {
    renderCard(makeMatch({ start_time: pastStart, postponed: 1 }), undefined)

    expect(screen.getByText(/adiado/i)).toBeInTheDocument()
    expect(screen.getByText(/data a definir/i)).toBeInTheDocument()
    expect(screen.queryByText(/bloqueado/i)).not.toBeInTheDocument()
  })

  it('mantém o palpite editável mesmo com start_time no passado', () => {
    renderCard(makeMatch({ start_time: pastStart, postponed: 1 }), undefined)

    const homeInput = screen.getByRole('spinbutton', { name: /Placar Brasil/i })
    expect(homeInput).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /Salvar/i })).toBeInTheDocument()
  })

  it('sem a flag, o mesmo jogo no passado aparece como resultado pendente (controle)', () => {
    renderCard(makeMatch({ start_time: pastStart }), undefined)

    expect(screen.getByText(/resultado pendente/i)).toBeInTheDocument()
    expect(screen.queryByText(/adiado/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^bloqueado$/i)).not.toBeInTheDocument()
  })

  it('jogo já encerrado ignora a flag e segue mostrando o resultado', () => {
    renderCard(
      makeMatch({ start_time: pastStart, status: 'finished', home_score: 2, away_score: 1 }),
      undefined,
    )

    expect(screen.getByText(/encerrado/i)).toBeInTheDocument()
    expect(screen.queryByText(/adiado/i)).not.toBeInTheDocument()
  })
})

describe('MatchCard – travamento igual ao da API', () => {
  const past = new Date(Date.now() - 86_400_000).toISOString()
  const future = new Date(Date.now() + 86_400_000).toISOString()
  const seenStarted = new Date(Date.now() - 3_600_000).toISOString()

  it.each<[string, Partial<Match>, Partial<Prediction> | undefined, boolean]>([
    ['agendado com horário futuro', { start_time: future }, undefined, true],
    ['agendado com horário vencido', { start_time: past }, undefined, false],
    ['adiado com o horário original vencido', { start_time: past, postponed: 1 }, undefined, true],
    [
      'adiado depois de o sync ver o início',
      { start_time: past, postponed: 1, locked_at: seenStarted },
      undefined,
      false,
    ],
    [
      'encerrado e marcado como adiado, sem locked_at',
      { start_time: past, postponed: 1, status: 'finished', home_score: 0, away_score: 0 },
      undefined,
      false,
    ],
    [
      'ao vivo com o relógio do aparelho antes do horário',
      { start_time: future, status: 'live' },
      undefined,
      false,
    ],
    [
      'remarcado para o futuro depois de o sync ver o início',
      { start_time: future, locked_at: seenStarted },
      undefined,
      false,
    ],
    [
      'adiado com o palpite travado numa busca anterior',
      { start_time: past, postponed: 1 },
      { locked: 1 },
      true,
    ],
  ])('%s', (_, matchOverrides, predictionOverrides, editable) => {
    renderCard(
      makeMatch(matchOverrides),
      predictionOverrides && makePrediction(predictionOverrides),
    )

    expect(screen.queryAllByRole('spinbutton')).toHaveLength(editable ? 2 : 0)
  })
})

describe('OUTCOMES', () => {
  it('preserves the expected mapping for home, draw, and away', () => {
    expect(OUTCOMES).toEqual({
      home: { home: 1, away: 0, label: 'Casa' },
      draw: { home: 0, away: 0, label: 'Empate' },
      away: { home: 0, away: 1, label: 'Fora' },
    })
  })
})

describe('teamShortName', () => {
  it('devolve a sigla do mandante ou visitante e null sem lado escolhido', () => {
    const match = makeMatch()
    expect(teamShortName(match, 'home')).toBe('BRA')
    expect(teamShortName(match, 'away')).toBe('ARG')
    expect(teamShortName(match, null)).toBeNull()
    expect(teamShortName(match, undefined)).toBeNull()
  })

  it('mostra classificado no card aberto e pênalti no card bloqueado', () => {
    const { rerender } = render(
      <MatchCard
        match={makeMatch({ tie_role: 'leg2', decides_on_penalties: true })}
        prediction={makePrediction({ predicted_classified: 'home' })}
        groupId="g"
        onSaved={vi.fn()}
      />,
    )
    expect(screen.getByText('classificado: BRA')).toBeInTheDocument()

    rerender(
      <MatchCard
        match={makeMatch({ tie_role: 'leg2', decides_on_penalties: true })}
        prediction={makePrediction({
          locked: 1,
          predicted_home_score: 1,
          predicted_away_score: 1,
          predicted_classified: 'away',
          predicted_penalty_winner: 'home',
        })}
        groupId="g"
        onSaved={vi.fn()}
      />,
    )
    expect(screen.getByText('classificado: ARG')).toBeInTheDocument()
    expect(screen.getByText('pênalti: BRA')).toBeInTheDocument()
  })
})

describe('MatchCard agregado de ida e volta', () => {
  it('exige o vencedor nos pênaltis na volta 2x0 depois de palpite 2x0 na ida e salva o pick', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const onSaved = vi.fn()
    render(
      <MatchCard
        match={makeMatch({ tie_role: 'leg2', decides_on_penalties: true })}
        prediction={makePrediction({ predicted_home_score: 2, predicted_away_score: 0 })}
        leg1Prediction={makePrediction({ predicted_home_score: 2, predicted_away_score: 0 })}
        groupId="g"
        onSaved={onSaved}
      />,
    )
    expect(screen.getByRole('radiogroup', { name: 'Quem vence nos pênaltis?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeDisabled()
    expect(screen.getByText('falta pênalti')).toBeInTheDocument()
    expect(screen.queryByText('palpite salvo')).not.toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Brasil contra Argentina, falta pênalti' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'BRA' }))
    await user.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(onSaved).toHaveBeenCalledWith('match-1', 2, 0, 'home')
    expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string)).toMatchObject({
      predicted_penalty_winner: 'home',
    })
    fetchMock.mockRestore()
  })
  it('não oferece pênaltis para 0x0 na volta quando a ida foi 2x0', async () => {
    render(
      <MatchCard
        match={makeMatch({ tie_role: 'leg2', decides_on_penalties: true })}
        prediction={undefined}
        leg1Prediction={makePrediction({ predicted_home_score: 2, predicted_away_score: 0 })}
        groupId="g"
        onSaved={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Diminuir placar Brasil/i }))
    await userEvent.click(screen.getByRole('button', { name: /Diminuir placar Argentina/i }))
    expect(
      screen.queryByRole('radiogroup', { name: 'Quem vence nos pênaltis?' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled()
  })
  it('soma os três componentes e mostra o classificado previsto', () => {
    renderCard(
      makeMatch({ status: 'finished', start_time: '2020-01-01', tie_role: 'leg2' }),
      makePrediction({
        locked: 1,
        points_awarded: 3,
        penalty_points: 1,
        classified_points: 2,
        predicted_classified: 'away',
      }),
    )
    expect(screen.getByText(/6 pontos/)).toBeInTheDocument()
    expect(screen.getByText('classificado: ARG')).toBeInTheDocument()
  })
})

it('mantém o placar em edição quando apenas o classificado persistido muda', async () => {
  const match = makeMatch({ tie_role: 'leg2', decides_on_penalties: true })
  const prediction = makePrediction({
    predicted_home_score: 1,
    predicted_away_score: 0,
    predicted_classified: 'away',
  })
  const props = { match, prediction, groupId: 'g', onSaved: vi.fn() }
  const { rerender } = render(<MatchCard {...props} />)
  const user = userEvent.setup()
  const input = screen.getByRole('spinbutton', { name: 'Placar Brasil' })
  await user.clear(input)
  await user.type(input, '3')
  rerender(<MatchCard {...props} prediction={{ ...prediction, predicted_classified: 'home' }} />)
  expect(input).toHaveValue(3)
})

it('permite escolher pênaltis no draft com ida pendente, preservando a gravação para Salvar todos', async () => {
  const onPenaltyDraftChange = vi.fn()
  render(
    <MatchCard
      match={makeMatch({ tie_role: 'leg2', decides_on_penalties: true })}
      prediction={makePrediction({ predicted_home_score: 2, predicted_away_score: 0 })}
      leg1Prediction={makePrediction({ predicted_home_score: 2, predicted_away_score: 0 })}
      leg1Pending
      groupId="g"
      onSaved={vi.fn()}
      onPenaltyDraftChange={onPenaltyDraftChange}
    />,
  )
  await userEvent.click(screen.getByRole('radio', { name: 'BRA' }))
  expect(onPenaltyDraftChange).toHaveBeenCalledWith('match-1', 'home')
  expect(screen.getByRole('button', { name: 'Atualizar' })).toBeDisabled()
})

it('mostra a escolha de resultado em edição na volta quando a ida aguarda salvar', async () => {
  const onDraftChange = vi.fn()
  render(
    <MatchCard
      match={makeMatch({ tie_role: 'leg2', decides_on_penalties: true })}
      prediction={makePrediction({ predicted_home_score: 0, predicted_away_score: 1 })}
      leg1Prediction={makePrediction({ predicted_home_score: 1, predicted_away_score: 0 })}
      outcomeOnly
      leg1Pending
      groupId="g"
      onSaved={vi.fn()}
      onDraftChange={onDraftChange}
    />,
  )
  await userEvent.click(screen.getByRole('radio', { name: 'Casa' }))
  expect(onDraftChange).toHaveBeenCalledWith('match-1', '1', '0')
  expect(screen.getByRole('radio', { name: 'Casa' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('radiogroup', { name: 'Quem vence nos pênaltis?' })).toBeInTheDocument()
})

describe('MatchCard placar da ida e agregado', () => {
  const leg1 = makeMatch({
    id: 'leg1',
    tie_role: 'leg1',
    status: 'finished',
    start_time: '2020-01-01T00:00:00Z',
    home_team_name: 'Argentina',
    away_team_name: 'Brasil',
    home_score: 1,
    away_score: 0,
  })
  const leg2 = makeMatch({ tie_role: 'leg2', leg1_match_id: 'leg1' })

  function renderLeg2(overrides: Partial<Match>, props: Partial<Parameters<typeof MatchCard>[0]>) {
    return render(
      <MatchCard
        match={{ ...leg2, ...overrides }}
        prediction={undefined}
        groupId="g"
        onSaved={vi.fn()}
        {...props}
      />,
    )
  }

  it('mostra o placar real da ida na volta ainda aberta', () => {
    renderLeg2({}, { leg1Match: leg1 })
    expect(screen.getByText('Ida: Argentina 1 × 0 Brasil')).toBeInTheDocument()
    expect(screen.queryByText(/^Agregado/)).not.toBeInTheDocument()
  })

  it('mostra o agregado previsto quando a ida foi palpitada e a volta está completa', async () => {
    renderLeg2(
      {},
      { leg1Prediction: makePrediction({ predicted_home_score: 2, predicted_away_score: 0 }) },
    )
    expect(screen.queryByText(/Agregado previsto/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    expect(screen.getByText('Agregado previsto 1 × 3')).toBeInTheDocument()
  })

  it('não mostra nada novo com a ida sem resultado', () => {
    renderLeg2(
      {},
      { leg1Match: { ...leg1, status: 'scheduled', home_score: null, away_score: null } },
    )
    expect(screen.queryByText(/^Ida:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Agregado/)).not.toBeInTheDocument()
  })

  it('não mostra nada no jogo de ida nem no jogo único', () => {
    renderCard(makeMatch({ tie_role: 'leg1' }), undefined)
    renderCard(makeMatch({ tie_role: 'single' }), undefined)
    expect(screen.queryByText(/^Ida:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Agregado/)).not.toBeInTheDocument()
  })

  it('mostra o agregado e quem avançou na volta encerrada', () => {
    renderLeg2(
      { status: 'finished', start_time: '2020-02-01T00:00:00Z', home_score: 1, away_score: 1 },
      { leg1Match: leg1 },
    )
    expect(screen.getByText('Ida: Argentina 1 × 0 Brasil')).toBeInTheDocument()
    expect(screen.getByText('Agregado 1 × 2 · Argentina avançou')).toBeInTheDocument()
  })

  it('diz que o classificado saiu nos pênaltis', () => {
    renderLeg2(
      {
        status: 'finished',
        start_time: '2020-02-01T00:00:00Z',
        home_score: 1,
        away_score: 0,
        penalty_winner: 'home',
        home_penalty_goals: 4,
        away_penalty_goals: 3,
      },
      { leg1Match: leg1 },
    )
    expect(screen.getByText('Agregado 1 × 1 · Brasil avançou nos pênaltis')).toBeInTheDocument()
  })
})

describe('MatchCard – falha no salvamento', () => {
  function Parent({ onSaved, outcomeOnly }: { onSaved?: () => void; outcomeOnly?: boolean }) {
    const [prediction, setPrediction] = useState<Prediction | undefined>(undefined)
    return (
      <MatchCard
        match={makeMatch()}
        prediction={prediction}
        groupId="group-1"
        outcomeOnly={outcomeOnly}
        onSaved={(_id, home, away) => {
          onSaved?.()
          setPrediction(makePrediction({ predicted_home_score: home, predicted_away_score: away }))
        }}
      />
    )
  }

  async function fillOneToZero(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await user.click(screen.getByRole('button', { name: /Diminuir placar Argentina/i }))
  }

  function scoreValues() {
    return [
      (screen.getByRole('spinbutton', { name: /Placar Brasil/i }) as HTMLInputElement).value,
      (screen.getByRole('spinbutton', { name: /Placar Argentina/i }) as HTMLInputElement).value,
    ]
  }

  it('falha de rede devolve o card ao valor anterior e mostra o erro', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    try {
      render(<Parent />)
      await fillOneToZero(user)

      await user.click(screen.getByRole('button', { name: 'Salvar' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Erro de conexão. Tente novamente.',
      )
      const button = screen.getByRole('button', { name: 'Salvar' })
      expect(button).toBeDisabled()
      expect(scoreValues()).toEqual(['', ''])
      expect(screen.getByText('sem palpite')).toBeInTheDocument()
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('erro 4xx devolve o card ao palpite salvo anterior com a mensagem da API', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: 'Jogo já começou' }), { status: 409 }))
    const user = userEvent.setup()
    function EditParent() {
      const [prediction, setPrediction] = useState<Prediction | undefined>(
        makePrediction({ predicted_home_score: 1, predicted_away_score: 2 }),
      )
      return (
        <MatchCard
          match={makeMatch()}
          prediction={prediction}
          groupId="group-1"
          onSaved={(_id, home, away) =>
            setPrediction(makePrediction({ predicted_home_score: home, predicted_away_score: away }))
          }
        />
      )
    }
    try {
      render(<EditParent />)
      await user.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
      expect(scoreValues()).toEqual(['2', '2'])

      await user.click(screen.getByRole('button', { name: 'Atualizar' }))
      expect(screen.getByText('palpite salvo')).toBeInTheDocument()

      expect(await screen.findByRole('alert')).toHaveTextContent('Jogo já começou')
      expect(scoreValues()).toEqual(['1', '2'])
      expect(screen.getByText('palpite salvo')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Salvo' })).toHaveAttribute('aria-disabled', 'true')
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('tentar de novo depois da falha envia uma vez e limpa o erro', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const onSaved = vi.fn()
    const user = userEvent.setup()
    try {
      render(<Parent onSaved={onSaved} />)
      await fillOneToZero(user)

      await user.click(screen.getByRole('button', { name: 'Salvar' }))
      await screen.findByText('Erro de conexão. Tente novamente.')
      expect(scoreValues()).toEqual(['', ''])

      await fillOneToZero(user)
      await user.click(screen.getByRole('button', { name: 'Salvar' }))

      expect(await screen.findByRole('button', { name: 'Salvo' })).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(onSaved).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Erro de conexão. Tente novamente.')).not.toBeInTheDocument()
      expect(scoreValues()).toEqual(['1', '0'])
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('no modo só vencedor, tocar de novo na opção depois da falha envia outra vez', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const user = userEvent.setup()
    try {
      render(<Parent outcomeOnly />)

      await user.click(screen.getByRole('radio', { name: 'Casa' }))
      await screen.findByText('Erro de conexão. Tente novamente.')
      expect(screen.getByRole('radio', { name: 'Casa' })).toBeEnabled()
      expect(screen.getByRole('radio', { name: 'Casa' })).not.toBeChecked()
      await user.click(screen.getByRole('radio', { name: 'Casa' }))

      expect(await screen.findByText('Salvo!')).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(screen.queryByText('Erro de conexão. Tente novamente.')).not.toBeInTheDocument()

      await user.click(screen.getByRole('radio', { name: 'Casa' }))
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('mostra o palpite salvo antes de a API responder e não sobrescreve edição feita no meio', async () => {
    let respond: (res: Response) => void = () => {}
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve
        }),
    )
    const user = userEvent.setup()
    try {
      const view = render(<Parent />)
      const invalidateSpy = vi.spyOn(view.queryClient, 'invalidateQueries')
      await fillOneToZero(user)

      await user.click(screen.getByRole('button', { name: 'Salvar' }))
      const card = screen.getByRole('group', { name: /^Brasil contra Argentina/ })
      expect(card).toHaveAttribute('aria-busy', 'true')
      const liveAnnouncement = screen.getByText('Salvando palpite...')
      expect(liveAnnouncement).toHaveAttribute('aria-live', 'polite')
      expect(liveAnnouncement).toHaveClass('sr-only')
      expect(screen.getByRole('spinbutton', { name: /Placar Brasil/i })).toBeEnabled()
      expect(screen.getByRole('spinbutton', { name: /Placar Argentina/i })).toBeEnabled()
      expect(screen.getByText('palpite salvo')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Salvo' })).toHaveAttribute('aria-disabled', 'true')
      expect(invalidateSpy).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
      await user.type(screen.getByRole('spinbutton', { name: /Placar Argentina/i }), '3')
      expect(scoreValues()).toEqual(['2', '3'])
      expect(screen.getByText('alterado, não salvo')).toBeInTheDocument()

      respond(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      await screen.findByRole('button', { name: 'Atualizar' })
      expect(card).toHaveAttribute('aria-busy', 'false')
      expect(screen.queryByText('Salvando palpite...')).not.toBeInTheDocument()
      expect(scoreValues()).toEqual(['2', '3'])
      expect(screen.getByText('alterado, não salvo')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Atualizar' })).toBeEnabled()
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['groups', 'list'],
        refetchType: 'none',
      })
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['groups', 'predictions'],
        refetchType: 'none',
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('envios concorrentes em ordem invertida abortam o anterior, não sobrescrevem o último e mantêm o rollback em 2×0', async () => {
    const puts: Array<{
      resolve: (res: Response) => void
      reject: (err: unknown) => void
      signal?: AbortSignal
    }> = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          puts.push({ resolve, reject, signal: init?.signal ?? undefined })
        }),
    )
    const onSaved = vi.fn()
    const user = userEvent.setup()
    try {
      function ControlledParent() {
        const [prediction, setPrediction] = useState<Prediction | undefined>(undefined)
        return (
          <MatchCard
            match={makeMatch()}
            prediction={prediction}
            groupId="group-1"
            onSaved={(_id, home, away, penalty) => {
              onSaved(home, away, penalty)
              setPrediction(
                makePrediction({
                  predicted_home_score: home,
                  predicted_away_score: away,
                  predicted_penalty_winner: penalty,
                }),
              )
            }}
          />
        )
      }

      render(<ControlledParent />)
      await fillOneToZero(user)
      await user.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(puts).toHaveLength(1)
      expect(puts[0].signal?.aborted).toBe(false)

      await user.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
      await user.click(screen.getByRole('button', { name: 'Atualizar' }))
      expect(puts).toHaveLength(2)
      expect(puts[0].signal?.aborted).toBe(true)

      await act(async () => {
        puts[1].resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      })
      expect(onSaved).toHaveBeenCalledTimes(1)
      expect(onSaved).toHaveBeenLastCalledWith(2, 0, null)

      await act(async () => {
        puts[0].resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      })
      expect(onSaved).toHaveBeenCalledTimes(1)
      expect(scoreValues()).toEqual(['2', '0'])

      await user.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
      await user.click(screen.getByRole('button', { name: 'Atualizar' }))
      expect(puts).toHaveLength(3)

      await act(async () => {
        puts[2].resolve(
          new Response(JSON.stringify({ error: 'Jogo já começou' }), { status: 409 }),
        )
      })
      expect(await screen.findByRole('alert')).toHaveTextContent('Jogo já começou')
      expect(scoreValues()).toEqual(['2', '0'])
    } finally {
      fetchMock.mockRestore()
    }
  })
})

