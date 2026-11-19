/// <reference types="node" />
/**
 * Mede `meta.rows_read` do placar improvável no D1 local (Miniflare).
 *
 * Cenário: 50 grupos × 20 palpiteiros × 10 jogos = 10_000 palpites numa
 * competição. Compara a consulta antiga (varredura da competição a cada
 * leitura de round-standings) com o agregado `match_score_rarity` (cálculo
 * preguiçoso na 1ª leitura e reuso nas seguintes).
 */
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  GROUP_EXACT_ON_ROUND_SQL,
  IN_GROUP_TIPSTERS_ON_MATCH_SQL,
  MATCH_SCORE_RARITY_COMMIT_SQL,
  MATCH_SCORE_RARITY_COMPUTE_SQL,
  MATCH_SCORE_RARITY_RESERVE_SQL,
  ROUND_MATCH_RARITY_SQL,
  UNLIKELY_EXACTS_FOR_ROUND_SQL,
} from './unlikelyExacts'

const GROUPS = 50
const TIPSTERS_PER_GROUP = 20
const MATCHES = 10
const ROUND = '1'
const GROUP_ID = 'g-0'
const SCORED_AT = '2026-06-02T00:00:00Z'

/** Consulta antiga: agrega todos os palpites dos jogos da rodada a cada leitura. */
const LEGACY_CANDIDATES_SQL = `WITH round_matches AS (
  SELECT m.id AS match_id, m.home_score AS home_score, m.away_score AS away_score
  FROM matches m
  WHERE m.competition_id = (SELECT competition_id FROM groups WHERE id = ?)
    AND m.round = ?
    AND m.status = 'finished'
    AND m.scored_at IS NOT NULL
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL
),
match_pool AS (
  SELECT
    rm.match_id AS match_id,
    rm.home_score AS home_score,
    rm.away_score AS away_score,
    COUNT(DISTINCT p.user_id) AS tipster_count,
    COUNT(DISTINCT CASE
      WHEN p.predicted_home_score = rm.home_score
       AND p.predicted_away_score = rm.away_score
      THEN p.user_id
    END) AS exact_tipster_count
  FROM round_matches rm
  JOIN predictions p ON p.match_id = rm.match_id
  JOIN groups pg ON pg.id = p.group_id AND pg.deleted_at IS NULL
  GROUP BY rm.match_id
)
SELECT
  p.user_id AS user_id,
  mp.match_id AS match_id,
  mp.tipster_count AS tipster_count,
  mp.exact_tipster_count AS exact_tipster_count
FROM match_pool mp
JOIN predictions p ON p.match_id = mp.match_id AND p.group_id = ?
JOIN groups g ON g.id = p.group_id
WHERE g.points_exact > g.points_winner
  AND p.predicted_home_score = mp.home_score
  AND p.predicted_away_score = mp.away_score
  AND p.points_awarded = g.points_exact`

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

async function rowsRead(sql: string, binds: unknown[]): Promise<number> {
  const result = await db.prepare(sql).bind(...binds).all()
  return Number(result.meta.rows_read)
}

async function seedScenario() {
  await db.batch([
    db.prepare('DELETE FROM competitions'),
    db
      .prepare(
        `INSERT INTO competitions (id, name, slug, season, status, type, penalty_phases, visibility)
         VALUES ('comp-a', 'Liga', 'liga-2026', '2026', 'ongoing', 'league', '[]', 'public')`,
      ),
    db.prepare(`INSERT INTO teams (id, name, short_name, slug) VALUES ('t0', 'A', 'A', 'a')`),
    db.prepare(`INSERT INTO teams (id, name, short_name, slug) VALUES ('t1', 'B', 'B', 'b')`),
  ])

  const userValues: string[] = []
  const groupValues: string[] = []
  const memberValues: string[] = []
  const predictionValues: string[] = []
  const matchValues: string[] = []

  for (let m = 0; m < MATCHES; m++) {
    matchValues.push(
      `('m-${m}', 'comp-a', 'ext-${m}', 'football-data', 't0', 't1', '2026-06-01T19:00:00Z', 'finished', '${ROUND}', 'REGULAR_SEASON', 0, '${SCORED_AT}', 1, 0)`,
    )
  }

  for (let g = 0; g < GROUPS; g++) {
    const groupId = `g-${g}`
    const owner = `u-${g}-0`
    groupValues.push(
      `('${groupId}', 'Grupo ${g}', 'comp-a', '${owner}', 'CODE${String(g).padStart(4, '0')}', 3, 1)`,
    )
    for (let t = 0; t < TIPSTERS_PER_GROUP; t++) {
      const userId = `u-${g}-${t}`
      userValues.push(
        `('${userId}', '${userId}@example.com', 'google', 'gp-${userId}', '${userId}')`,
      )
      memberValues.push(
        `('gm-${userId}', '${groupId}', '${userId}', '2026-01-01T00:00:00Z')`,
      )
      for (let m = 0; m < MATCHES; m++) {
        // Só o dono do grupo 0 crava 1x0 no jogo 0; o resto erra.
        const home = g === 0 && t === 0 && m === 0 ? 1 : 0
        const away = 0
        const awarded = home === 1 ? 3 : 0
        predictionValues.push(
          `('p-${userId}-m-${m}', '${userId}', '${groupId}', 'm-${m}', ${home}, ${away}, ${awarded})`,
        )
      }
    }
  }

  await db.batch([
    db.prepare(
      `INSERT INTO users (id, email, provider, provider_id, user_name) VALUES ${userValues.join(', ')}`,
    ),
    db.prepare(
      `INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code, points_exact, points_winner)
       VALUES ${groupValues.join(', ')}`,
    ),
    db.prepare(
      `INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES ${memberValues.join(', ')}`,
    ),
    db.prepare(
      `INSERT INTO matches (
         id, competition_id, external_id, provider, home_team_id, away_team_id,
         start_time, status, round, phase, postponed, scored_at, home_score, away_score
       ) VALUES ${matchValues.join(', ')}`,
    ),
  ])

  // D1 tem limite de binds/tamanho; palpites em fatias.
  const CHUNK = 400
  for (let i = 0; i < predictionValues.length; i += CHUNK) {
    const slice = predictionValues.slice(i, i + CHUNK)
    await db
      .prepare(
        `INSERT INTO predictions (
           id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded
         ) VALUES ${slice.join(', ')}`,
      )
      .run()
  }
}

