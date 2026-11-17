import type { D1Database } from '@cloudflare/workers-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sync', () => ({ syncFixtures: vi.fn(async () => undefined) }))
vi.mock('./scoring', () => ({
  scoreUnprocessedMatches: vi.fn(async () => ({ scored: 0, complete: true })),
}))
vi.mock('./competitionLifecycle', () => ({
  reconcileCompetitionStatus: vi.fn(async () => 'ongoing'),
}))

import { reconcileCompetitionStatus } from './competitionLifecycle'
import { discoverFixtures } from './fixtureDiscovery'
import { EspnUnavailableError } from '../providers/espn'
import { FD_MAX_CONCURRENT_REQUESTS } from './footballDataQuota'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

const syncFixturesMock = vi.mocked(syncFixtures)
const scoreMock = vi.mocked(scoreUnprocessedMatches)
const reconcileMock = vi.mocked(reconcileCompetitionStatus)

type ActiveCompetition = {
  id: string
  external_id: string
  season: string
  provider?: string
}

function buildFakeDb(rows: ActiveCompetition[], accessRow: () => unknown = () => null) {
  const captured: { sql: string; params: unknown[] } = { sql: '', params: [] }
  const batches: number[] = []
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
        // A leitura do estado de acesso da ESPN antes da descoberta (livre, sem linha, por padrão).
        async first(): Promise<unknown> {
          return accessRow()
        },
      }
      return stmt
    },
    // O adiamento de falha grava o item pendente da fila durável; sem efeito
    // neste fake, que só observa as competições lidas.
    async batch(statements: unknown[]): Promise<unknown[]> {
      batches.push(statements.length)
      return []
    },
    _captured: captured,
    _batches: batches,
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
    reconcileMock.mockClear()
    syncFixturesMock.mockResolvedValue(undefined as never)
    scoreMock.mockResolvedValue({ scored: 0, complete: true })
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
    expect(db._captured.sql).toContain("provider IN ('football-data', 'espn')")
    expect(db._captured.sql).toContain('external_id IS NOT NULL')
  })

  it('calls syncFixtures and scoreUnprocessedMatches for each active competition', async () => {
    const db = buildFakeDb([
      { id: 'c1', external_id: 'WC', season: '2026', provider: 'football-data' },
      { id: 'c2', external_id: 'CL', season: '2026', provider: 'football-data' },
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
      { id: 'c1', external_id: 'WC', season: '2026', provider: 'football-data' },
      { id: 'c2', external_id: 'CL', season: '2026', provider: 'football-data' },
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
      { id: 'c1', external_id: 'WC', season: '2026', provider: 'football-data' },
      { id: 'c2', external_id: 'CL', season: '2026', provider: 'football-data' },
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
    // Nem tem o status avançado com um calendário que não foi atualizado.
    expect(reconcileMock).toHaveBeenCalledTimes(1)
    expect(reconcileMock).toHaveBeenCalledWith(expect.anything(), 'c2', expect.any(Number), 0)

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

  it('passa à reconciliação os jogos que o sync descartou por time indefinido', async () => {
    syncFixturesMock.mockResolvedValue({ matches: 3, discarded: 2, discardedTbd: 1 } as never)
    const db = buildFakeDb([
      { id: 'c1', external_id: 'ELC', season: '2026', provider: 'football-data' },
    ])

    await discoverFixtures(db as unknown as D1Database, 'key', undefined, 1_000)

    expect(reconcileMock).toHaveBeenCalledWith(expect.anything(), 'c1', 1_000, 1)
  })

  it('falha ao gravar o status vira competition_status_error, não erro de provedor', async () => {
    reconcileMock.mockRejectedValueOnce(new Error('D1_ERROR: busy'))
    const db = buildFakeDb([
      { id: 'c1', external_id: 'WC', season: '2026', provider: 'football-data' },
      { id: 'c2', external_id: 'CL', season: '2026', provider: 'football-data' },
    ])
    const ae = buildFakeAe()

    await discoverFixtures(
      db as unknown as D1Database,
      'key',
      ae as unknown as AnalyticsEngineDataset,
    )

    expect(pointsOfType(ae, 'football_api_error')).toEqual([])
    const errors = pointsOfType(ae, 'competition_status_error')
    expect(errors).toHaveLength(1)
    expect(errors[0].blobs?.slice(1)).toEqual(['c1', 'D1_ERROR: busy'])
    expect(reconcileMock).toHaveBeenCalledTimes(2)
    expect(pointsOfType(ae, 'fixture_discovery_run')[0].blobs?.[1]).toBe('error')
  })

  it('passa ao sync um observer com contexto discovery e a competição de cada chamada', async () => {
    const ae = buildFakeAe()
    const db = buildFakeDb([
      { id: 'c1', external_id: 'WC', season: '2026', provider: 'football-data' },
      { id: 'c2', external_id: 'bra.1', season: '2026', provider: 'espn' },
    ])

    await discoverFixtures(
      db as unknown as D1Database,
      'key',
      ae as unknown as AnalyticsEngineDataset,
    )

    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    for (const [opts] of syncFixturesMock.mock.calls) {
      opts.onHttpAttempt?.({
        provider: opts.competitionCode === 'WC' ? 'football-data' : 'espn',
        status: 403,
        durationMs: 15,
      })
    }
    vi.restoreAllMocks()

    const attempts = pointsOfType(ae, 'provider_http_attempt')
    expect(attempts.map((p) => p.blobs?.slice(1)).sort()).toEqual([
      ['espn', 'c2', '403', 'discovery'],
      ['football-data', 'c1', '403', 'discovery'],
    ])
  })

  it('sem binding do Analytics Engine não cria observer', async () => {
    const db = buildFakeDb([
      { id: 'c1', external_id: 'WC', season: '2026', provider: 'football-data' },
    ])

    await discoverFixtures(db as unknown as D1Database, 'key')

    expect(syncFixturesMock.mock.calls[0][0].onHttpAttempt).toBeUndefined()
  })

  it('handles scoreUnprocessedMatches failure without losing fixturesUpdated count', async () => {
    syncFixturesMock.mockResolvedValueOnce({ matches: 5 } as never)
    scoreMock.mockRejectedValueOnce(new Error('Scoring Error'))

    const db = buildFakeDb([
      { id: 'c1', external_id: 'WC', season: '2026', provider: 'football-data' },
    ])
    const ae = buildFakeAe()

    await discoverFixtures(
      db as unknown as D1Database,
      'key',
      ae as unknown as AnalyticsEngineDataset,
    )

    expect(syncFixturesMock).toHaveBeenCalledTimes(1)
    expect(scoreMock).toHaveBeenCalledTimes(1)

    const errors = pointsOfType(ae, 'football_api_error')
    expect(errors).toHaveLength(1)
    expect(errors[0].blobs?.[1]).toBe('fixture_discovery')
    expect(errors[0].blobs?.[2]).toBe('c1')
    expect(errors[0].blobs?.[3]).toBe('Scoring Error')

    const runs = pointsOfType(ae, 'fixture_discovery_run')
    expect(runs).toHaveLength(1)
    expect(runs[0].blobs?.[1]).toBe('error')

    const [competitions, fixturesUpdated, apiCalls] = runs[0].doubles ?? []
    expect(competitions).toBe(1)
    expect(fixturesUpdated).toBe(5) // Should retain the count from syncFixtures
    expect(apiCalls).toBe(1)
  })

  it('caps concurrent football-data syncs under FD_MAX_CONCURRENT_REQUESTS', async () => {
    const competitions = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      external_id: `COMP${i}`,
      season: '2026',
      provider: 'football-data',
    }))
    const db = buildFakeDb(competitions)

    let fdInFlight = 0
    let fdPeak = 0
    let holdFd = true
    const fdWaiters: Array<() => void> = []

    syncFixturesMock.mockImplementation(async () => {
      fdInFlight++
      fdPeak = Math.max(fdPeak, fdInFlight)
      if (holdFd) {
        await new Promise<void>((resolve) => {
          fdWaiters.push(resolve)
        })
      }
      fdInFlight--
      return undefined as never
    })

    const done = discoverFixtures(db as unknown as D1Database, 'key')

    await vi.waitFor(() => {
      expect(fdWaiters.length).toBe(FD_MAX_CONCURRENT_REQUESTS)
    })
    expect(fdPeak).toBe(FD_MAX_CONCURRENT_REQUESTS)
    expect(fdInFlight).toBe(FD_MAX_CONCURRENT_REQUESTS)

    holdFd = false
    for (const release of fdWaiters.splice(0)) release()
    await done

    expect(syncFixturesMock).toHaveBeenCalledTimes(10)
    expect(fdPeak).toBeLessThanOrEqual(FD_MAX_CONCURRENT_REQUESTS)
  })

  it('runs ESPN discovery while football-data workers are still latched', async () => {
    const competitions = [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `fd-${i}`,
        external_id: `COMP${i}`,
        season: '2026',
        provider: 'football-data',
      })),
      {
        id: 'espn-1',
        external_id: 'conmebol.libertadores',
        season: '2026',
        provider: 'espn',
      },
    ]
    const db = buildFakeDb(competitions)

    let holdFd = true
    const fdWaiters: Array<() => void> = []
    let espnResolvedWhileFdHeld = false

    syncFixturesMock.mockImplementation(async (opts) => {
      if (opts.competitionCode === 'conmebol.libertadores') {
        expect(opts.dates).toHaveLength(9)
        espnResolvedWhileFdHeld = holdFd
        return { matches: 2 } as never
      }
      if (holdFd) {
        await new Promise<void>((resolve) => {
          fdWaiters.push(resolve)
        })
      }
      return { matches: 1 } as never
    })

    const done = discoverFixtures(db as unknown as D1Database, 'key')

    await vi.waitFor(() => {
      expect(fdWaiters.length).toBe(FD_MAX_CONCURRENT_REQUESTS)
    })
    await vi.waitFor(() => {
      expect(espnResolvedWhileFdHeld).toBe(true)
    })

    const espnCall = syncFixturesMock.mock.calls.find(
      (call) => call[0].competitionCode === 'conmebol.libertadores',
    )
    expect(espnCall?.[0].dates).toHaveLength(9)

    holdFd = false
    for (const release of fdWaiters.splice(0)) release()
    await done

    expect(syncFixturesMock).toHaveBeenCalledTimes(7)
    expect(espnResolvedWhileFdHeld).toBe(true)
  })

  describe('ESPN e o controle de acesso', () => {
    const espnComp = {
      id: 'espn-1',
      external_id: 'conmebol.libertadores',
      season: '2026',
      provider: 'espn',
    }

    it('data da ESPN que não chegou falha a competição inteira, como o fetch que lança, e o status não avança', async () => {
      syncFixturesMock.mockResolvedValueOnce({
        matches: 2,
        pending: { dates: ['20261110'], error: new Error('ESPN respondeu 503') },
      } as never)
      const ae = buildFakeAe()
      const db = buildFakeDb([espnComp])

      await discoverFixtures(
        db as unknown as D1Database,
        'key',
        ae as unknown as AnalyticsEngineDataset,
      )

      const errors = pointsOfType(ae, 'football_api_error')
      expect(errors).toHaveLength(1)
      expect(errors[0].blobs?.[3]).toBe('ESPN respondeu 503')
      expect(reconcileMock).not.toHaveBeenCalled()
      expect(pointsOfType(ae, 'fixture_discovery_run')[0].blobs?.[1]).toBe('error')
    })

    it('a recusa do acesso não é falha do sync: sem erro, sem fila e sem avançar o status', async () => {
      syncFixturesMock.mockResolvedValueOnce({
        matches: 0,
        pending: {
          dates: ['20261110'],
          error: new EspnUnavailableError('blocked', Date.now() + 60_000),
        },
      } as never)
      const ae = buildFakeAe()
      const db = buildFakeDb([espnComp])

      await discoverFixtures(
        db as unknown as D1Database,
        'key',
        ae as unknown as AnalyticsEngineDataset,
      )

      expect(pointsOfType(ae, 'football_api_error')).toEqual([])
      expect(db._batches).toEqual([])
      expect(reconcileMock).not.toHaveBeenCalled()
      expect(pointsOfType(ae, 'fixture_discovery_run')[0].blobs?.[1]).toBe('ok')
    })

    it('com a ESPN pausada a competição não é sincronizada, e a football-data segue', async () => {
      const db = buildFakeDb(
        [espnComp, { id: 'fd-1', external_id: 'WC', season: '2026', provider: 'football-data' }],
        () => ({
          blocked_until: Date.now() + 60_000,
          forbidden_streak: 1,
          suspended_at: null,
          suspended_reason: null,
        }),
      )

      await discoverFixtures(db as unknown as D1Database, 'key')

      expect(syncFixturesMock).toHaveBeenCalledTimes(1)
      expect(syncFixturesMock.mock.calls[0][0].competitionCode).toBe('WC')
    })

    it('só lê o estado de acesso quando há competição da ESPN', async () => {
      const first = vi.fn(() => null)
      const db = buildFakeDb(
        [{ id: 'fd-1', external_id: 'WC', season: '2026', provider: 'football-data' }],
        first,
      )

      await discoverFixtures(db as unknown as D1Database, 'key')

      expect(first).not.toHaveBeenCalled()
    })
  })
})
