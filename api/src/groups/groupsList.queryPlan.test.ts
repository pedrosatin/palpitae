import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { deadlineMatchesSql, groupsListSql } from './groupsList'
import { LIVE_MATCHES_SQL } from './liveMatches'

// O GET /groups roda a cada abertura da home. Quem tem 6 grupos já lê ~2,7 mil
// linhas, e a contagem de pendentes lê o índice da competição uma vez por grupo.
// O próximo prazo, o próximo jogo e o fim da rodada saem dessa mesma leitura.
// Este teste falha se um campo novo trouxer outra varredura dos jogos.

function plan(sql: string): string[] {
  const { sqlite } = createSqliteD1()
  const binds = (sql.match(/\?/g) ?? []).length
  return sqlite
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...Array<string>(binds).fill('x'))
    .map((row) => String((row as { detail: string }).detail))
}

const TABLE_SCAN = /^SCAN (m|mr|lm|p|matches|predictions|teams|ht|at)\b/

describe('planos de consulta do GET /groups', () => {
  it.each([false, true])('lista lê o índice da competição uma vez por grupo, piloto=%s', (pilot) => {
    const steps = plan(groupsListSql(pilot))

    // Uma leitura do índice coberto por competição numera as rodadas abertas.
    // As buscas com alias `m` são do status da competição, em
    // `competitionStatusSql`.
    expect(
      steps.filter((s) => s.startsWith('SEARCH mr ') && s.includes('(competition_id=?)')),
    ).toEqual(['SEARCH mr USING COVERING INDEX idx_matches_comp_round_start (competition_id=?)'])
    expect(
      steps.filter((s) => s.includes('idx_matches_comp_round_start (competition_id=? AND round=?)')),
    ).toHaveLength(1)
    expect(steps.filter((s) => TABLE_SCAN.test(s))).toEqual([])
  })

  it.each([false, true])('membros do usuário vêm do índice por user_id, piloto=%s', (pilot) => {
    const steps = plan(groupsListSql(pilot))
    expect(steps.filter((s) => s.startsWith('SEARCH gm '))).toEqual([
      'SEARCH gm USING COVERING INDEX idx_group_members_user (user_id=?)',
    ])
    expect(steps.some((s) => s.startsWith('SCAN gm'))).toBe(false)
  })

  it('jogos ao vivo vêm só da janela de horário', () => {
    const steps = plan(LIVE_MATCHES_SQL)
    expect(steps).toContain(
      'SEARCH matches USING INDEX idx_matches_start_time (start_time>? AND start_time<?)',
    )
    expect(steps.some((s) => s.includes('idx_matches_comp_round_start'))).toBe(false)
    expect(steps.filter((s) => TABLE_SCAN.test(s))).toEqual([])
  })

  it('jogo de prazo e times vêm pela chave primária', () => {
    const steps = plan(deadlineMatchesSql(3))
    expect(steps).toEqual([
      'SEARCH m USING INDEX sqlite_autoindex_matches_1 (id=?)',
      'SEARCH ht USING INDEX sqlite_autoindex_teams_1 (id=?)',
      'SEARCH at USING INDEX sqlite_autoindex_teams_1 (id=?)',
    ])
  })
})
