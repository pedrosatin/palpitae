import { describe, expect, it } from 'vitest'
import {
  isUnlikelyExact,
  pendingUnlikelyInserts,
  roundUnlikelyPercent,
  summarizeUnlikelyExacts,
  UNLIKELY_EXACT_MAX_PERCENT,
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

describe('roundUnlikelyPercent', () => {
  it('arredonda e limita ao teto de X%', () => {
    expect(roundUnlikelyPercent(10, 1)).toBe(10)
    expect(roundUnlikelyPercent(11, 1)).toBe(9)
    expect(roundUnlikelyPercent(30, 1)).toBe(3)
    expect(roundUnlikelyPercent(100, 1)).toBe(1)
  })

  it('nunca devolve 0 quando há acerto', () => {
    expect(roundUnlikelyPercent(1000, 1)).toBe(1)
    expect(roundUnlikelyPercent(0, 1)).toBe(1)
  })

  it('respeita o máximo configurado', () => {
    expect(roundUnlikelyPercent(10, 1)).toBeLessThanOrEqual(UNLIKELY_EXACT_MAX_PERCENT)
  })
})

describe('summarizeUnlikelyExacts', () => {
  it('usa o menor percentual do membro e marca quem não tem linha', () => {
    const rows: UnlikelyExactRow[] = [
      {
        user_id: 'alice',
        match_id: 'm1',
        tipster_count: 20,
        exact_tipster_count: 1,
        percent_rounded: 5,
        home_score: 1,
        away_score: 0,
      },
      {
        user_id: 'alice',
        match_id: 'm2',
        tipster_count: 10,
        exact_tipster_count: 1,
        percent_rounded: 10,
        home_score: 2,
        away_score: 1,
      },
      {
        user_id: 'bob',
        match_id: 'm1',
        tipster_count: 20,
        exact_tipster_count: 1,
        percent_rounded: 5,
        home_score: 1,
        away_score: 0,
      },
    ]

    expect(Object.fromEntries(summarizeUnlikelyExacts(rows, ['alice', 'bob', 'carol']))).toEqual({
      alice: { unlikely_exact: true, unlikely_exact_percent: 5 },
      bob: { unlikely_exact: true, unlikely_exact_percent: 5 },
      carol: { unlikely_exact: false, unlikely_exact_percent: null },
    })
  })
})

describe('pendingUnlikelyInserts', () => {
  it('omite candidatos já gravados', () => {
    const candidates: UnlikelyExactCandidate[] = [
      {
        user_id: 'alice',
        match_id: 'm1',
        tipster_count: 10,
        exact_tipster_count: 1,
        home_score: 1,
        away_score: 0,
      },
      {
        user_id: 'bob',
        match_id: 'm1',
        tipster_count: 10,
        exact_tipster_count: 1,
        home_score: 1,
        away_score: 0,
      },
    ]
    const existing: UnlikelyExactRow[] = [
      {
        user_id: 'alice',
        match_id: 'm1',
        tipster_count: 10,
        exact_tipster_count: 1,
        percent_rounded: 10,
        home_score: 1,
        away_score: 0,
      },
    ]

    expect(pendingUnlikelyInserts(candidates, existing).map((c) => c.user_id)).toEqual(['bob'])
  })
})
