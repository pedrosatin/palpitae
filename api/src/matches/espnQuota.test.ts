import type { D1Database } from '@cloudflare/workers-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sync', () => ({ syncFixtures: vi.fn(async () => undefined) }))
vi.mock('./scoring', () => ({
  scoreUnprocessedMatches: vi.fn(async () => undefined),
}))
vi.mock('./espnFallback', () => ({
  scoreWindowFromEspn: vi.fn(async () => new Map()),
}))

import { ESPN_MIN_INTERVAL_MS } from '../providers/espn'
import { ESPN_MAX_CONCURRENT_COMPETITIONS } from './espnQuota'
import { discoverFixtures } from './fixtureDiscovery'
import { pollActiveMatches } from './poller'
import { syncFixtures } from './sync'

const syncFixturesMock = vi.mocked(syncFixtures)

type ActiveCompetition = {
  id: string
  external_id: string
  season: string
  provider?: string
}

type ActiveRound = {
  comp_id: string
  external_id: string
  provider?: string
  season: string
  round: string
  utc_day: string
}

function buildFakeDb(rows: ActiveCompetition[] | ActiveRound[]) {
  return {
    prepare(_sql: string) {
      const stmt = {
        bind(..._args: unknown[]) {
          return stmt
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: rows as unknown as T[] }
        },
      }
      return stmt
    },
  }
}

describe('espnQuota', () => {
  beforeEach(() => {
    syncFixturesMock.mockReset()
    syncFixturesMock.mockResolvedValue(undefined as never)
  })

  it('documenta teto de competições abaixo do lote de 10 ESPN-primárias', () => {
    expect(ESPN_MAX_CONCURRENT_COMPETITIONS).toBeGreaterThan(0)
    expect(ESPN_MAX_CONCURRENT_COMPETITIONS).toBeLessThanOrEqual(10)
    expect(ESPN_MIN_INTERVAL_MS).toBe(1_300)
  })

  it('caps concurrent ESPN discovery syncs under ESPN_MAX_CONCURRENT_COMPETITIONS', async () => {
    const competitions = Array.from({ length: 10 }, (_, i) => ({
      id: `espn-${i}`,
      external_id: `test.espn.${i}`,
      season: '2026',
      provider: 'espn',
    }))
    const db = buildFakeDb(competitions)

    let inFlight = 0
    let peak = 0
    let hold = true
    const waiters: Array<() => void> = []

    syncFixturesMock.mockImplementation(async (opts) => {
      expect(opts.dates).toHaveLength(9)
      inFlight++
      peak = Math.max(peak, inFlight)
      if (hold) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve)
        })
      }
      inFlight--
      return { matches: 0 } as never
    })

    const done = discoverFixtures(db as unknown as D1Database, '')

    await vi.waitFor(() => {
      expect(waiters.length).toBe(ESPN_MAX_CONCURRENT_COMPETITIONS)
    })
    expect(peak).toBe(ESPN_MAX_CONCURRENT_COMPETITIONS)
    expect(inFlight).toBe(ESPN_MAX_CONCURRENT_COMPETITIONS)

    hold = false
    for (const release of waiters.splice(0)) release()
    await done

    expect(syncFixturesMock).toHaveBeenCalledTimes(10)
    expect(peak).toBeLessThanOrEqual(ESPN_MAX_CONCURRENT_COMPETITIONS)
  })

  it('caps concurrent ESPN poller syncs under ESPN_MAX_CONCURRENT_COMPETITIONS', async () => {
    const now = Date.parse('2026-10-15T20:00:00Z')
    const rows = Array.from({ length: 10 }, (_, i) => ({
      comp_id: `espn-${i}`,
      external_id: `test.espn.${i}`,
      provider: 'espn',
      season: '2026',
      round: 'SEMI_FINALS',
      utc_day: '2026-10-15',
    }))
    const db = buildFakeDb(rows)

    let inFlight = 0
    let peak = 0
    let hold = true
    const waiters: Array<() => void> = []

    syncFixturesMock.mockImplementation(async (opts) => {
      expect(opts.dates?.length).toBeGreaterThan(0)
      inFlight++
      peak = Math.max(peak, inFlight)
      if (hold) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve)
        })
      }
      inFlight--
      return { matches: 0 } as never
    })

    const done = pollActiveMatches(db as unknown as D1Database, '', undefined, now)

    await vi.waitFor(() => {
      expect(waiters.length).toBe(ESPN_MAX_CONCURRENT_COMPETITIONS)
    })
    expect(peak).toBe(ESPN_MAX_CONCURRENT_COMPETITIONS)

    hold = false
    for (const release of waiters.splice(0)) release()
    await done

    expect(syncFixturesMock).toHaveBeenCalledTimes(10)
    expect(peak).toBeLessThanOrEqual(ESPN_MAX_CONCURRENT_COMPETITIONS)
  })
})
