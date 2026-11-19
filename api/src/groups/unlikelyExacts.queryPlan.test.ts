import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { UNLIKELY_EXACT_CANDIDATES_SQL } from './unlikelyExacts'

/**
 * A consulta de raridade roda em toda abertura do ranking com rodada de
 * referência. O plano precisa usar o índice por competição+rodada nos jogos e
 * o índice por match_id nos palpites, sem SCAN da tabela predictions inteira.
 */

type PlanRow = { id: number; parent: number; detail: string }

function planRows(sql: string): PlanRow[] {
  const { sqlite } = createSqliteD1()
  const binds = (sql.match(/\?/g) ?? []).length
  return sqlite
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...Array<string>(binds).fill('x')) as PlanRow[]
}

describe('plano de consulta do placar improvável', () => {
  it('usa índices de matches por competição e de predictions por match/grupo', () => {
    const steps = planRows(UNLIKELY_EXACT_CANDIDATES_SQL).map((row) => String(row.detail))

    // Com `scored_at IS NOT NULL`, o SQLite escolhe idx_matches_comp_scored;
    // o filtro de rodada entra como residual. Sem SCAN de tabela inteira.
    expect(
      steps.some(
        (s) =>
          s.includes('idx_matches_comp_scored') || s.includes('idx_matches_comp_round_start'),
      ),
    ).toBe(true)
    expect(steps.some((s) => s.includes('idx_predictions_match'))).toBe(true)
    expect(steps.some((s) => s.includes('idx_predictions_group'))).toBe(true)
    expect(steps.filter((s) => /^SCAN predictions\b/i.test(s))).toEqual([])
    expect(steps.filter((s) => /^SCAN matches\b/i.test(s))).toEqual([])
  })
})
