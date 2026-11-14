/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'

/** Tentativas HTTP que cada sync gasta do orçamento do tick. */
const sync = vi.hoisted(() => ({ attempts: 0 }))

vi.mock('./sync', () => ({
  syncFixtures: vi.fn(async (options: { onHttpAttempt?: (attempt: unknown) => void }) => {
    for (let i = 0; i < sync.attempts; i++) {
      options.onHttpAttempt?.({ provider: 'football-data', status: 200, durationMs: 1 })
    }
    return { matches: 0, discarded: 0 }
  }),
}))
vi.mock('./espnFallback', () => ({
  scoreWindowFromEspn: vi.fn(async () => new Map<string, number>()),
}))

import { POLLER_CALL_BUDGET, pollActiveMatches } from './poller'

/**
 * Divisão das chamadas da pontuação entre competições. Cada jogo com mais de 250
 * palpites vai numa gravação só dele, que custa 2 chamadas. Planejar custa 1 numa
 * liga, sem mata-mata, e a pontuação só começa com pelo menos 4 chamadas.
 */

const KICKOFF = Date.parse('2026-11-08T15:30:00Z')
/** Dentro da janela ativa do poller (115 a 200 min após o início). */
const NOW = KICKOFF + 120 * 60_000
const TICK_MS = 30 * 60_000
const COMPETITIONS = ['c1', 'c2', 'c3']
const MATCHES_PER_COMPETITION = 6
const PREDICTIONS_PER_MATCH = 251

const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.restoreAllMocks()
})

/**
 * Três competições com seis jogos encerrados e sem pontuação cada, um minuto
 * entre eles, todos na mesma rodada. Cada jogo tem 251 palpites.
 */
function seed() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO teams (id, name, slug) VALUES ('home', 'Home', 'home'), ('away', 'Away', 'away');
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${PREDICTIONS_PER_MATCH})
    INSERT INTO users (id, email, provider, provider_id)
      SELECT 'u' || i, 'u' || i || '@example.test', 'google', 'g' || i FROM n;
  `)
  for (const [c, comp] of COMPETITIONS.entries()) {
    sqlite.exec(`
      INSERT INTO competitions (id, name, slug, status, penalty_phases, external_id, season, provider)
        VALUES ('${comp}', '${comp}', '${comp}', 'ongoing', '[]', '${9000 + c}', '2026', 'football-data');
      INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code)
        VALUES ('g-${comp}', 'Bolão ${comp}', '${comp}', 'u1', 'INV-${comp}');
    `)
    for (let m = 0; m < MATCHES_PER_COMPETITION; m++) {
      const start = new Date(KICKOFF + m * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
      sqlite.exec(`
        INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id,
            start_time, status, round, home_score, away_score)
          VALUES ('${comp}-m${m}', '${comp}', '${comp}-${m}', 'football-data', 'home', 'away',
            '${start}', 'finished', '10', 1, 0);
        INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score)
          SELECT '${comp}-m${m}-' || id, id, 'g-${comp}', '${comp}-m${m}', 1, 0 FROM users;
      `)
    }
  }
  return { sqlite, db }
}

function scoredByCompetition(sqlite: DatabaseSync): Record<string, number> {
  const rows = sqlite
    .prepare(
      `SELECT competition_id, COUNT(scored_at) AS scored FROM matches
        GROUP BY competition_id ORDER BY competition_id`,
    )
    .all() as { competition_id: string; scored: number }[]
  return Object.fromEntries(rows.map((row) => [row.competition_id, row.scored]))
}

describe('pontuação de várias competições com poucas chamadas', () => {
  it('com chamadas para começar, nenhuma competição passa dois ticks sem pontuar', async () => {
    const { sqlite, db } = seed()
    // O planejamento lê 1 vez; os três syncs deixam 11 chamadas ou menos para a pontuação.
    sync.attempts = Math.floor((POLLER_CALL_BUDGET - 1 - 11) / COMPETITIONS.length)

    await pollActiveMatches(db, 'key', undefined, NOW)
    await pollActiveMatches(db, 'key', undefined, NOW + TICK_MS)

    const scored = scoredByCompetition(sqlite)
    for (const comp of COMPETITIONS) expect(scored[comp]).toBeGreaterThan(0)
  })
})
