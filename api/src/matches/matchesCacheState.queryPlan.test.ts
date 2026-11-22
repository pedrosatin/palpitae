import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { COMPETITION_CACHE_STATE_SQL } from './router'

// GET /matches roda esta consulta em toda requisição, inclusive nas servidas pelo
// cache de borda. A versão fica na própria linha da competição.

function plan(sql: string): string[] {
  const { sqlite } = createSqliteD1()
  const binds = (sql.match(/\?/g) ?? []).length
  const result = sqlite
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...Array<string>(binds).fill('x'))
    .map((row) => String((row as { detail: string }).detail))
  sqlite.close()
  return result
}

describe('plano da consulta de versão do cache de /matches', () => {
  it('lê apenas a competição pela chave', () => {
    expect(plan(COMPETITION_CACHE_STATE_SQL)).toEqual([
      'SEARCH c USING INDEX sqlite_autoindex_competitions_1 (id=?)',
    ])
  })
})
