import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { PENDING_SCORING_SQL, UNSCORED_REPORT_SQL } from './poller'

// O poller roda estas consultas em todo tick, inclusive nos ociosos. Este teste
// falha se uma delas deixar o índice parcial dos jogos sem pontuação, quase
// sempre vazio, e voltar a varrer todos os jogos encerrados.

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

  it('a leitura das competições a pontuar também lê só o índice parcial', () => {
    const { sqlite } = createSqliteD1()
    const plan = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${PENDING_SCORING_SQL}`)
      .all()
      .map((row) => String((row as { detail: string }).detail))
    sqlite.close()

    expect(plan).toEqual([
      'SCAN matches USING INDEX idx_matches_unscored',
      'USE TEMP B-TREE FOR ORDER BY',
    ])
  })
})
