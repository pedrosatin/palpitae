import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import MatchCard, { type Match, type Prediction } from './MatchCard'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 'match-1',
    start_time: new Date(Date.now() + 3_600_000).toISOString(), // 1 h in the future
    status: 'scheduled',
    home_score: null,
    away_score: null,
    phase: 'group',
    round: '1',
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

// ─── Helpers ───────────────────────────────────────────────────────────────

function renderCard(
  match: Match,
  prediction: Prediction | undefined,
  onSaved = vi.fn(),
) {
  return render(
    <MatchCard
      match={match}
      prediction={prediction}
      groupId="group-1"
      onSaved={onSaved}
    />,
  )
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('MatchCard – hasChanged / canSave', () => {
  it('enables save immediately at 0x0 initial state when no prediction exists', () => {
    renderCard(makeMatch(), undefined)

    const homeInput = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    const awayInput = screen.getByRole('spinbutton', {
      name: /Placar Argentina/i,
    }) as HTMLInputElement
    const saveBtn = screen.getByRole('button', { name: /Salvar/i })

    expect(homeInput.value).toBe('0')
    expect(awayInput.value).toBe('0')
    expect(saveBtn).toBeEnabled()
  })

  it('keeps save enabled after the user changes values when no prediction exists', async () => {
    renderCard(makeMatch(), undefined)

    await userEvent.click(
      screen.getByRole('button', { name: /Aumentar placar Brasil/i }),
    )

    expect(screen.getByRole('button', { name: /Salvar/i })).toBeEnabled()
  })

  it('disables save when prediction matches the current input (hasChanged = false)', () => {
    // prediction is 1×2; initial inputs will be '1' and '2' → hasChanged = false
    renderCard(makeMatch(), makePrediction())

    // button shows "Atualizar" and is disabled because values haven't changed
    expect(screen.getByRole('button', { name: /Atualizar/i })).toBeDisabled()
  })

  it('enables save when the user changes at least one field (hasChanged = true)', async () => {
    renderCard(makeMatch(), makePrediction())

    // Increase home score from 1 to 2 — now differs from prediction (1×2)
    await userEvent.click(
      screen.getByRole('button', { name: /Aumentar placar Brasil/i }),
    )

    expect(screen.getByRole('button', { name: /Atualizar/i })).toBeEnabled()
  })
})

describe('MatchCard – Stepper "+"', () => {
  it('increments from 0 to 1 when "+" is clicked', async () => {
    renderCard(makeMatch(), undefined)

    await userEvent.click(
      screen.getByRole('button', { name: /Aumentar placar Brasil/i }),
    )

    const input = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    expect(input.value).toBe('1')
  })

  it('does not exceed 99 when "+" is clicked at the maximum', async () => {
    // Start with prediction at 99 so initial value is '99'
    renderCard(
      makeMatch(),
      makePrediction({ predicted_home_score: 99, predicted_away_score: 0 }),
    )

    await userEvent.click(
      screen.getByRole('button', { name: /Aumentar placar Brasil/i }),
    )

    const input = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    expect(input.value).toBe('99')
  })

  it('treats an empty field as 0 when "+" is clicked', async () => {
    // No prediction → fields start at 0
    renderCard(makeMatch(), undefined)

    const input = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    expect(input.value).toBe('0')

    await userEvent.click(
      screen.getByRole('button', { name: /Aumentar placar Brasil/i }),
    )

    expect(input.value).toBe('1')
  })
})

describe('MatchCard – Stepper "−"', () => {
  it('decrements from 2 to 1 when "−" is clicked', async () => {
    renderCard(
      makeMatch(),
      makePrediction({ predicted_home_score: 2, predicted_away_score: 0 }),
    )

    await userEvent.click(
      screen.getByRole('button', { name: /Diminuir placar Brasil/i }),
    )

    const input = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    expect(input.value).toBe('1')
  })

  it('does not go below 0 when "−" is clicked at the minimum', async () => {
    renderCard(
      makeMatch(),
      makePrediction({ predicted_home_score: 0, predicted_away_score: 0 }),
    )

    await userEvent.click(
      screen.getByRole('button', { name: /Diminuir placar Brasil/i }),
    )

    const input = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    expect(input.value).toBe('0')
  })

  it('treats an empty field as 0 when "−" is clicked', async () => {
    renderCard(makeMatch(), undefined)

    const input = screen.getByRole('spinbutton', {
      name: /Placar Brasil/i,
    }) as HTMLInputElement
    expect(input.value).toBe('0')

    await userEvent.click(
      screen.getByRole('button', { name: /Diminuir placar Brasil/i }),
    )

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
    await userEvent.click(screen.getByRole('button', { name: /Salvar/i }))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_matchcard_salvar', { match_id: 'match-1' })
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

    expect(screen.getByRole('button', { name: 'Casa' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Empate' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fora' })).toBeInTheDocument()
    expect(
      screen.queryByRole('spinbutton', { name: /Placar Brasil/i }),
    ).not.toBeInTheDocument()
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

    await userEvent.click(screen.getByRole('button', { name: 'Casa' }))

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
    // prediction 0×1 → away wins → "Fora" active
    render(
      <MatchCard
        match={makeMatch()}
        prediction={makePrediction({ predicted_home_score: 0, predicted_away_score: 1 })}
        groupId="group-1"
        outcomeOnly
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Fora' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Casa' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
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
    // Shows the locked prediction instead
    expect(screen.getByText('seu palpite')).toBeInTheDocument()
  })

  it('hides the steppers and input row when match start_time has already passed', () => {
    const pastMatch = makeMatch({
      start_time: new Date(Date.now() - 3_600_000).toISOString(), // 1 h ago
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

  it('shows the penalty picker only after a draw is marked (score mode)', async () => {
    renderCard(penaltyMatch(), undefined)

    // Untouched default 0-0 must NOT surface the picker yet.
    expect(screen.queryByText('Quem vence nos pênaltis?')).not.toBeInTheDocument()

    // Bump both sides to 1-1 → a marked draw.
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))

    expect(screen.getByText('Quem vence nos pênaltis?')).toBeInTheDocument()
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

    await userEvent.click(screen.getByRole('button', { name: 'BRA' }))
    expect(saveBtn).toBeEnabled()

    await userEvent.click(saveBtn)
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.predicted_penalty_winner).toBe('home')
  })

  it('clears the penalty pick when the score is changed away from a draw', async () => {
    renderCard(penaltyMatch(), undefined)
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    expect(screen.getByText('Quem vence nos pênaltis?')).toBeInTheDocument()

    // 1-1 → 2-1 hides the picker.
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    expect(screen.queryByText('Quem vence nos pênaltis?')).not.toBeInTheDocument()
  })

  it('does not show the picker for a non-penalty match', async () => {
    renderCard(makeMatch({ decides_on_penalties: false }), undefined)
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Brasil/i }))
    await userEvent.click(screen.getByRole('button', { name: /Aumentar placar Argentina/i }))
    expect(screen.queryByText('Quem vence nos pênaltis?')).not.toBeInTheDocument()
  })

  it('outcome mode: clicking Empate waits for the penalty winner before persisting', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)
    const onSaved = vi.fn()

    render(
      <MatchCard
        match={penaltyMatch()}
        prediction={undefined}
        groupId="group-1"
        outcomeOnly
        onSaved={onSaved}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Empate' }))
    // No persist yet — the picker is shown instead.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Quem vence nos pênaltis?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'ARG' }))
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.predicted_home_score).toBe(0)
    expect(body.predicted_away_score).toBe(0)
    expect(body.predicted_penalty_winner).toBe('away')
    expect(onSaved).toHaveBeenCalledWith('match-1', 0, 0, 'away')
  })
})
