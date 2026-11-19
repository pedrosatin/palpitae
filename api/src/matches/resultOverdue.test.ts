import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  countOverdueResults,
  DEFAULT_OVERDUE_RESULT_HOURS,
  isResultOverdue,
  overdueCutoffSqlBind,
  overdueResultHours,
} from './resultOverdue'

describe('overdueResultHours', () => {
  it('usa 3 h por padrão', () => {
    expect(DEFAULT_OVERDUE_RESULT_HOURS).toBe(3)
    expect(overdueResultHours(undefined)).toBe(3)
    expect(overdueResultHours('')).toBe(3)
    expect(overdueResultHours('  ')).toBe(3)
  })

  it('aceita inteiro positivo e rejeita o resto', () => {
    expect(overdueResultHours('6')).toBe(6)
    expect(overdueResultHours('0')).toBe(3)
    expect(overdueResultHours('-2')).toBe(3)
    expect(overdueResultHours('2.5')).toBe(3)
    expect(overdueResultHours('abc')).toBe(3)
  })

  it('monta o bind SQL do limiar', () => {
    expect(overdueCutoffSqlBind(3)).toBe('-3 hours')
    expect(overdueCutoffSqlBind(6)).toBe('-6 hours')
  })
})

describe('isResultOverdue', () => {
  const now = Date.parse('2026-11-19T18:00:00Z')
  const kickoff = '2026-11-19T14:00:00Z' // 4 h atrás

  it('marca scheduled/live sem placar depois do limiar', () => {
    expect(
      isResultOverdue({ start_time: kickoff, status: 'scheduled', postponed: 0 }, now, 3),
    ).toBe(true)
    expect(isResultOverdue({ start_time: kickoff, status: 'live', postponed: 0 }, now, 3)).toBe(
      true,
    )
  })

  it('exclui adiados, finished e placar completo', () => {
    expect(
      isResultOverdue({ start_time: kickoff, status: 'scheduled', postponed: 1 }, now, 3),
    ).toBe(false)
    expect(
      isResultOverdue({ start_time: kickoff, status: 'finished', postponed: 0 }, now, 3),
    ).toBe(false)
    expect(
      isResultOverdue(
        { start_time: kickoff, status: 'scheduled', postponed: 0, home_score: 1, away_score: 0 },
        now,
        3,
      ),
    ).toBe(false)
  })

  it('respeita o limiar: dentro da janela não conta', () => {
    expect(
      isResultOverdue({ start_time: '2026-11-19T15:30:00Z', status: 'scheduled' }, now, 3),
    ).toBe(false)
    expect(
      isResultOverdue({ start_time: '2026-11-19T15:30:00Z', status: 'scheduled' }, now, 2),
    ).toBe(true)
  })
})

describe('countOverdueResults', () => {
  it('conta no D1 e ignora adiados e jogos dentro da janela', async () => {
    const { db, sqlite } = createSqliteD1()
    sqlite.exec(`
      INSERT INTO competitions (id, name, slug, season, provider, external_id, visibility, status)
      VALUES ('c1', 'Liga', 'liga-2026', '2026', 'football-data', '1', 'public', 'ongoing');
      INSERT INTO teams (id, name, short_name, slug)
      VALUES ('t1', 'A', 'A', 'a'), ('t2', 'B', 'B', 'b');
      INSERT INTO matches (
        id, competition_id, external_id, provider, home_team_id, away_team_id,
        start_time, status, round, postponed, home_score, away_score, scored_at
      ) VALUES
        ('m-over', 'c1', '1', 'football-data', 't1', 't2',
          strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-4 hours'), 'scheduled', '1', 0, NULL, NULL, NULL),
        ('m-live', 'c1', '2', 'football-data', 't1', 't2',
          strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-5 hours'), 'live', '1', 0, NULL, NULL, NULL),
        ('m-window', 'c1', '3', 'football-data', 't1', 't2',
          strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 hours'), 'scheduled', '1', 0, NULL, NULL, NULL),
        ('m-post', 'c1', '4', 'football-data', 't1', 't2',
          strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-10 hours'), 'scheduled', '1', 1, NULL, NULL, NULL),
        ('m-score', 'c1', '5', 'football-data', 't1', 't2',
          strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-4 hours'), 'scheduled', '1', 0, 1, 0, NULL);
    `)

    const summary = await countOverdueResults(db, 3)
    expect(summary.matches).toBe(2)
    expect(summary.competitions).toBe(1)
    expect(summary.oldest_minutes).toBeGreaterThanOrEqual(5 * 60 - 1)
  })
})
