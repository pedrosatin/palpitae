import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { COMPETITION_CACHE_STATE_SQL } from './router'

// GET /matches roda esta consulta em toda requisição, inclusive nas servidas pelo
// cache de borda. Este teste falha se o MAX(scored_at) voltar a varrer os jogos
// da competição em vez de ler uma entrada do índice parcial.

function plan(sql: string): string[] {
  const { sqlite } = createSqliteD1()
  const binds = (sql.match(/\?/g) ?? []).length
  return sqlite
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...Array<string>(binds).fill('x'))
    .map((row) => String((row as { detail: string }).detail))
}

describe('plano da consulta de versão do cache de /matches', () => {
  it('lê a competição pela chave e o último scored_at pelo índice parcial', () => {
    expect(plan(COMPETITION_CACHE_STATE_SQL)).toEqual([
      'SEARCH c USING INDEX sqlite_autoindex_competitions_1 (id=?)',
      'CORRELATED SCALAR SUBQUERY 1',
      'SEARCH matches USING COVERING INDEX idx_matches_comp_scored (competition_id=? AND scored_at>?)',
    ])
  })
})
