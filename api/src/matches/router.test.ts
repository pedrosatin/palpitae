import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { matchesRouter } from './router'
import type { AppContext } from '../types'
import { signJwt } from '../auth/jwt'
import * as permissions from '../auth/permissions'

const { syncFixturesSpy } = vi.hoisted(() => ({
  syncFixturesSpy: vi.fn(),
}))

vi.mock('./sync', () => ({
  syncFixtures: syncFixturesSpy,
}))

function fakeEnv(db: D1Database): AppContext['Bindings'] {
  return {
    JWT_SECRET: 'secret',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'http://localhost:8787',
    FRONTEND_URL: 'http://localhost:5173',
    FOOTBALL_API_KEY: 'test-api-key',
    RESEND_API_KEY: 'test-resend-key',
    DB: db,
  }
}

function createMatchesDbMock(
  matchRows: { status: string }[] = [],
  counter?: { mainQueries: number },
  defaultRoundRows?: { active?: string; last?: string },
) {
  function resultsFor(sql: string): { results: unknown[] } {
    if (sql.includes('FROM matches m')) {
      if (sql.includes('JOIN competitions') && sql.includes('SELECT m.id, m.home_score')) {
         // This is from scoring logic we shouldn't increment router main query
      } else {
        if (counter) counter.mainQueries++
      }
      return { results: matchRows }
    }
    if (sql.includes('GROUP BY round') && defaultRoundRows?.active) {
      return { results: [{ round: defaultRoundRows.active }] }
    }
    if (sql.includes('start_time DESC') && defaultRoundRows?.last) {
      return { results: [{ round: defaultRoundRows.last }] }
    }
    return { results: [] }
  }

  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async all() {
              return resultsFor(sql)
            },
            async first() {
              if (sql.includes('FROM competitions WHERE id = ?')) {
                return {
                  external_id: 'WC',
                  provider: 'football-data',
                  season: '2026',
                }
              }

              if (sql.includes('COUNT(*) AS count')) {
                if (sql.includes('status = \'finished\'') && sql.includes('scored_at IS NULL')) {
                  const compId = params[0] as string
                  const count = matchRows.filter(
                    (m: any) =>
                      m.competition_id === compId &&
                      m.status === 'finished' &&
                      m.scored_at === null &&
                      m.home_score !== null &&
                      m.away_score !== null,
                  ).length
                  return { count }
                }
                return { count: 0 }
              }

              throw new Error(`Unexpected first() query: ${sql} :: ${params.join(',')}`)
            },
          }
        },
      }
    },
    async batch(statements: { all: () => Promise<{ results: unknown[] }> }[]) {
      return Promise.all(statements.map((s) => s.all()))
    },
  }

  return db as unknown as D1Database
}

