import { describe, expect, it } from 'vitest'
import { makeMatch } from '../components/matchFixtures'
import {
  collectRoundDrafts,
  dropStaleDrafts,
  pruneUnsavedDrafts,
  roundsWithDrafts,
  savedBase,
  type DraftEntry,
} from './predictionDrafts'
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

/** Rascunho digitado sobre `saved`, ou sobre jogo sem palpite. */
function typed<T>(value: T, saved?: Prediction): DraftEntry<T> {
  return { value, base: savedBase(saved), at: 0 }
}

const values = <T>(map: Map<string, DraftEntry<T>>) =>
  [...map].map(([matchId, entry]) => [matchId, entry.value])

describe('savedBase', () => {
  it('junta placar e pênalti salvos e marca o jogo sem palpite', () => {
    expect(savedBase(pred())).toBe('1:0:null')
    expect(savedBase(pred({ predicted_penalty_winner: 'away' }))).toBe('1:0:away')
    expect(savedBase(undefined)).toBe('sem palpite')
  })
})

describe('pruneUnsavedDrafts', () => {
  const open = makeMatch({ id: 'm1' })

  it('mantém placar diferente do salvo e descarta o igual', () => {
    const m2Saved = pred({ match_id: 'm2', predicted_home_score: 2, predicted_away_score: 2 })
    const { drafts } = pruneUnsavedDrafts({
      matches: [open, makeMatch({ id: 'm2' })],
      predictions: new Map([
        ['m1', pred()],
        ['m2', m2Saved],
      ]),
      drafts: new Map([
        ['m1', typed({ home: '3', away: '0' }, pred())],
        ['m2', typed({ home: '2', away: '2' }, m2Saved)],
      ]),
      penaltyDrafts: new Map(),
    })
    expect(values(drafts)).toEqual([['m1', { home: '3', away: '0' }]])
  })

  it('mantém rascunho de jogo sem palpite salvo, inclusive 0×0', () => {
    const { drafts } = pruneUnsavedDrafts({
      matches: [open],
      predictions: new Map(),
      drafts: new Map([['m1', typed({ home: '0', away: '0' })]]),
      penaltyDrafts: new Map(),
    })
    expect(drafts.get('m1')?.value).toEqual({ home: '0', away: '0' })
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
        ['started', typed({ home: '1', away: '0' })],
        ['live', typed({ home: '1', away: '0' })],
        ['gone', typed({ home: '1', away: '0' })],
        ['typing', typed({ home: '', away: '2' })],
      ]),
      penaltyDrafts: new Map([
        ['started', typed<'home' | 'away' | null>('home')],
        ['gone', typed<'home' | 'away' | null>('away')],
      ]),
    })
    expect(result.drafts.size).toBe(0)
    expect(result.penaltyDrafts.size).toBe(0)
  })

  it('descarta o rascunho digitado sobre um palpite salvo que mudou depois', () => {
    // Salvo 1×0, rascunho 3×0, e outro aparelho salvou 2×2.
    const knockout = makeMatch({ id: 'm2', decides_on_penalties: true })
    const result = pruneUnsavedDrafts({
      matches: [open, knockout],
      predictions: new Map([
        ['m1', pred({ predicted_home_score: 2, predicted_away_score: 2 })],
        ['m2', pred({ match_id: 'm2', predicted_home_score: 1, predicted_away_score: 1, predicted_penalty_winner: 'away' })],
      ]),
      drafts: new Map([['m1', typed({ home: '3', away: '0' }, pred())]]),
      penaltyDrafts: new Map([
        ['m2', typed<'home' | 'away' | null>('home', pred({ match_id: 'm2', predicted_home_score: 1, predicted_away_score: 1 }))],
      ]),
    })
    expect(result.drafts.size).toBe(0)
    expect(result.penaltyDrafts.size).toBe(0)
  })

  it('julga o pênalti em separado do placar', () => {
    const knockout = makeMatch({ id: 'm1', decides_on_penalties: true })
    const m1Saved = pred({ predicted_home_score: 1, predicted_away_score: 1, predicted_penalty_winner: 'home' })
    const m2Saved = pred({ match_id: 'm2', predicted_home_score: 0, predicted_away_score: 0, predicted_penalty_winner: 'away' })
    const result = pruneUnsavedDrafts({
      matches: [knockout, makeMatch({ id: 'm2', decides_on_penalties: true })],
      predictions: new Map([
        ['m1', m1Saved],
        ['m2', m2Saved],
      ]),
      drafts: new Map([['m1', typed({ home: '1', away: '1' }, m1Saved)]]),
      penaltyDrafts: new Map([
        ['m1', typed<'home' | 'away' | null>('away', m1Saved)],
        ['m2', typed<'home' | 'away' | null>('away', m2Saved)],
      ]),
    })
    expect(result.drafts.size).toBe(0)
    expect(values(result.penaltyDrafts)).toEqual([['m1', 'away']])
  })

  it('descarta o pênalti quando o placar resolvido não empata', () => {
    const knockout = makeMatch({ id: 'm1', decides_on_penalties: true })
    const result = pruneUnsavedDrafts({
      matches: [knockout, makeMatch({ id: 'group-stage' })],
      predictions: new Map([['m1', pred({ predicted_home_score: 1, predicted_away_score: 1 })]]),
      drafts: new Map([['m1', typed({ home: '2', away: '1' }, pred({ predicted_home_score: 1, predicted_away_score: 1 }))]]),
      penaltyDrafts: new Map([
        ['m1', typed<'home' | 'away' | null>('home', pred({ predicted_home_score: 1, predicted_away_score: 1 }))],
        ['group-stage', typed<'home' | 'away' | null>('home')],
      ]),
    })
    expect(values(result.drafts)).toEqual([['m1', { home: '2', away: '1' }]])
    expect(result.penaltyDrafts.size).toBe(0)
  })

  it('na volta, usa o rascunho da ida da mesma rodada para o agregado', () => {
    const leg1 = makeMatch({ id: 'ida', tie_role: 'leg1' })
    const leg2 = makeMatch({ id: 'volta', tie_role: 'leg2', leg1_match_id: 'ida', decides_on_penalties: true })
    const idaSaved = pred({ match_id: 'ida', predicted_home_score: 1, predicted_away_score: 0 })
    const voltaSaved = pred({ match_id: 'volta', predicted_home_score: 1, predicted_away_score: 0 })
    const input = {
      matches: [leg1, leg2],
      predictions: new Map([
        ['ida', idaSaved],
        ['volta', voltaSaved],
      ]),
      penaltyDrafts: new Map([['volta', typed<'home' | 'away' | null>('home', voltaSaved)]]),
    }
    // Ida salva 1×0 e volta 1×0 empatam o agregado em 1×1.
    expect(pruneUnsavedDrafts({ ...input, drafts: new Map() }).penaltyDrafts.size).toBe(1)
    // A ida em edição para 2×0 desfaz o empate.
    const undone = pruneUnsavedDrafts({
      ...input,
      drafts: new Map([['ida', typed({ home: '2', away: '0' }, idaSaved)]]),
    })
    expect(undone.penaltyDrafts.size).toBe(0)
    // Em outra rodada, o rascunho da ida não entra no agregado, como no "Salvar todos".
    const otherRound = pruneUnsavedDrafts({
      ...input,
      matches: [{ ...leg1, round: '2' }, leg2],
      drafts: new Map([['ida', typed({ home: '2', away: '0' }, idaSaved)]]),
    })
    expect(otherRound.penaltyDrafts.size).toBe(1)
  })
})

