import type { D1Database } from '@cloudflare/workers-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the two collaborators — pollActiveMatches only orchestrates them.
vi.mock('./sync', () => ({ syncFixtures: vi.fn(async () => undefined) }))
vi.mock('./scoring', () => ({ scoreUnprocessedMatches: vi.fn(async () => undefined) }))

import { pollActiveMatches } from './poller'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

const syncFixturesMock = vi.mocked(syncFixtures)
const scoreMock = vi.mocked(scoreUnprocessedMatches)

type ActiveRow = {
  comp_id: string
  external_id: string
  season: string
  round: string
}

/**
 * Minimal fake D1 — pollActiveMatches issues exactly one query and reads it
 * via .all(). The query is captured so we can assert the active-window bounds.
 */
function buildFakeDb(rows: ActiveRow[]) {
  const captured: { sql: string; params: unknown[] } = { sql: '', params: [] }
  const db = {
    prepare(sql: string) {
      captured.sql = sql
      const stmt = {
        bind(...args: unknown[]) {
          captured.params = args
          return stmt
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: rows as unknown as T[] }
        },
      }
      return stmt
    },
    _captured: captured,
  }
  return db
}

describe('pollActiveMatches', () => {
  beforeEach(() => {
    syncFixturesMock.mockClear()
    scoreMock.mockClear()
  })

  it('does nothing when no matches are in the active window', async () => {
    const db = buildFakeDb([])

    await pollActiveMatches(db as unknown as D1Database, 'key')

    expect(syncFixturesMock).not.toHaveBeenCalled()
    expect(scoreMock).not.toHaveBeenCalled()
  })

  it('filters by status and provider in SQL', async () => {
    const db = buildFakeDb([])

    await pollActiveMatches(db as unknown as D1Database, 'key')

    expect(db._captured.sql).toContain("status != 'finished'")
    expect(db._captured.sql).toContain("provider = 'football-data'")
  })

  it('binds the active-window bounds as ISO 8601 strings (T/Z) matching stored start_time', async () => {
    const db = buildFakeDb([])

    await pollActiveMatches(db as unknown as D1Database, 'key')

    const [earliestOver, stillRelevant] = db._captured.params as [string, string]
    // Must be ISO with T and Z — a space-separated SQLite datetime() string would
    // string-compare wrong against stored "2026-06-16T22:00:00Z" values.
    const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    expect(earliestOver).toMatch(isoRe)
    expect(stillRelevant).toMatch(isoRe)
    // earliestOver (now-115min) is chronologically AFTER stillRelevant (now-200min).
    expect(earliestOver > stillRelevant).toBe(true)
    // The gap between the bounds is exactly 85 minutes.
    const gapMs = Date.parse(earliestOver) - Date.parse(stillRelevant)
    expect(gapMs).toBe(85 * 60 * 1000)
  })

  it('passes matchday for numeric rounds (group stage)', async () => {
    const db = buildFakeDb([
      { comp_id: 'c1', external_id: 'WC', season: '2026', round: '3' },
    ])

    await pollActiveMatches(db as unknown as D1Database, 'key')

    expect(syncFixturesMock).toHaveBeenCalledTimes(1)
    expect(syncFixturesMock).toHaveBeenCalledWith(
      expect.objectContaining({ competitionCode: 'WC', season: 2026, matchday: 3, apiKey: 'key' }),
    )
    expect(scoreMock).toHaveBeenCalledWith('c1', expect.anything())
  })

  it('omits matchday for non-numeric rounds (knockout phase)', async () => {
    const db = buildFakeDb([
      { comp_id: 'c1', external_id: 'WC', season: '2026', round: 'FINAL' },
    ])

    await pollActiveMatches(db as unknown as D1Database, 'key')

    expect(syncFixturesMock).toHaveBeenCalledWith(
      expect.objectContaining({ matchday: undefined }),
    )
  })

  it('syncs each distinct round once but scores the competition once', async () => {
    // A late matchday-1 game overlapping early matchday-2 games.
    const db = buildFakeDb([
      { comp_id: 'c1', external_id: 'WC', season: '2026', round: '1' },
      { comp_id: 'c1', external_id: 'WC', season: '2026', round: '2' },
    ])

    await pollActiveMatches(db as unknown as D1Database, 'key')

    expect(syncFixturesMock).toHaveBeenCalledTimes(2)
    const matchdays = syncFixturesMock.mock.calls.map((c) => c[0].matchday).sort()
    expect(matchdays).toEqual([1, 2])
    expect(scoreMock).toHaveBeenCalledTimes(1)
    expect(scoreMock).toHaveBeenCalledWith('c1', expect.anything())
  })

  it('groups by competition — one score call per competition', async () => {
    const db = buildFakeDb([
      { comp_id: 'c1', external_id: 'WC', season: '2026', round: '1' },
      { comp_id: 'c2', external_id: 'CL', season: '2026', round: '5' },
    ])

    await pollActiveMatches(db as unknown as D1Database, 'key')

    expect(syncFixturesMock).toHaveBeenCalledTimes(2)
    expect(scoreMock).toHaveBeenCalledTimes(2)
    expect(scoreMock).toHaveBeenCalledWith('c1', expect.anything())
    expect(scoreMock).toHaveBeenCalledWith('c2', expect.anything())
  })

  it('isolates a sync failure and still scores the competition for synced rounds', async () => {
    syncFixturesMock.mockRejectedValueOnce(new Error('API down'))
    const db = buildFakeDb([
      { comp_id: 'c1', external_id: 'WC', season: '2026', round: '1' },
      { comp_id: 'c1', external_id: 'WC', season: '2026', round: '2' },
    ])

    await pollActiveMatches(db as unknown as D1Database, 'key')

    // One round failed, the other succeeded → scoring still runs once.
    expect(scoreMock).toHaveBeenCalledTimes(1)
    expect(scoreMock).toHaveBeenCalledWith('c1', expect.anything())
  })

  it('does not score a competition when all its rounds fail to sync', async () => {
    syncFixturesMock.mockRejectedValue(new Error('API down'))
    const db = buildFakeDb([
      { comp_id: 'c1', external_id: 'WC', season: '2026', round: '1' },
    ])

    await pollActiveMatches(db as unknown as D1Database, 'key')

    expect(scoreMock).not.toHaveBeenCalled()
  })
})