describe('matches router – GET /', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    syncFixturesSpy.mockResolvedValue({
      competition: 'World Cup',
      competitionId: 'comp-1',
      matches: 0,
      teams: 0,
    })
  })

  it('returns the first open round as default_round', async () => {
    const app = new Hono<AppContext>()
    app.route('/matches', matchesRouter)

    const response = await app.fetch(
      new Request('http://localhost/matches?competition_id=comp-1'),
      fakeEnv(createMatchesDbMock([{ status: 'scheduled' }], undefined, { active: '3' })),
      { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} },
    )

    await expect(response.json()).resolves.toMatchObject({ default_round: '3' })
  })

  it('falls back to the last match round when no open round exists', async () => {
    const app = new Hono<AppContext>()
    app.route('/matches', matchesRouter)

    const response = await app.fetch(
      new Request('http://localhost/matches?competition_id=comp-1'),
      fakeEnv(createMatchesDbMock([{ status: 'finished' }], undefined, { last: '2' })),
      { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} },
    )

    await expect(response.json()).resolves.toMatchObject({ default_round: '2' })
  })

  it('omits default_round when a round filter is active', async () => {
    const app = new Hono<AppContext>()
    app.route('/matches', matchesRouter)

    const response = await app.fetch(
      new Request('http://localhost/matches?competition_id=comp-1&round=1'),
      fakeEnv(createMatchesDbMock([{ status: 'scheduled' }])),
      { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} },
    )

    const body = await response.json() as Record<string, unknown>
    expect(body).not.toHaveProperty('default_round')
  })

  it('derives decides_on_penalties from the competition gate and strips penalty_phases', async () => {
    const app = new Hono<AppContext>()
    app.route('/matches', matchesRouter)

    const rows = [
      { status: 'scheduled', phase: 'FINAL', penalty_phases: '["LAST_16","FINAL"]' },
      { status: 'scheduled', phase: 'GROUP_STAGE', penalty_phases: '["LAST_16","FINAL"]' },
    ] as unknown as { status: string }[]

    const response = await app.fetch(
      new Request('http://localhost/matches?competition_id=comp-1&round=1'),
      fakeEnv(createMatchesDbMock(rows)),
      { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} },
    )

    const body = (await response.json()) as { matches: Array<Record<string, unknown>> }
    expect(body.matches[0].decides_on_penalties).toBe(true) // FINAL ∈ gate
    expect(body.matches[1].decides_on_penalties).toBe(false) // GROUP_STAGE ∉ gate
    expect(body.matches[0]).not.toHaveProperty('penalty_phases') // raw gate stripped
  })

  it('returns immediately and delegates first sync to waitUntil when no matches are cached locally', async () => {
    const app = new Hono<AppContext>()
    app.route('/matches', matchesRouter)

    const waitUntil = vi.fn()
    const response = await app.fetch(
      new Request('http://localhost/matches?competition_id=comp-1'),
      fakeEnv(createMatchesDbMock()),
      { waitUntil, passThroughOnException: vi.fn(), props: {} },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ matches: [], default_round: null })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(syncFixturesSpy).toHaveBeenCalledTimes(1)
  })

  describe('Cache-Control derived from response contents', () => {
    async function cacheHeaderFor(matchRows: { status: string }[]): Promise<string | null> {
      const app = new Hono<AppContext>()
      app.route('/matches', matchesRouter)

      const response = await app.fetch(
        new Request('http://localhost/matches?competition_id=comp-1'),
        fakeEnv(createMatchesDbMock(matchRows)),
        { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} },
      )

      return response.headers.get('Cache-Control')
    }

    it('caches an all-finished list for 24h', async () => {
      expect(await cacheHeaderFor([{ status: 'finished' }, { status: 'finished' }])).toBe(
        'public, max-age=86400',
      )
    })

    it('uses a short TTL for a list with not-yet-finished scheduled matches', async () => {
      expect(await cacheHeaderFor([{ status: 'finished' }, { status: 'scheduled' }])).toBe(
        'public, max-age=60',
      )
    })

    it('uses a short TTL for an empty list so it repopulates quickly', async () => {
      expect(await cacheHeaderFor([])).toBe('public, max-age=60')
    })
  })

  describe('edge cache (Cache API)', () => {
    afterEach(() => {
      delete (globalThis as { caches?: unknown }).caches
    })

    it('serves a second identical request from the edge cache without touching D1', async () => {
      const store = new Map<string, Response>()
      ;(globalThis as { caches?: unknown }).caches = {
        default: {
          async match(req: Request) {
            const hit = store.get(req.url)
            return hit ? hit.clone() : undefined
          },
          async put(req: Request, res: Response) {
            store.set(req.url, res)
          },
        },
      }

      const counter = { mainQueries: 0 }
      const env = fakeEnv(createMatchesDbMock([{ status: 'finished' }], counter))

      const app = new Hono<AppContext>()
      app.route('/matches', matchesRouter)

      const makeCtx = () => {
        const pending: Promise<unknown>[] = []
        return {
          ctx: {
            waitUntil: (p: Promise<unknown>) => pending.push(p),
            passThroughOnException: vi.fn(),
            props: {},
          },
          settle: () => Promise.all(pending),
        }
      }
      const newRequest = () => new Request('http://localhost/matches?competition_id=comp-1')

      const first = makeCtx()
      const r1 = await app.fetch(newRequest(), env, first.ctx)
      await first.settle() // let waitUntil(cache.put(...)) run
      expect(r1.status).toBe(200)

      const second = makeCtx()
      const r2 = await app.fetch(newRequest(), env, second.ctx)
      expect(r2.status).toBe(200)
      await expect(r2.json()).resolves.toEqual({
        matches: [{ status: 'finished', round_label: '', decides_on_penalties: false }],
        default_round: null,
      })

      // Only the first request queried D1; the second came from the edge cache.
      expect(counter.mainQueries).toBe(1)
    })
  })

  describe('POST /sync', () => {
    it('returns 403 when user does not have sync_matches access', async () => {
      vi.spyOn(permissions, 'hasFeatureAccess').mockReturnValue(false)

      const app = new Hono<AppContext>()
      app.route('/matches', matchesRouter)
      const token = await signJwt({ sub: 'user-1', email: 'test@example.com' }, 'secret', 3600)

      const req = new Request('http://localhost/matches/sync', {
        method: 'POST',
        headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ competition: 'WC', season: 2026 }),
      })

      const response = await app.fetch(req, fakeEnv(createMatchesDbMock()), {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
        props: {},
      })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({
        error: 'Você não tem permissão para sincronizar partidas',
      })
    })

    it('processes sync when user has sync_matches access', async () => {
      vi.spyOn(permissions, 'hasFeatureAccess').mockReturnValue(true)

      const app = new Hono<AppContext>()
      app.route('/matches', matchesRouter)
      const token = await signJwt({ sub: 'admin-1', email: 'admin@example.com' }, 'secret', 3600)

      const req = new Request('http://localhost/matches/sync', {
        method: 'POST',
        headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ competition: 'WC', season: 2026 }),
      })

      const db = createMatchesDbMock()
      const env = fakeEnv(db)

      const response = await app.fetch(req, env, {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
        props: {},
      })

      expect(response.status).toBe(200)
      expect(syncFixturesSpy).toHaveBeenCalledWith({
        competitionCode: 'WC',
        season: 2026,
        matchday: undefined,
        apiKey: env.FOOTBALL_API_KEY,
        db,
      })
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
      })
    })
  })
})