import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MatchCard, { type Match, type Prediction } from './MatchCard'

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
  it('uses 0 as the default draft and enables save after changing only one field', async () => {
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
    expect(saveBtn).toBeDisabled()

    await userEvent.click(
      screen.getByRole('button', { name: /Aumentar placar Argentina/i }),
    )

    expect(saveBtn).toBeEnabled()
  })

  it('enables save when there is no prediction and both fields are filled', async () => {
    renderCard(makeMatch(), undefined)

    // Initial state: both fields are empty → button disabled
    const saveBtn = screen.getByRole('button', { name: /Salvar/i })
    expect(saveBtn).toBeDisabled()

    // Fill both fields via the "+" steppers
    await userEvent.click(
      screen.getByRole('button', { name: /Aumentar placar Brasil/i }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: /Aumentar placar Argentina/i }),
    )

    expect(saveBtn).toBeEnabled()
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
