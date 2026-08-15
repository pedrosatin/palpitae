import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { competitionsRouter } from './router'
import type { AppContext } from '../types'

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

function createDbMock(competitions: Record<string, unknown>[], throwError = false): D1Database {
  return {
    prepare: vi.fn().mockImplementation(() => {
      if (throwError) {
        throw new Error('Database connection failed')
      }
      return {
        all: vi.fn().mockResolvedValue({ results: competitions }),
      }
    }),
  } as unknown as D1Database
}

describe('competitions router', () => {
  it('returns competitions and correctly derives has_penalty_phases', async () => {
    const app = new Hono<AppContext>()
    app.route('/competitions', competitionsRouter)

    const competitions = [
      { id: '1', name: 'Comp 1', penalty_phases: '["FINAL"]' },
      { id: '2', name: 'Comp 2', penalty_phases: '[]' },
      { id: '3', name: 'Comp 3', penalty_phases: null },
      { id: '4', name: 'Comp 4', penalty_phases: 'invalid json' },
    ]

    const token = await import('../auth/jwt').then((m) =>
      m.signJwt({ sub: 'test-user', email: 'test@example.com' }, 'secret', 3600),
    )
    const response = await app.fetch(
      new Request('http://localhost/competitions', {
        headers: {
          Cookie: `session=${token}`,
        },
      }),
      fakeEnv(createDbMock(competitions)),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=3600, stale-while-revalidate=86400',
    )

    const body = await response.json()
    expect(body).toEqual({
      competitions: [
        { id: '1', name: 'Comp 1', has_penalty_phases: true },
        { id: '2', name: 'Comp 2', has_penalty_phases: false },
        { id: '3', name: 'Comp 3', has_penalty_phases: false },
        { id: '4', name: 'Comp 4', has_penalty_phases: false },
      ],
    })
  })

  it('returns 500 on database error', async () => {
    const originalConsoleError = console.error
    console.error = vi.fn() // Suppress error logging in test output

    const app = new Hono<AppContext>()
    app.route('/competitions', competitionsRouter)

    const token = await import('../auth/jwt').then((m) =>
      m.signJwt({ sub: 'test-user', email: 'test@example.com' }, 'secret', 3600),
    )
    const response = await app.fetch(
      new Request('http://localhost/competitions', {
        headers: {
          Cookie: `session=${token}`,
        },
      }),
      fakeEnv(createDbMock([], true)),
    )

    expect(response.status).toBe(500)

    const body = await response.json()
    expect(body).toEqual({ error: 'Erro ao carregar competições' })

    console.error = originalConsoleError
  })
})
