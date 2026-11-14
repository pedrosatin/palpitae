import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { deadlineMatchesSql, groupsListSql } from './groupsList'
import { LIVE_MATCHES_SQL } from './liveMatches'

// O GET /groups roda a cada abertura da home. A CTE `competition_info` separa
// as competições distintas do usuário e calcula status e rodadas abertas uma
// vez por competição, em vez de repetir a varredura de jogos por grupo. Cada
// grupo lê apenas os jogos das rodadas abertas já resolvidas, além do prazo, do
// próximo jogo e do fim da rodada no mesmo resumo. Este teste falha se a CTE
// deixar de ser materializada, se um campo novo trouxer outra varredura dos
// jogos ou se o agrupamento de rodadas voltar a criar B-tree temporária.

type PlanRow = { id: number; parent: number; detail: string }

function planRows(sql: string): PlanRow[] {
  const { sqlite } = createSqliteD1()
  const binds = (sql.match(/\?/g) ?? []).length
  return sqlite
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...Array<string>(binds).fill('x')) as PlanRow[]
}

function plan(sql: string): string[] {
  return planRows(sql).map((row) => String(row.detail))
}

function hasAncestor(rowsById: Map<number, PlanRow>, row: PlanRow, ancestorId: number): boolean {
  let current: PlanRow | undefined = row
  while (current && current.parent !== 0) {
    if (current.parent === ancestorId) return true
    current = rowsById.get(current.parent)
  }
  return false
}

const TABLE_SCAN = /^SCAN (m|mr|lm|p|matches|predictions|teams|ht|at)\b/

describe('planos de consulta do GET /groups', () => {
  it.each([false, true])(
    'calcula status e rodadas abertas uma vez por competição distinta, piloto=%s',
    (pilot) => {
      const rows = planRows(groupsListSql(pilot))
      const steps = rows.map((r) => String(r.detail))
      const rowsById = new Map(rows.map((r) => [r.id, r]))

      const userGroupsStep = rows.find((r) => r.detail === 'MATERIALIZE user_groups')
      const compInfoStep = rows.find((r) => r.detail === 'MATERIALIZE competition_info')
      expect(userGroupsStep).toBeDefined()
      expect(compInfoStep).toBeDefined()

      expect(steps).toContain(
        'SEARCH ci USING AUTOMATIC COVERING INDEX (competition_id=?) LEFT-JOIN',
      )

      // A varredura das rodadas abertas em `mr` e as checagens de status em `m`
      // precisam ficar dentro de `competition_info`, nunca repetidas por grupo.
      const mrRows = rows.filter(
        (r) => r.detail.startsWith('SEARCH mr ') && r.detail.includes('(competition_id=?)'),
      )
      expect(mrRows.map((r) => r.detail)).toEqual([
        'SEARCH mr USING COVERING INDEX idx_matches_comp_round_start (competition_id=?)',
      ])
      expect(mrRows.every((r) => hasAncestor(rowsById, r, compInfoStep!.id))).toBe(true)

      const statusMatchRows = rows.filter(
        (r) => r.detail.startsWith('SEARCH m ') && r.detail.includes('(competition_id=?)'),
      )
      expect(statusMatchRows.length).toBeGreaterThan(0)
      expect(statusMatchRows.every((r) => hasAncestor(rowsById, r, compInfoStep!.id))).toBe(true)

      expect(
        steps.filter((s) => s.includes('idx_matches_comp_round_start (competition_id=? AND round=?)')),
      ).toHaveLength(1)
      expect(steps).not.toContain('USE TEMP B-TREE FOR GROUP BY')
      expect(steps.filter((s) => TABLE_SCAN.test(s))).toEqual([])
    },
  )

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
