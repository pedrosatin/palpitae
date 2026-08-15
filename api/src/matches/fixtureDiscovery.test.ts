import type { D1Database } from '@cloudflare/workers-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sync', () => ({ syncFixtures: vi.fn(async () => undefined) }))
vi.mock('./scoring', () => ({
  scoreUnprocessedMatches: vi.fn(async () => undefined),
}))

import { discoverFixtures } from './fixtureDiscovery'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

const syncFixturesMock = vi.mocked(syncFixtures)
const scoreMock = vi.mocked(scoreUnprocessedMatches)

type ActiveCompetition = {
  id: string
  external_id: string
  season: string
}

function buildFakeDb(rows: ActiveCompetition[]) {
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

describe('discoverFixtures', () => {
  beforeEach(() => {
    syncFixturesMock.mockReset()
    scoreMock.mockReset()
    syncFixturesMock.mockResolvedValue(undefined as never)
    scoreMock.mockResolvedValue(undefined)
  })

  it('does nothing when no active competitions are found', async () => {
    const db = buildFakeDb([])
    const ae = buildFakeAe()

    await discoverFixtures(
      db as unknown as D1Database,
      'key',
      ae as unknown as AnalyticsEngineDataset,
    )

    expect(syncFixturesMock).not.toHaveBeenCalled()
    expect(scoreMock).not.toHaveBeenCalled()

    const runs = pointsOfType(ae, 'fixture_discovery_run')
    expect(runs).toHaveLength(1)
    expect(runs[0].blobs?.[1]).toBe('ok')
    expect(runs[0].doubles?.slice(0, 3)).toEqual([0, 0, 0])
  })

  it('filters competitions by status and provider', async () => {
    const db = buildFakeDb([])

    await discoverFixtures(db as unknown as D1Database, 'key')

    expect(db._captured.sql).toContain("status != 'finished'")
    expect(db._captured.sql).toContain("provider = 'football-data'")
    expect(db._captured.sql).toContain('external_id IS NOT NULL')
  })

  it('calls syncFixtures and scoreUnprocessedMatches for each active competition', async () => {
    const db = buildFakeDb([
      { id: 'c1', external_id: 'WC', season: '2026' },
      { id: 'c2', external_id: 'CL', season: '2026' },
    ])

    await discoverFixtures(db as unknown as D1Database, 'key')

    expect(syncFixturesMock).toHaveBeenCalledTimes(2)
    expect(syncFixturesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        competitionCode: 'WC',
        season: 2026,
        apiKey: 'key',
      }),
    )
    expect(syncFixturesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        competitionCode: 'CL',
        season: 2026,
        apiKey: 'key',
      }),
    )
    // Should NOT have matchday
    const calls = syncFixturesMock.mock.calls
    expect(calls[0][0]).not.toHaveProperty('matchday')
    expect(calls[1][0]).not.toHaveProperty('matchday')

    expect(scoreMock).toHaveBeenCalledTimes(2)
    expect(scoreMock).toHaveBeenCalledWith('c1', expect.anything())
    expect(scoreMock).toHaveBeenCalledWith('c2', expect.anything())
  })

  it('logs fixture_discovery_run event with ok status and correct counts on success', async () => {
    syncFixturesMock.mockResolvedValue({ matches: 5 } as never)
    const db = buildFakeDb([
      { id: 'c1', external_id: 'WC', season: '2026' },
      { id: 'c2', external_id: 'CL', season: '2026' },
    ])
    const ae = buildFakeAe()

    await discoverFixtures(
      db as unknown as D1Database,
      'key',
      ae as unknown as AnalyticsEngineDataset,
    )

    const runs = pointsOfType(ae, 'fixture_discovery_run')
    expect(runs).toHaveLength(1)
    expect(runs[0].blobs?.[1]).toBe('ok')

    const [competitions, fixturesUpdated, apiCalls] = runs[0].doubles ?? []
    expect(competitions).toBe(2)
    expect(fixturesUpdated).toBe(10) // 5 per sync call, 2 calls
    expect(apiCalls).toBe(2)

    expect(pointsOfType(ae, 'football_api_error')).toHaveLength(0)
  })

  it('isolates failures and continues for other competitions, logging errors', async () => {
    // Fail for first call, succeed for second
    syncFixturesMock.mockRejectedValueOnce(new Error('API Error'))
    syncFixturesMock.mockResolvedValueOnce({ matches: 3 } as never)

    const db = buildFakeDb([
      { id: 'c1', external_id: 'WC', season: '2026' },
      { id: 'c2', external_id: 'CL', season: '2026' },
    ])
    const ae = buildFakeAe()

    await discoverFixtures(
      db as unknown as D1Database,
      'key',
      ae as unknown as AnalyticsEngineDataset,
    )

    expect(syncFixturesMock).toHaveBeenCalledTimes(2)

    // First competition shouldn't be scored if sync fails
    expect(scoreMock).toHaveBeenCalledTimes(1)
    expect(scoreMock).toHaveBeenCalledWith('c2', expect.anything())

    const errors = pointsOfType(ae, 'football_api_error')
    expect(errors).toHaveLength(1)
    expect(errors[0].blobs?.[1]).toBe('fixture_discovery')
    expect(errors[0].blobs?.[2]).toBe('c1')
    expect(errors[0].blobs?.[3]).toBe('API Error')

    const runs = pointsOfType(ae, 'fixture_discovery_run')
    expect(runs).toHaveLength(1)
    expect(runs[0].blobs?.[1]).toBe('error')

    const [competitions, fixturesUpdated, apiCalls] = runs[0].doubles ?? []
    expect(competitions).toBe(2)
    expect(fixturesUpdated).toBe(3)
    expect(apiCalls).toBe(2)
  })

  it('respects concurrency limit of 5', async () => {
    const competitions = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      external_id: `COMP${i}`,
      season: '2026',
    }))
    const db = buildFakeDb(competitions)

    let executingCount = 0
    let maxExecutingCount = 0

    syncFixturesMock.mockImplementation(async () => {
      executingCount++
      maxExecutingCount = Math.max(maxExecutingCount, executingCount)
      await new Promise((resolve) => setTimeout(resolve, 10))
      executingCount--
      return undefined as never
    })

    await discoverFixtures(db as unknown as D1Database, 'key')

    expect(syncFixturesMock).toHaveBeenCalledTimes(10)
    expect(maxExecutingCount).toBeLessThanOrEqual(5)
  })
})