describe('dropStaleDrafts', () => {
  it('tira só o rascunho com base diferente do salvo e devolve o mesmo objeto sem mudança', () => {
    const fresh = {
      drafts: new Map([['m1', typed({ home: '3', away: '0' }, pred())]]),
      penaltyDrafts: new Map([['m2', typed<'home' | 'away' | null>('home')]]),
    }
    const predictions = new Map([['m1', pred()]])
    expect(dropStaleDrafts(fresh, predictions)).toBe(fresh)

    const changed = new Map([
      ['m1', pred({ predicted_home_score: 2, predicted_away_score: 2 })],
      ['m2', pred({ match_id: 'm2' })],
    ])
    const result = dropStaleDrafts(fresh, changed)
    expect(result.drafts.size).toBe(0)
    expect(result.penaltyDrafts.size).toBe(0)
  })
})

describe('roundsWithDrafts', () => {
  it('lista as rodadas com rascunho de placar ou de pênalti', () => {
    const rounds = roundsWithDrafts(
      [
        makeMatch({ id: 'a', round: '35' }),
        makeMatch({ id: 'b', round: '36' }),
        makeMatch({ id: 'c', round: '37' }),
      ],
      {
        drafts: new Map([['a', typed({ home: '1', away: '0' })]]),
        penaltyDrafts: new Map([['b', typed<'home' | 'away' | null>('home')]]),
      },
    )
    expect([...rounds]).toEqual(['35', '36'])
  })
})
