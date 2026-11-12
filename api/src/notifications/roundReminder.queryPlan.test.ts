import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { pendingSummarySql } from '../groups/pendingPredictions'
import { PENDING_MATCHES_SQL } from './roundReminder'

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
    const steps = plan(
      `SELECT g.id, ${pendingSummarySql('g', 'c')}
       FROM groups g LEFT JOIN competitions c ON c.id = g.competition_id`,
      8,
    )
    // Uma busca do índice coberto por competição numera as rodadas candidatas.
    // Os jogos vêm de uma busca por competição e rodada. Com JOIN no lugar do
    // CROSS JOIN, o SQLite busca m só por competição e lê a competição inteira
    // de novo.
    expect(steps.filter((s) => BY_COMPETITION_ONLY.test(s))).toEqual([
      'SEARCH mr USING COVERING INDEX idx_matches_comp_round_start (competition_id=?)',
    ])
    expect(steps.filter((s) => s.startsWith('SEARCH m ') && BY_COMPETITION_AND_ROUND.test(s))).toHaveLength(1)
    // O palpite de cada jogo vem do índice único, sem ler a linha.
    expect(steps.filter((s) => s.startsWith('SEARCH p '))).toEqual([
      'SEARCH p USING COVERING INDEX sqlite_autoindex_predictions_2 (user_id=? AND group_id=? AND match_id=?) LEFT-JOIN',
    ])
    expect(steps.filter((s) => /^SCAN (m|mr|p)\b/.test(s))).toEqual([])
    // As fases de pênalti vêm da competição já lida pelo JOIN de fora, sem nova
    // leitura de `competitions` a cada jogo.
    expect(steps.filter((s) => s.includes('competitions'))).toEqual([
      'SEARCH c USING INDEX sqlite_autoindex_competitions_1 (id=?) LEFT-JOIN',
    ])
  })

  it('lembrete parte dos jogos do dia pelo índice de horário, sem varrer tabela', () => {
    const steps = plan(PENDING_MATCHES_SQL, 4)
    expect(steps[0]).toBe(
      'SEARCH m USING INDEX idx_matches_start_time (start_time>? AND start_time<?)',
    )
    expect(steps.filter((s) => s.startsWith('SCAN'))).toEqual([])
    // A ordem por horário vem do próprio índice, sem ordenar em memória.
    expect(steps.filter((s) => s.includes('TEMP B-TREE'))).toEqual([])
    // O último envio de cada usuário, que ordena a fila, vem da chave primária.
    expect(steps).toContain(
      'SEARCH ls USING COVERING INDEX sqlite_autoindex_email_reminder_sends_1 (user_id=?)',
    )
  })
})
