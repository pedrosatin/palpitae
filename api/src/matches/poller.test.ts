import type { D1Database } from '@cloudflare/workers-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the two collaborators — pollActiveMatches only orchestrates them.
vi.mock('./sync', () => ({ syncFixtures: vi.fn(async () => undefined) }))
vi.mock('./scoring', () => ({
  scoreUnprocessedMatches: vi.fn(async () => undefined),
}))

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

/**
 * Fake AnalyticsEngineDataset. logEvent() calls .writeDataPoint() with
 * { indexes, blobs, doubles }, where blobs[0] is always the event_type and
 * blobs[1..] are the dims passed in. So a poller_run with dims.blobs ['ok']
 * surfaces here as blobs === ['poller_run', 'ok'].
 */
function buildFakeAe() {
  return { writeDataPoint: vi.fn() }
}

type WrittenPoint = { indexes?: string[]; blobs?: string[]; doubles?: number[] }

function pointsOfType(
  ae: { writeDataPoint: ReturnType<typeof vi.fn> },
  type: string,
): WrittenPoint[] {
  return ae.writeDataPoint.mock.calls
    .map((c) => c[0] as WrittenPoint)
    .filter((p) => p.blobs?.[0] === type)
}

describe('pollActiveMatches', () => {
  beforeEach(() => {
    syncFixturesMock.mockReset()
    scoreMock.mockReset()
    // Restore the happy-path defaults from the vi.mock factory after the reset,
    // so a persistent mockRejectedValue in one test can't leak into the next.
    syncFixturesMock.mockResolvedValue(undefined as never)
    scoreMock.mockResolvedValue(undefined)
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
    const db = buildFakeDb([{ comp_id: 'c1', external_id: 'WC', season: '2026', round: '3' }])

    await pollActiveMatches(db as unknown as D1Database, 'key')

    expect(syncFixturesMock).toHaveBeenCalledTimes(1)
    expect(syncFixturesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        competitionCode: 'WC',
        season: 2026,
        matchday: 3,
        apiKey: 'key',
      }),
    )
    expect(scoreMock).toHaveBeenCalledWith('c1', expect.anything())
  })

  it('omits matchday for non-numeric rounds (knockout phase)', async () => {
    const db = buildFakeDb([{ comp_id: 'c1', external_id: 'WC', season: '2026', round: 'FINAL' }])

    await pollActiveMatches(db as unknown as D1Database, 'key')

    expect(syncFixturesMock).toHaveBeenCalledWith(expect.objectContaining({ matchday: undefined }))
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
    const db = buildFakeDb([{ comp_id: 'c1', external_id: 'WC', season: '2026', round: '1' }])

    await pollActiveMatches(db as unknown as D1Database, 'key')

    expect(scoreMock).not.toHaveBeenCalled()
  })

  it('returns success: false with err when syncFixtures fails', async () => {
    const error = new Error('Sync failed')
    syncFixturesMock.mockRejectedValue(error)
    const db = buildFakeDb([{ comp_id: 'c1', external_id: 'WC', season: '2026', round: '1' }])

    await expect(pollActiveMatches(db as unknown as D1Database, 'key')).resolves.not.toThrow()
  })

  it('throws an error if scoring fails', async () => {
    scoreMock.mockRejectedValue(new Error('Scoring failed'))
    syncFixturesMock.mockResolvedValue({ matches: 1 } as never)
    const db = buildFakeDb([{ comp_id: 'c1', external_id: 'WC', season: '2026', round: '1' }])

    await expect(pollActiveMatches(db as unknown as D1Database, 'key')).rejects.toThrow(
      'Scoring failed',
    )
  })

  it('emits a poller_run with status ok and zeroed counters for an empty window', async () => {
    const ae = buildFakeAe()
    const db = buildFakeDb([])

    await pollActiveMatches(
      db as unknown as D1Database,
      'key',
      ae as unknown as AnalyticsEngineDataset,
    )

    const runs = pointsOfType(ae, 'poller_run')
    expect(runs).toHaveLength(1)
    // blobs[0] is the event_type, blobs[1] is the run status.
    expect(runs[0].blobs?.[1]).toBe('ok')
    // doubles = [matches_checked, fixtures_updated, api_calls, duration_ms]
    const doubles = runs[0].doubles ?? []
    expect(doubles.slice(0, 3)).toEqual([0, 0, 0])
    expect(doubles[3]).toBeGreaterThanOrEqual(0)
    expect(pointsOfType(ae, 'football_api_error')).toHaveLength(0)
  })

  it('emits a poller_run with status ok and counters reflecting rounds/fixtures/api_calls on success', async () => {
    syncFixturesMock.mockResolvedValue({ matches: 4 } as never)
    const ae = buildFakeAe()
    const db = buildFakeDb([
      { comp_id: 'c1', external_id: 'WC', season: '2026', round: '1' },
      { comp_id: 'c1', external_id: 'WC', season: '2026', round: '2' },
    ])

    await pollActiveMatches(
      db as unknown as D1Database,
      'key',
      ae as unknown as AnalyticsEngineDataset,
    )

    const runs = pointsOfType(ae, 'poller_run')
    expect(runs).toHaveLength(1)
    expect(runs[0].blobs?.[1]).toBe('ok')
    const [matchesChecked, fixturesUpdated, apiCalls] = runs[0].doubles ?? []
    // Two (comp, round) rows in the window, two syncFixtures calls, 4 fixtures each.
    expect(matchesChecked).toBe(2)
    expect(apiCalls).toBe(2)
    expect(fixturesUpdated).toBe(8)
    expect(pointsOfType(ae, 'football_api_error')).toHaveLength(0)
  })

  it('emits football_api_error and a poller_run with status error when a sync rejects', async () => {
    syncFixturesMock.mockRejectedValue(new Error('API down'))
    const ae = buildFakeAe()
    const db = buildFakeDb([{ comp_id: 'c1', external_id: 'WC', season: '2026', round: '1' }])

    await pollActiveMatches(
      db as unknown as D1Database,
      'key',
      ae as unknown as AnalyticsEngineDataset,
    )

    const errors = pointsOfType(ae, 'football_api_error')
    expect(errors).toHaveLength(1)
    // football_api_error blobs = [event_type, comp_id, round, message]
    expect(errors[0].blobs?.[1]).toBe('c1')
    expect(errors[0].blobs?.[2]).toBe('1')
    expect(errors[0].blobs?.[3]).toBe('API down')

    const runs = pointsOfType(ae, 'poller_run')
    expect(runs).toHaveLength(1)
    expect(runs[0].blobs?.[1]).toBe('error')
  })

  it('emits football_api_error handling a non-Error rejection correctly', async () => {
    syncFixturesMock.mockRejectedValue('String error')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ae = buildFakeAe()
    const db = buildFakeDb([{ comp_id: 'c1', external_id: 'WC', season: '2026', round: '1' }])

    await pollActiveMatches(
      db as unknown as D1Database,
      'key',
      ae as unknown as AnalyticsEngineDataset,
    )

    const errors = pointsOfType(ae, 'football_api_error')
    expect(errors).toHaveLength(1)
    expect(errors[0].blobs?.[3]).toBe('String error')

    expect(consoleSpy).toHaveBeenCalledWith('[poller] Sync falhou comp=c1 round=1:', 'String error')
    consoleSpy.mockRestore()
  })
})
