import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { UNSCORED_REPORT_SQL } from './poller'

// O poller roda esta consulta em todo tick, inclusive nos ociosos. Este teste
// falha se ela deixar o índice parcial dos jogos sem pontuação, quase sempre
// vazio, e voltar a varrer todos os jogos encerrados.

describe('plano da consulta de jogos encerrados sem pontuação', () => {
  it('lê só o índice parcial idx_matches_unscored', () => {
    const { sqlite } = createSqliteD1()
    const plan = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${UNSCORED_REPORT_SQL}`)
      .all('2026-11-08T15:05:00.000Z', 10)
      .map((row) => String((row as { detail: string }).detail))
    sqlite.close()

    expect(plan).toEqual([
      'SCAN matches USING INDEX idx_matches_unscored',
      'USE TEMP B-TREE FOR ORDER BY',
    ])
  })
})