/**
 * Simula a 1ª leitura: reserva + cálculo + commit por jogo (com releitura da
 * lista a cada jogo) e lê candidatos do grupo.
 */
async function measureFirstRead(): Promise<number> {
  let total = 0
  total += await rowsRead(ROUND_MATCH_RARITY_SQL, [GROUP_ID, ROUND])

  for (let m = 0; m < MATCHES; m++) {
    total += await rowsRead(ROUND_MATCH_RARITY_SQL, [GROUP_ID, ROUND])
    const matchId = `m-${m}`
    const reserve = await db
      .prepare(MATCH_SCORE_RARITY_RESERVE_SQL)
      .bind(matchId, SCORED_AT)
      .run()
    total += Number(reserve.meta.rows_read)
    const compute = await db
      .prepare(MATCH_SCORE_RARITY_COMPUTE_SQL)
      .bind(1, 0, matchId)
      .all<{ tipster_count: number; exact_count: number }>()
    total += Number(compute.meta.rows_read)
    const tipsterCount = Number(compute.results[0]?.tipster_count ?? 0)
    const exactCount = Number(compute.results[0]?.exact_count ?? 0)
    const commit = await db
      .prepare(MATCH_SCORE_RARITY_COMMIT_SQL)
      .bind(tipsterCount, exactCount, matchId, SCORED_AT)
      .run()
    total += Number(commit.meta.rows_read)
  }

  total += await rowsRead(ROUND_MATCH_RARITY_SQL, [GROUP_ID, ROUND])
  total += await rowsRead(GROUP_EXACT_ON_ROUND_SQL, [GROUP_ID, GROUP_ID, ROUND])
  const matchIds = JSON.stringify(Array.from({ length: MATCHES }, (_, i) => `m-${i}`))
  total += await rowsRead(IN_GROUP_TIPSTERS_ON_MATCH_SQL, [GROUP_ID, matchIds])
  total += await rowsRead(UNLIKELY_EXACTS_FOR_ROUND_SQL, [GROUP_ID, ROUND])
  return total
}

/** Leituras seguintes: agregado fresco, sem recalcular por jogo. */
async function measureReuseRead(): Promise<number> {
  let total = 0
  total += await rowsRead(ROUND_MATCH_RARITY_SQL, [GROUP_ID, ROUND])
  total += await rowsRead(GROUP_EXACT_ON_ROUND_SQL, [GROUP_ID, GROUP_ID, ROUND])
  const matchIds = JSON.stringify(Array.from({ length: MATCHES }, (_, i) => `m-${i}`))
  total += await rowsRead(IN_GROUP_TIPSTERS_ON_MATCH_SQL, [GROUP_ID, matchIds])
  total += await rowsRead(UNLIKELY_EXACTS_FOR_ROUND_SQL, [GROUP_ID, ROUND])
  return total
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-08-01',
      d1Databases: { DB: 'unlikely-exacts-rows-read-db' },
    }),
  )
  db = (await mf.getD1Database('DB')) as unknown as D1Database
  for (const sql of schemaStatements()) {
    await db.prepare(sql).run()
  }
  await seedScenario()
}, 180_000)

afterAll(async () => {
  await mf?.dispose()
})

describe('custo de leitura do placar improvável no D1 (Miniflare)', () => {
  it('cenário 50×20×10: legado varre ~10k linhas por leitura; agregado reusa bem menos', async () => {
    const legacy = await rowsRead(LEGACY_CANDIDATES_SQL, [GROUP_ID, ROUND, GROUP_ID])
    const first = await measureFirstRead()
    const reuse = await measureReuseRead()

    // Documenta os números medidos para a descrição da PR / ADR.
    console.info(
      JSON.stringify({
        scenario: '50 groups × 20 tipsters × 10 matches',
        legacy_rows_read: legacy,
        first_read_rows_read: first,
        reuse_read_rows_read: reuse,
      }),
    )

    expect(legacy).toBeGreaterThanOrEqual(10_000)
    // A 1ª leitura ainda calcula os 10 jogos (custo parecido ao legado uma vez).
    expect(first).toBeGreaterThan(5_000)
    // Reuso: só agregados da rodada + palpites/linhas do grupo.
    expect(reuse).toBeLessThan(1_000)
    expect(reuse).toBeLessThan(legacy / 10)
  })
})
