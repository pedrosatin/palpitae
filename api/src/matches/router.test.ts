import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { matchesRouter } from './router'
import type { AppContext } from '../types'

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
    DB: db,
  }
}

function createMatchesDbMock() {
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async all() {
              if (sql.includes('FROM matches m')) {
                return { results: [] }
              }

              return { results: [] }
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
                return { count: 0 }
              }

              throw new Error(`Unexpected first() query: ${sql} :: ${params.join(',')}`)
            },
          }
        },
      }
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
    await expect(response.json()).resolves.toEqual({ matches: [] })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(syncFixturesSpy).toHaveBeenCalledTimes(1)
  })
})