/// <reference types="node" />
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sync', () => ({ syncFixtures: vi.fn(async () => ({ matches: 0 })) }))
vi.mock('./scoring', () => ({ scoreUnprocessedMatches: vi.fn(async () => undefined) }))
vi.mock('./espnFallback', () => ({
  scoreWindowFromEspn: vi.fn(async () => new Map<string, number>()),
}))

import { pollActiveMatches } from './poller'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

// Runs the poller query against the real migrations to check which matches it picks.
function database() {
  const sqlite = new DatabaseSync(':memory:')
  const migrations = new URL('../../migrations/', import.meta.url)
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'))
  }
  const db = {
    prepare(sql: string) {
      let values: SQLInputValue[] = []
      const stmt = {
        bind(...args: SQLInputValue[]) {
          values = args
          return stmt
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...values), success: true }
        },
      }
      return stmt
    },
  } as unknown as D1Database
  return { sqlite, db }
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000).toISOString()

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.mocked(syncFixtures).mockClear()
  vi.mocked(scoreUnprocessedMatches).mockClear()
})

describe('pollActiveMatches rescue window', () => {
  it('rescues unfinished and unscored matches up to 24 h old, skipping postponed ones', async () => {
    const { sqlite, db } = database()
    handles.push(sqlite)
    sqlite.exec(`
      INSERT INTO competitions (id,name,slug,status,penalty_phases,external_id,season,provider)
        VALUES ('c1','League','league','ongoing','[]','BSA','2026','football-data');
      INSERT INTO teams (id,name,slug) VALUES ('home','Home','home'),('away','Away','away');
    `)
    const insert = sqlite.prepare(`INSERT INTO matches
      (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,
       postponed,home_score,away_score)
      VALUES (?, 'c1', ?, 'football-data', 'home', 'away', ?, ?, ?, ?, ?, ?)`)
    insert.run('late', '1', minutesAgo(10 * 60), 'scheduled', '10', 0, null, null)
    insert.run('unscored', '2', minutesAgo(20 * 60), 'finished', '11', 0, 2, 1)
    insert.run('postponed', '3', minutesAgo(8 * 60), 'scheduled', '12', 1, null, null)
    insert.run('active-postponed', '4', minutesAgo(150), 'scheduled', '13', 1, null, null)
    insert.run('too-old', '5', minutesAgo(30 * 60), 'scheduled', '14', 0, null, null)
    insert.run('scored', '6', minutesAgo(5 * 60), 'finished', '15', 0, 1, 0)
    sqlite.exec("UPDATE matches SET scored_at = '2026-01-01T00:00:00Z' WHERE id = 'scored'")

    await pollActiveMatches(db, 'key')

    const rounds = vi
      .mocked(syncFixtures)
      .mock.calls.map(([options]) => options.matchday)
      .sort()
    expect(rounds).toEqual([10, 11, 13])
    expect(scoreUnprocessedMatches).toHaveBeenCalledWith('c1', db)
  })
})
