/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  buildUnlikelyCandidates,
  ensureMatchScoreRarity,
  isUnlikelyExact,
  MATCH_SCORE_RARITY_COMMIT_SQL,
  MATCH_SCORE_RARITY_COMPUTE_SQL,
  needsRarityRecompute,
  outsideTipsterCount,
  pendingUnlikelyInserts,
  qualifiesUnlikelyExact,
  summarizeUnlikelyExacts,
  tryReserveMatchScoreRarity,
  UNLIKELY_EXACT_MAX_PERCENT,
  UNLIKELY_EXACT_MIN_OUTSIDE_TIPSTERS,
  UNLIKELY_EXACT_MIN_TIPSTERS,
  type RoundMatchRarityRow,
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
  it('pede recálculo sem snapshot, em computing ou com scored_at diferente', () => {
    expect(
      needsRarityRecompute({
        match_id: 'm1',
        home_score: 1,
        away_score: 0,
        scored_at: '2026-06-02T00:00:00Z',
        tipster_count: null,
        exact_count: null,
        scored_at_snapshot: null,
        status: null,
      }),
    ).toBe(true)
    expect(
      needsRarityRecompute({
        match_id: 'm1',
        home_score: 1,
        away_score: 0,
        scored_at: '2026-06-02T00:00:00Z',
        tipster_count: 0,
        exact_count: 0,
        scored_at_snapshot: '2026-06-02T00:00:00Z',
        status: 'computing',
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
        status: 'ready',
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
        status: 'ready',
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

describe('reserva e commit de match_score_rarity', () => {
  function seedMatch(sqlite: ReturnType<typeof createSqliteD1>['sqlite'], scoredAt: string) {
    sqlite.exec(`
      INSERT INTO competitions (id, name, slug, season, status, type, penalty_phases, visibility)
      VALUES ('comp-a', 'Liga', 'liga', '2026', 'ongoing', 'league', '[]', 'public');
      INSERT INTO teams (id, name, short_name, slug) VALUES ('t0', 'A', 'A', 'a'), ('t1', 'B', 'B', 'b');
      INSERT INTO users (id, email, provider, provider_id, user_name)
      VALUES ('u0', 'u0@example.com', 'google', 'g0', 'U0');
      INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code)
      VALUES ('g0', 'G', 'comp-a', 'u0', 'AAAA-BBBB');
      INSERT INTO group_members (id, group_id, user_id, joined_at)
      VALUES ('gm0', 'g0', 'u0', '2026-01-01T00:00:00Z');
      INSERT INTO matches (
        id, competition_id, external_id, provider, home_team_id, away_team_id,
        start_time, status, round, phase, postponed, scored_at, home_score, away_score
      ) VALUES (
        'm1', 'comp-a', 'ext-1', 'football-data', 't0', 't1',
        '2026-06-01T19:00:00Z', 'finished', '1', 'REGULAR_SEASON', 0, '${scoredAt}', 1, 0
      );
      INSERT INTO predictions (
        id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded
      ) VALUES ('p0', 'u0', 'g0', 'm1', 1, 0, 3);
    `)
  }

  it('conclusão atrasada de S1 não sobrescreve agregado S2', async () => {
    const { sqlite, db } = createSqliteD1()
    const s1 = '2026-06-02T00:00:00Z'
    const s2 = '2026-06-03T00:00:00Z'
    seedMatch(sqlite, s1)

    expect(await tryReserveMatchScoreRarity(db, 'm1', s1)).toBe(true)
    const computedS1 = await db
      .prepare(MATCH_SCORE_RARITY_COMPUTE_SQL)
      .bind(1, 0, 'm1')
      .first<{ tipster_count: number; exact_count: number }>()

    sqlite.prepare(`UPDATE matches SET scored_at = ? WHERE id = 'm1'`).run(s2)
    const rowS2: RoundMatchRarityRow = {
      match_id: 'm1',
      home_score: 1,
      away_score: 0,
      scored_at: s2,
      tipster_count: 0,
      exact_count: 0,
      scored_at_snapshot: s1,
      status: 'computing',
    }
    const readyS2 = await ensureMatchScoreRarity(db, rowS2)
    expect(readyS2?.scored_at_snapshot).toBe(s2)

    const staleCommit = await db
      .prepare(MATCH_SCORE_RARITY_COMMIT_SQL)
      .bind(Number(computedS1?.tipster_count ?? 0), Number(computedS1?.exact_count ?? 0), 'm1', s1)
      .run()
    expect(staleCommit.meta.changes).toBe(0)

    expect(
      sqlite
        .prepare(`SELECT scored_at_snapshot, status FROM match_score_rarity WHERE match_id = 'm1'`)
        .get(),
    ).toEqual({ scored_at_snapshot: s2, status: 'ready' })
  })
})
