import { describe, expect, it } from 'vitest'
import {
  buildUnlikelyCandidates,
  isUnlikelyExact,
  needsRarityRecompute,
  outsideTipsterCount,
  pendingUnlikelyInserts,
  qualifiesUnlikelyExact,
  summarizeUnlikelyExacts,
  UNLIKELY_EXACT_MAX_PERCENT,
  UNLIKELY_EXACT_MIN_OUTSIDE_TIPSTERS,
  UNLIKELY_EXACT_MIN_TIPSTERS,
  type UnlikelyExactCandidate,
  type UnlikelyExactRow,
} from './unlikelyExacts'

describe('isUnlikelyExact', () => {
  it('recusa abaixo do mínimo de palpiteiros', () => {
    expect(isUnlikelyExact(UNLIKELY_EXACT_MIN_TIPSTERS - 1, 1)).toBe(false)
    expect(isUnlikelyExact(0, 0)).toBe(false)
  })

  it('aceita no limiar de 10% com M = 10', () => {
    expect(isUnlikelyExact(10, 1)).toBe(true)
    expect(isUnlikelyExact(20, 2)).toBe(true)
    expect(isUnlikelyExact(11, 1)).toBe(true)
  })

  it('recusa acima de 10% ou sem acerto', () => {
    expect(isUnlikelyExact(10, 2)).toBe(false)
    expect(isUnlikelyExact(9, 1)).toBe(false)
    expect(isUnlikelyExact(20, 3)).toBe(false)
    expect(isUnlikelyExact(10, 0)).toBe(false)
  })
})

describe('qualifiesUnlikelyExact', () => {
  it('exige tipsters fora do grupo além da raridade', () => {
    expect(
      qualifiesUnlikelyExact(20, 1, UNLIKELY_EXACT_MIN_OUTSIDE_TIPSTERS - 1),
    ).toBe(false)
    expect(qualifiesUnlikelyExact(20, 1, UNLIKELY_EXACT_MIN_OUTSIDE_TIPSTERS)).toBe(true)
    expect(qualifiesUnlikelyExact(20, 3, UNLIKELY_EXACT_MIN_OUTSIDE_TIPSTERS)).toBe(false)
  })

  it('reproduz o cenário 19 conhecidos + 1 privado', () => {
    // 19 no grupo de quem lê + 1 de fora: raridade 5% ou 10% conforme o privado,
    // mas o reconhecimento não vale porque só há 1 tipster fora do grupo.
    expect(qualifiesUnlikelyExact(20, 1, 1)).toBe(false)
    expect(qualifiesUnlikelyExact(20, 2, 1)).toBe(false)
  })

  it('aceita no limiar de fora do grupo com raridade ok', () => {
    expect(qualifiesUnlikelyExact(11, 1, 10)).toBe(true)
    expect(qualifiesUnlikelyExact(11, 1, 9)).toBe(false)
  })
})

describe('outsideTipsterCount', () => {
  it('subtrai os tipsters do grupo sem ficar negativo', () => {
    expect(outsideTipsterCount(20, 19)).toBe(1)
    expect(outsideTipsterCount(10, 10)).toBe(0)
    expect(outsideTipsterCount(10, 12)).toBe(0)
  })
})

describe('needsRarityRecompute', () => {
  it('pede recálculo sem snapshot ou com scored_at diferente', () => {
    expect(
      needsRarityRecompute({
        match_id: 'm1',
        home_score: 1,
        away_score: 0,
        scored_at: '2026-06-02T00:00:00Z',
        tipster_count: null,
        exact_count: null,
        scored_at_snapshot: null,
      }),
    ).toBe(true)
    expect(
      needsRarityRecompute({
        match_id: 'm1',
        home_score: 1,
        away_score: 0,
        scored_at: '2026-06-03T00:00:00Z',
        tipster_count: 10,
        exact_count: 1,
        scored_at_snapshot: '2026-06-02T00:00:00Z',
      }),
    ).toBe(true)
    expect(
      needsRarityRecompute({
        match_id: 'm1',
        home_score: 1,
        away_score: 0,
        scored_at: '2026-06-02T00:00:00Z',
        tipster_count: 10,
        exact_count: 1,
        scored_at_snapshot: '2026-06-02T00:00:00Z',
      }),
    ).toBe(false)
  })
})

describe('buildUnlikelyCandidates', () => {
  it('aplica raridade e mínimo fora do grupo', () => {
    const candidates = buildUnlikelyCandidates(
      [
        {
          user_id: 'alice',
          match_id: 'm1',
          home_score: 1,
          away_score: 0,
          tipster_count: 20,
          exact_tipster_count: 1,
        },
        {
          user_id: 'bob',
          match_id: 'm2',
          home_score: 2,
          away_score: 1,
          tipster_count: 20,
          exact_tipster_count: 1,
        },
      ],
      new Map([
        ['m1', 1],
        ['m2', 19],
      ]),
    )
    expect(candidates.map((c) => c.user_id)).toEqual(['alice'])
    expect(candidates[0]?.outside_tipster_count).toBe(19)
  })
})

describe('summarizeUnlikelyExacts', () => {
  it('marca quem tem linha na rodada, sem percentual', () => {
    const rows: UnlikelyExactRow[] = [
      {
        user_id: 'alice',
        match_id: 'm1',
        tipster_count: 20,
        exact_tipster_count: 1,
        outside_tipster_count: 19,
        home_score: 1,
        away_score: 0,
      },
      {
        user_id: 'bob',
        match_id: 'm1',
        tipster_count: 20,
        exact_tipster_count: 1,
        outside_tipster_count: 19,
        home_score: 1,
        away_score: 0,
      },
    ]

    expect(Object.fromEntries(summarizeUnlikelyExacts(rows, ['alice', 'bob', 'carol']))).toEqual({
      alice: { unlikely_exact: true },
      bob: { unlikely_exact: true },
      carol: { unlikely_exact: false },
    })
  })
})

describe('pendingUnlikelyInserts', () => {
  it('omite candidatos já gravados', () => {
    const candidates: UnlikelyExactCandidate[] = [
      {
        user_id: 'alice',
        match_id: 'm1',
        tipster_count: 11,
        exact_tipster_count: 1,
        outside_tipster_count: 10,
        home_score: 1,
        away_score: 0,
      },
      {
        user_id: 'bob',
        match_id: 'm1',
        tipster_count: 11,
        exact_tipster_count: 1,
        outside_tipster_count: 10,
        home_score: 1,
        away_score: 0,
      },
    ]
    const existing: UnlikelyExactRow[] = [
      {
        user_id: 'alice',
        match_id: 'm1',
        tipster_count: 11,
        exact_tipster_count: 1,
        outside_tipster_count: 10,
        home_score: 1,
        away_score: 0,
      },
    ]

    expect(pendingUnlikelyInserts(candidates, existing).map((c) => c.user_id)).toEqual(['bob'])
  })
})

describe('constantes públicas', () => {
  it('mantém o limiar público de 10%', () => {
    expect(UNLIKELY_EXACT_MAX_PERCENT).toBe(10)
    expect(UNLIKELY_EXACT_MIN_TIPSTERS).toBe(10)
    expect(UNLIKELY_EXACT_MIN_OUTSIDE_TIPSTERS).toBe(10)
  })
})
