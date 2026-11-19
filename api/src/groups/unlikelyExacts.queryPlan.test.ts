import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  GROUP_EXACT_ON_ROUND_SQL,
  IN_GROUP_TIPSTERS_ON_MATCH_SQL,
  MATCH_SCORE_RARITY_COMPUTE_SQL,
  ROUND_MATCH_RARITY_SQL,
} from './unlikelyExacts'

/**
 * A raridade por jogo roda no máximo uma vez por `scored_at` (agregado em
 * `match_score_rarity`). As leituras seguintes do ranking usam o agregado da
 * rodada e os palpites do próprio grupo.
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
  it('cálculo por jogo usa índice de predictions por match_id', () => {
    const steps = planRows(MATCH_SCORE_RARITY_COMPUTE_SQL).map((row) => String(row.detail))
    expect(steps.some((s) => s.includes('idx_predictions_match'))).toBe(true)
    expect(steps.filter((s) => /^SCAN predictions\b/i.test(s))).toEqual([])
  })

  it('leitura da rodada usa matches por competição e o agregado por PK', () => {
    const steps = planRows(ROUND_MATCH_RARITY_SQL).map((row) => String(row.detail))
    expect(
      steps.some(
        (s) =>
          s.includes('idx_matches_comp_scored') || s.includes('idx_matches_comp_round_start'),
      ),
    ).toBe(true)
    expect(steps.filter((s) => /^SCAN matches\b/i.test(s))).toEqual([])
    expect(steps.filter((s) => /^SCAN predictions\b/i.test(s))).toEqual([])
  })

  it('exatos do grupo usam predictions por grupo e o agregado fresco', () => {
    const steps = planRows(GROUP_EXACT_ON_ROUND_SQL).map((row) => String(row.detail))
    expect(steps.some((s) => s.includes('idx_predictions_group'))).toBe(true)
    expect(steps.filter((s) => /^SCAN predictions\b/i.test(s))).toEqual([])
  })

  it('tipsters do grupo por jogo não fazem SCAN de predictions', () => {
    const steps = planRows(IN_GROUP_TIPSTERS_ON_MATCH_SQL).map((row) => String(row.detail))
    // Com json_each dos match_ids, o plano parte dos membros do grupo e busca
    // predictions pelo índice de user_id (covering), sem SCAN da tabela.
    expect(steps.some((s) => /SEARCH p USING .*INDEX/i.test(s))).toBe(true)
    expect(steps.filter((s) => /^SCAN predictions\b/i.test(s))).toEqual([])
    expect(steps.filter((s) => /^SCAN p\b/i.test(s))).toEqual([])
  })
})
