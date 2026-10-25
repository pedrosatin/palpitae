import { describe, expect, it } from 'vitest'
import { makeMatch } from '../components/matchFixtures'
import { collectRoundDrafts } from './predictionDrafts'
import type { Prediction } from '../components/MatchCard'

const past = new Date(Date.now() - 3_600_000).toISOString()
const future = new Date(Date.now() + 3_600_000).toISOString()

function pred(overrides: Partial<Prediction> = {}): Prediction {
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

describe('collectRoundDrafts – locking (ADR-004)', () => {
  it('inclui adiado com horário passado, sem locked_at e sem prediction.locked', () => {
    const match = makeMatch({
      id: 'm-postponed',
      start_time: past,
      status: 'scheduled',
      postponed: 1,
    })
    const pending = collectRoundDrafts({
      roundMatches: [match],
      drafts: new Map([['m-postponed', { home: '0', away: '0' }]]),
      penaltyDrafts: new Map(),
      predictions: new Map(),
    })
    expect(pending).toEqual([
      {
        match_id: 'm-postponed',
        predicted_home_score: 0,
        predicted_away_score: 0,
        predicted_penalty_winner: null,
      },
    ])
  })

  it('inclui adiado com draft diferente de placar já salvo', () => {
    const match = makeMatch({
      id: 'm-postponed',
      start_time: past,
      status: 'scheduled',
      postponed: true,
    })
    const pending = collectRoundDrafts({
      roundMatches: [match],
      drafts: new Map([['m-postponed', { home: '2', away: '1' }]]),
      penaltyDrafts: new Map(),
      predictions: new Map([['m-postponed', pred({ match_id: 'm-postponed' })]]),
    })
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      match_id: 'm-postponed',
      predicted_home_score: 2,
      predicted_away_score: 1,
    })
  })

  it('exclui adiado com locked_at (sync já viu o jogo iniciado)', () => {
    const match = makeMatch({
      id: 'm-postponed-locked',
      start_time: past,
      status: 'scheduled',
      postponed: 1,
      locked_at: past,
    })
    expect(
      collectRoundDrafts({
        roundMatches: [match],
        drafts: new Map([['m-postponed-locked', { home: '1', away: '0' }]]),
        penaltyDrafts: new Map(),
        predictions: new Map(),
      }),
    ).toEqual([])
  })

  it('exclui adiado com prediction.locked derivado do servidor', () => {
    const match = makeMatch({
      id: 'm-postponed',
      start_time: past,
      status: 'scheduled',
      postponed: 1,
    })
    expect(
      collectRoundDrafts({
        roundMatches: [match],
        drafts: new Map([['m-postponed', { home: '1', away: '0' }]]),
        penaltyDrafts: new Map(),
        predictions: new Map([
          ['m-postponed', pred({ match_id: 'm-postponed', locked: 1 })],
        ]),
      }),
    ).toEqual([])
  })

  it('exclui jogo live mesmo com start_time futuro ou postponed', () => {
    const match = makeMatch({
      id: 'm-live',
      start_time: future,
      status: 'live',
      postponed: 1,
    })
    expect(
      collectRoundDrafts({
        roundMatches: [match],
        drafts: new Map([['m-live', { home: '1', away: '0' }]]),
        penaltyDrafts: new Map(),
        predictions: new Map(),
      }),
    ).toEqual([])
  })

  it('exclui jogo finished mesmo com postponed', () => {
    const match = makeMatch({
      id: 'm-finished',
      start_time: past,
      status: 'finished',
      postponed: 1,
    })
    expect(
      collectRoundDrafts({
        roundMatches: [match],
        drafts: new Map([['m-finished', { home: '1', away: '0' }]]),
        penaltyDrafts: new Map(),
        predictions: new Map(),
      }),
    ).toEqual([])
  })

  it('exclui jogo passado não adiado', () => {
    const match = makeMatch({
      id: 'm-past',
      start_time: past,
      status: 'scheduled',
      postponed: 0,
    })
    expect(
      collectRoundDrafts({
        roundMatches: [match],
        drafts: new Map([['m-past', { home: '1', away: '0' }]]),
        penaltyDrafts: new Map(),
        predictions: new Map(),
      }),
    ).toEqual([])
  })

  it('inclui jogo futuro aberto', () => {
    const match = makeMatch({ id: 'm-future', start_time: future, status: 'scheduled' })
    const pending = collectRoundDrafts({
      roundMatches: [match],
      drafts: new Map([['m-future', { home: '3', away: '1' }]]),
      penaltyDrafts: new Map(),
      predictions: new Map(),
    })
    expect(pending).toHaveLength(1)
    expect(pending[0]?.match_id).toBe('m-future')
  })

  it('não inclui draft incompleto (campo vazio)', () => {
    const match = makeMatch({ id: 'm1', start_time: future })
    expect(
      collectRoundDrafts({
        roundMatches: [match],
        drafts: new Map([['m1', { home: '1', away: '' }]]),
        penaltyDrafts: new Map(),
        predictions: new Map(),
      }),
    ).toEqual([])
  })

  it('não inclui placar idêntico ao já salvo', () => {
    const match = makeMatch({ id: 'm1', start_time: future })
    expect(
      collectRoundDrafts({
        roundMatches: [match],
        drafts: new Map([['m1', { home: '1', away: '0' }]]),
        penaltyDrafts: new Map(),
        predictions: new Map([['m1', pred()]]),
      }),
    ).toEqual([])
  })
})
