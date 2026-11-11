import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { OPEN_PICKERS_SQL } from './openPickers'

// A aba Grupo roda esta consulta a cada abertura. Este teste falha se ela voltar a
// ler os palpites antigos do grupo ou passar a varrer alguma das tabelas.

function plan(sql: string): string[] {
  const { sqlite } = createSqliteD1()
  const binds = (sql.match(/\?/g) ?? []).length
  return sqlite
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...Array<string>(binds).fill('x'))
    .map((row) => String((row as { detail: string }).detail))
}

describe('plano da consulta de quem já palpitou', () => {
  it('lê o jogo pelo índice da competição e cada palpite pelo índice único', () => {
    expect(plan(OPEN_PICKERS_SQL)).toEqual([
      'SEARCH m USING INDEX idx_matches_comp_round_start (competition_id=?)',
      'SEARCH gm USING COVERING INDEX sqlite_autoindex_group_members_2 (group_id=?)',
      'CORRELATED SCALAR SUBQUERY 1',
      'SEARCH b USING COVERING INDEX sqlite_autoindex_group_bans_1 (group_id=? AND user_id=?)',
      'SEARCH pr USING COVERING INDEX sqlite_autoindex_predictions_2 (user_id=? AND group_id=? AND match_id=?)',
    ])
  })
})
