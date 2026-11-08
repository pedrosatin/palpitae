import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { pendingPredictionsSql } from '../groups/pendingPredictions'
import { SCHEDULED_MATCHES_SQL, USERS_NEEDING_REMINDER_SQL } from './roundReminder'

// Guarda contra a volta do custo jogos × jogos no D1 (migration 0034). As
// subqueries de "rodada atual" e "início da rodada" são correlacionadas a cada
// jogo; sem o índice (competition_id, round, start_time) cada avaliação varre a
// competição inteira. Com 4 mil jogos, isso levou o D1 a ~4 mi de linhas lidas
// por dia, perto do limite do plano gratuito.

function plan(sql: string, binds = 0): string[] {
  const { sqlite } = createSqliteD1()
  return sqlite
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...Array<string>(binds).fill('x'))
    .map((row) => String((row as { detail: string }).detail))
}

const BY_COMPETITION_AND_ROUND = /idx_matches_comp_round_start \(competition_id=\? AND round=\?\)/
const BY_COMPETITION_ONLY = /idx_matches_comp_round_start \(competition_id=\?\)/

describe('planos de consulta das subqueries por rodada', () => {
  it('pendências do GET /groups buscam os jogos da rodada pelo índice', () => {
    const steps = plan(`SELECT g.id, ${pendingPredictionsSql('g')} FROM groups g`, 5)
    // Uma busca do índice coberto por competição numera as rodadas candidatas.
    // Os jogos vêm de uma busca por competição e rodada. Com JOIN no lugar do
    // CROSS JOIN, o SQLite busca m só por competição e lê a competição inteira
    // de novo.
    expect(steps.filter((s) => BY_COMPETITION_ONLY.test(s))).toEqual([
      'SEARCH mr USING COVERING INDEX idx_matches_comp_round_start (competition_id=?)',
    ])
    expect(steps.filter((s) => s.startsWith('SEARCH m ') && BY_COMPETITION_AND_ROUND.test(s))).toHaveLength(1)
    expect(steps.filter((s) => /^SCAN (m|mr)\b/.test(s))).toEqual([])
  })

  it('lembrete: início da rodada vem do índice, não de varredura da competição', () => {
    for (const sql of [SCHEDULED_MATCHES_SQL, USERS_NEEDING_REMINDER_SQL]) {
      const steps = plan(sql)
      expect(steps.some((s) => s.startsWith('SEARCH m2 ') && BY_COMPETITION_AND_ROUND.test(s))).toBe(true)
      expect(steps.filter((s) => /^SCAN (m|m2|pm)\b/.test(s))).toEqual([])
    }
  })
})
