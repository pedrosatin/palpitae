import { describe, expect, it } from 'vitest'
import { makeMatch } from '../components/matchFixtures'
import { collectRoundDrafts, pruneUnsavedDrafts } from './predictionDrafts'
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

describe('pruneUnsavedDrafts', () => {
  const open = makeMatch({ id: 'm1' })

  it('mantém placar diferente do salvo e descarta o igual', () => {
    const { drafts } = pruneUnsavedDrafts({
      matches: [open, makeMatch({ id: 'm2' })],
      predictions: new Map([
        ['m1', pred()],
        ['m2', pred({ match_id: 'm2', predicted_home_score: 2, predicted_away_score: 2 })],
      ]),
      drafts: new Map([
        ['m1', { home: '3', away: '0' }],
        ['m2', { home: '2', away: '2' }],
      ]),
      penaltyDrafts: new Map(),
    })
    expect([...drafts]).toEqual([['m1', { home: '3', away: '0' }]])
  })

  it('mantém rascunho de jogo sem palpite salvo, inclusive 0×0', () => {
    const { drafts } = pruneUnsavedDrafts({
      matches: [open],
      predictions: new Map(),
      drafts: new Map([['m1', { home: '0', away: '0' }]]),
      penaltyDrafts: new Map(),
    })
    expect(drafts.get('m1')).toEqual({ home: '0', away: '0' })
  })

  it('descarta jogo travado, jogo desconhecido e campo vazio', () => {
    const result = pruneUnsavedDrafts({
      matches: [
        makeMatch({ id: 'started', start_time: past }),
        makeMatch({ id: 'live', status: 'live' }),
        makeMatch({ id: 'typing' }),
      ],
      predictions: new Map(),
      drafts: new Map([
        ['started', { home: '1', away: '0' }],
        ['live', { home: '1', away: '0' }],
        ['gone', { home: '1', away: '0' }],
        ['typing', { home: '', away: '2' }],
      ]),
      penaltyDrafts: new Map([
        ['started', 'home'],
        ['gone', 'away'],
      ]),
    })
    expect(result.drafts.size).toBe(0)
    expect(result.penaltyDrafts.size).toBe(0)
  })

  it('julga o pênalti em separado do placar', () => {
    const result = pruneUnsavedDrafts({
      matches: [open, makeMatch({ id: 'm2' })],
      predictions: new Map([
        ['m1', pred({ predicted_home_score: 1, predicted_away_score: 1, predicted_penalty_winner: 'home' })],
        ['m2', pred({ match_id: 'm2', predicted_penalty_winner: 'away' })],
      ]),
      drafts: new Map([['m1', { home: '1', away: '1' }]]),
      penaltyDrafts: new Map([
        ['m1', 'away'],
        ['m2', 'away'],
      ]),
    })
    expect(result.drafts.size).toBe(0)
    expect([...result.penaltyDrafts]).toEqual([['m1', 'away']])
  })
})
