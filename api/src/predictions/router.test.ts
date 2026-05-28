import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { signJwt } from '../auth/jwt'
import { predictionsRouter } from './router'
import type { AppContext } from '../types'

const JWT_SECRET = 'test-secret-predictions-router'

interface GroupMockOptions {
  isMember?: boolean
  members?: Array<{ user_id: string; display: string }>
  predictions?: Array<Record<string, unknown>>
}

function createGroupPicksDbMock(opts: GroupMockOptions = {}) {
  const { isMember = true, members = [], predictions = [] } = opts

  const db = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              // membership check
              if (sql.includes('FROM group_members WHERE')) {
                return isMember ? { id: 'gm-1' } : null
              }
              return null
            },
            async all() {
              if (sql.includes('FROM group_members gm')) {
                return { results: members }
              }
              if (sql.includes('FROM predictions pr')) {
                return { results: predictions }
              }
              return { results: [] }
            },
          }
        },
      }
    },
  }

  return db as unknown as D1Database
}

function fakeEnv(db: D1Database): AppContext['Bindings'] {
  return {
    JWT_SECRET,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'http://localhost:8787',
    FRONTEND_URL: 'http://localhost:5173',
    FOOTBALL_API_KEY: 'test-api-key',
    DB: db,
  }
}

async function requestGroupPicks(db: D1Database, query: string) {
  const token = await signJwt({ sub: 'user-1', email: 'user@example.com' }, JWT_SECRET, 3600)
  const headers = new Headers({ Cookie: `session=${token}` })

  const app = new Hono<AppContext>()
  app.route('/predictions', predictionsRouter)

  return app.fetch(
    new Request(`http://localhost/predictions/group${query}`, {
      method: 'GET',
      headers,
    }),
    fakeEnv(db),
  )
}

describe('predictions router – GET /group', () => {
  it('requires group_id', async () => {
    const res = await requestGroupPicks(createGroupPicksDbMock(), '')
    expect(res.status).toBe(400)
  })

  it('denies access to non-members', async () => {
    const res = await requestGroupPicks(
      createGroupPicksDbMock({ isMember: false }),
      '?group_id=g1',
    )
    expect(res.status).toBe(403)
  })

  it('returns the self user id, roster and members predictions', async () => {
    const members = [
      { user_id: 'user-1', display: 'Pedro' },
      { user_id: 'user-2', display: 'Ana' },
    ]
    const predictions = [
      {
        match_id: 'm1',
        user_id: 'user-1',
        user_display: 'Pedro',
        predicted_home_score: 2,
        predicted_away_score: 1,
        points_awarded: 0,
        locked: 0,
      },
      {
        match_id: 'm1',
        user_id: 'user-2',
        user_display: 'Ana',
        predicted_home_score: 0,
        predicted_away_score: 0,
        points_awarded: 0,
        locked: 0,
      },
    ]

    const res = await requestGroupPicks(
      createGroupPicksDbMock({ members, predictions }),
      '?group_id=g1',
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      self_user_id: string
      members: typeof members
      predictions: typeof predictions
    }

    expect(body.self_user_id).toBe('user-1')
    expect(body.members).toHaveLength(2)
    expect(body.predictions).toHaveLength(2)
    expect(body.predictions[0]?.match_id).toBe('m1')
  })
})
