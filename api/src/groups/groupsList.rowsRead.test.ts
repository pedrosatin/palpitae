/// <reference types="node" />
/**
 * Mede `meta.rows_read` de `groupsListSql` no D1 local do workerd via Miniflare.
 * O shim `node:sqlite` (`createSqliteD1`) não expõe `rows_read`.
 */
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { groupsListBinds, groupsListSql } from './groupsList'

const ROUNDS = 38
const PER_ROUND = 10
const COMPETITIONS = ['comp-1', 'comp-2', 'comp-3', 'comp-4', 'comp-5', 'comp-6'] as const
const NOW = '2026-06-15T12:00:00Z'

let mf: Miniflare
let db: D1Database

function schemaStatements(): string[] {
  const { sqlite } = createSqliteD1()
  const rows = sqlite
    .prepare(
      `SELECT sql FROM sqlite_master
       WHERE sql IS NOT NULL AND type IN ('table', 'view', 'index')
         AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
       ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 ELSE 2 END, rowid`,
    )
    .all() as Array<{ sql: string }>
  sqlite.close()
  return rows.map((r) => r.sql)
}

async function seedGroups(userId: string, competitionIds: readonly string[], totalGroups: number) {
  await db
    .prepare(
      `INSERT INTO users (id, email, provider, provider_id, user_name)
       VALUES (?, ?, 'google', ?, ?)`,
    )
    .bind(userId, `${userId}@example.com`, `g-${userId}`, userId)
    .run()

  const groupValues: string[] = []
  const memberValues: string[] = []
  for (let i = 0; i < totalGroups; i++) {
    const compId = competitionIds[i % competitionIds.length]!
    const groupId = `${userId}-g-${i}`
    const inviteCode = `${userId.toUpperCase()}-${String(i).padStart(4, '0')}`
    groupValues.push(
      `('${groupId}', 'Grupo ${i}', '${compId}', '${userId}', '${inviteCode}', 3, 1, 0, 0, 'hidden')`,
    )
    memberValues.push(`('gm-${groupId}', '${groupId}', '${userId}', 'owner')`)
  }

  await db.batch([
    db.prepare(
      `INSERT INTO groups (
         id, name, competition_id, owner_user_id, invite_code,
         points_exact, points_winner, points_penalty, points_classified, predictions_visibility
       ) VALUES ${groupValues.join(', ')}`,
    ),
    db.prepare(
      `INSERT INTO group_members (id, group_id, user_id, role)
       VALUES ${memberValues.join(', ')}`,
    ),
  ])
}

async function measureRowsRead(userId: string): Promise<{ rows: number; rowsRead: number }> {
  const result = await db
    .prepare(groupsListSql(false))
    .bind(...groupsListBinds(NOW, userId))
    .all()
  return {
    rows: result.results.length,
    rowsRead: Number(result.meta.rows_read),
  }
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-08-01',
      d1Databases: { DB: 'groups-list-rows-read-db' },
    }),
  )
  db = (await mf.getD1Database('DB')) as unknown as D1Database

  for (const sql of schemaStatements()) {
    await db.prepare(sql).run()
  }

  await db.batch([
    db.prepare('DELETE FROM competitions'),
    ...COMPETITIONS.map((id, index) =>
      db
        .prepare(
          `INSERT INTO competitions (id, name, slug, season, status, type, penalty_phases, visibility)
           VALUES (?, ?, ?, '2027', 'ongoing', 'league', '[]', 'public')`,
        )
        .bind(id, `Liga ${index + 1}`, `liga-${index + 1}`),
    ),
    ...Array.from({ length: 20 }, (_, t) =>
      db
        .prepare('INSERT INTO teams (id, name, short_name, slug) VALUES (?, ?, ?, ?)')
        .bind(`t${t}`, `Time ${t}`, `T${t}`, `time-${t}`),
    ),
  ])

  const matchBatches: D1PreparedStatement[] = []
  for (const compId of COMPETITIONS) {
    const values: string[] = []
    for (let r = 1; r <= ROUNDS; r++) {
      for (let k = 0; k < PER_ROUND; k++) {
        const day = String(1 + ((r - 1) % 28)).padStart(2, '0')
        const month = String(1 + Math.floor((r - 1) / 28)).padStart(2, '0')
        const start = `2027-${month}-${day}T${String(10 + k).padStart(2, '0')}:00:00Z`
        values.push(
          `('${compId}-m-${r}-${k}', '${compId}', '${compId}-ext-${r}-${k}', 'football-data', 't${2 * k}', 't${2 * k + 1}', '${start}', 'scheduled', '${r}', NULL, 0)`,
        )
      }
    }
    matchBatches.push(
      db.prepare(
        `INSERT INTO matches (
           id, competition_id, external_id, provider,
           home_team_id, away_team_id, start_time, status, round, phase, postponed
         ) VALUES ${values.join(', ')}`,
      ),
    )
  }
  await db.batch(matchBatches)

  await seedGroups('u-10-3', COMPETITIONS.slice(0, 3), 10)
  await seedGroups('u-50-3', COMPETITIONS.slice(0, 3), 50)
  await seedGroups('u-50-1', COMPETITIONS.slice(0, 1), 50)
  await seedGroups('u-50-6', COMPETITIONS.slice(0, 6), 50)
}, 120_000)

afterAll(async () => {
  await mf?.dispose()
})

describe('custo de leitura de GET /groups no D1 (Miniflare)', () => {
  it('50 grupos distribuídos em 3 competições de 380 jogos leem menos de 3 mil linhas', async () => {
    const measured = await measureRowsRead('u-50-3')
    expect(measured.rows).toBe(50)
    expect(measured.rowsRead).toBeLessThan(3000)
  })

  it('linhas lidas crescem com o número de competições, não com o de grupos', async () => {
    const g10c3 = await measureRowsRead('u-10-3')
    const g50c3 = await measureRowsRead('u-50-3')
    const g50c1 = await measureRowsRead('u-50-1')
    const g50c6 = await measureRowsRead('u-50-6')

    expect(g10c3.rows).toBe(10)
    expect(g50c3.rows).toBe(50)
    expect(g50c1.rows).toBe(50)
    expect(g50c6.rows).toBe(50)

    const perAddedGroup = (g50c3.rowsRead - g10c3.rowsRead) / 40
    const perAddedCompetition = (g50c6.rowsRead - g50c1.rowsRead) / 5

    expect(perAddedGroup).toBeLessThan(30)
    expect(perAddedCompetition).toBeGreaterThan(300)
    expect(perAddedCompetition).toBeGreaterThan(perAddedGroup * 10)
  })
})
