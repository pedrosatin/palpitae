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
  visibility?: 'hidden' | 'public'
  capturedSql?: string[]
}

function createGroupPicksDbMock(opts: GroupMockOptions = {}) {
  const {
    isMember = true,
    members = [],
    predictions = [],
    visibility = 'hidden',
    capturedSql,
  } = opts

  const db = {
    prepare(sql: string) {
      capturedSql?.push(sql)
      return {
        bind() {
          return {
            async first() {
              // membership check
              if (sql.includes('FROM group_members WHERE')) {
                return isMember ? { id: 'gm-1' } : null
              }
              // group visibility config lookup
              if (sql.includes('FROM groups') && sql.includes('predictions_visibility')) {
                return { predictions_visibility: visibility }
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
    RESEND_API_KEY: 'test-resend-key',
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

interface BulkMockOptions {
  isMember?: boolean
  // match_id -> start_time (ISO). Absent matches are treated as "not found".
  matches?: Record<string, string>
  // match_id -> phase (football-data stage). Drives the penalty gate alongside phases.
  phases?: Record<string, string>
  // Competition penalty_phases gate applied to every match in the mock.
  penaltyPhases?: string[]
  // match_ids adiados — start_time no passado NÃO trava o palpite (locking.ts).
  postponed?: string[]
}

function createBulkDbMock(opts: BulkMockOptions = {}) {
  const { isMember = true, matches = {}, phases = {}, penaltyPhases = [], postponed = [] } = opts
  const batched: unknown[] = []

  const db = {
    batched,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first() {
              if (sql.includes('FROM group_members WHERE')) {
                return isMember ? { id: 'gm-1' } : null
              }
              return null
            },
            async all() {
              if (sql.includes('FROM matches m')) {
                // params: [group_id, ...matchIds]
                const matchIds = params.slice(1) as string[]
                const results = matchIds
                  .filter((id) => matches[id] !== undefined)
                  .map((id) => ({
                    id,
                    start_time: matches[id],
                    postponed: postponed.includes(id) ? 1 : 0,
                    phase: phases[id] ?? null,
                    penalty_phases: JSON.stringify(penaltyPhases),
                  }))
                return { results }
              }
              return { results: [] }
            },
          }
        },
      }
    },
    async batch(statements: unknown[]) {
      batched.push(...statements)
      return statements.map(() => ({ success: true }))
    },
  }

  return db as unknown as D1Database & { batched: unknown[] }
}

async function requestBulk(db: D1Database, body: unknown) {
  const token = await signJwt({ sub: 'user-1', email: 'user@example.com' }, JWT_SECRET, 3600)
  const headers = new Headers({
    Cookie: `session=${token}`,
    'Content-Type': 'application/json',
  })

  const app = new Hono<AppContext>()
  app.route('/predictions', predictionsRouter)

  return app.fetch(
    new Request('http://localhost/predictions/bulk', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    }),
    fakeEnv(db),
  )
}

async function requestBulkRaw(db: D1Database, bodyRaw: string) {
  const token = await signJwt({ sub: 'user-1', email: 'user@example.com' }, JWT_SECRET, 3600)
  const headers = new Headers({
    Cookie: `session=${token}`,
    'Content-Type': 'application/json',
  })

  const app = new Hono<AppContext>()
  app.route('/predictions', predictionsRouter)

  return app.fetch(
    new Request('http://localhost/predictions/bulk', {
      method: 'PUT',
      headers,
      body: bodyRaw,
    }),
    fakeEnv(db),
  )
}

describe('predictions router – PUT /bulk', () => {
  const future = '2999-01-01T00:00:00.000Z'
  const past = '2000-01-01T00:00:00.000Z'

  it('requires group_id', async () => {
    const res = await requestBulk(createBulkDbMock(), {
      predictions: [{ match_id: 'm1', predicted_home_score: 1, predicted_away_score: 0 }],
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid JSON body', async () => {
    const res = await requestBulkRaw(createBulkDbMock(), 'invalid-json')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Body JSON inválido' })
  })

  it('rejects an empty predictions list', async () => {
    const res = await requestBulk(createBulkDbMock(), {
      group_id: 'g1',
      predictions: [],
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid scores', async () => {
    const res = await requestBulk(createBulkDbMock(), {
      group_id: 'g1',
      predictions: [{ match_id: 'm1', predicted_home_score: -1, predicted_away_score: 0 }],
    })
    expect(res.status).toBe(400)
  })

  it('denies access to non-members', async () => {
    const res = await requestBulk(createBulkDbMock({ isMember: false }), {
      group_id: 'g1',
      predictions: [{ match_id: 'm1', predicted_home_score: 1, predicted_away_score: 0 }],
    })
    expect(res.status).toBe(403)
  })

  it('saves valid matches and reports locked / not-found ones', async () => {
    const db = createBulkDbMock({ matches: { m1: future, m2: past } })
    const res = await requestBulk(db, {
      group_id: 'g1',
      predictions: [
        { match_id: 'm1', predicted_home_score: 2, predicted_away_score: 1 }, // saveable
        { match_id: 'm2', predicted_home_score: 0, predicted_away_score: 0 }, // locked
        { match_id: 'm3', predicted_home_score: 3, predicted_away_score: 3 }, // not found
      ],
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      saved: string[]
      locked: string[]
      not_found: string[]
    }
    expect(body.saved).toEqual(['m1'])
    expect(body.locked).toEqual(['m2'])
    expect(body.not_found).toEqual(['m3'])
    // Only the one saveable match is batched.
    expect(db.batched).toHaveLength(1)
  })

  it('jogo adiado NÃO trava, mesmo com start_time no passado', async () => {
    // Rodada 21 do Brasileirão: o provider adiou o jogo e o start_time gravado
    // continua sendo o horário original (já passou). Travar aqui congelaria o
    // palpite semanas antes do jogo ser efetivamente disputado.
    const db = createBulkDbMock({ matches: { m1: past }, postponed: ['m1'] })
    const res = await requestBulk(db, {
      group_id: 'g1',
      predictions: [{ match_id: 'm1', predicted_home_score: 2, predicted_away_score: 1 }],
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { saved: string[]; locked: string[] }
    expect(body.saved).toEqual(['m1'])
    expect(body.locked).toEqual([])
    expect(db.batched).toHaveLength(1)
  })

  it('rejects an eligible draw with no penalty winner (same rule as PUT /)', async () => {
    const db = createBulkDbMock({
      matches: { m1: future },
      phases: { m1: 'FINAL' },
      penaltyPhases: ['FINAL'],
    })
    const res = await requestBulk(db, {
      group_id: 'g1',
      predictions: [{ match_id: 'm1', predicted_home_score: 1, predicted_away_score: 1 }],
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { invalid_penalty: string[] }
    expect(body.invalid_penalty).toEqual(['m1'])
    expect(db.batched).toHaveLength(0)
  })

  it('accepts an eligible draw with a valid penalty winner', async () => {
    const db = createBulkDbMock({
      matches: { m1: future },
      phases: { m1: 'FINAL' },
      penaltyPhases: ['FINAL'],
    })
    const res = await requestBulk(db, {
      group_id: 'g1',
      predictions: [
        {
          match_id: 'm1',
          predicted_home_score: 1,
          predicted_away_score: 1,
          predicted_penalty_winner: 'away',
        },
      ],
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { saved: string[] }
    expect(body.saved).toEqual(['m1'])
    expect(db.batched).toHaveLength(1)
  })

  it('ignores the penalty pick when the phase is not eligible', async () => {
    const db = createBulkDbMock({
      matches: { m1: future },
      phases: { m1: 'GROUP_STAGE' },
      penaltyPhases: ['FINAL'],
    })
    const res = await requestBulk(db, {
      group_id: 'g1',
      // a draw, but GROUP_STAGE is not in the gate → no winner required, saved fine.
      predictions: [{ match_id: 'm1', predicted_home_score: 0, predicted_away_score: 0 }],
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { saved: string[] }
    expect(body.saved).toEqual(['m1'])
  })
})

describe('predictions router – GET /group', () => {
  it('requires group_id', async () => {
    const res = await requestGroupPicks(createGroupPicksDbMock(), '')
    expect(res.status).toBe(400)
  })

  it('denies access to non-members', async () => {
    const res = await requestGroupPicks(createGroupPicksDbMock({ isMember: false }), '?group_id=g1')
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

  it('reveals predictions for locked matches even when the requester has not predicted', async () => {
    // Simulate: user-1 (requester) did NOT predict match m2, but user-2 did.
    // m2 is a past/locked match, so the API should still include user-2's pick.
    const capturedSql: string[] = []
    const predictions = [
      {
        match_id: 'm2',
        user_id: 'user-2',
        user_display: 'Ana',
        predicted_home_score: 1,
        predicted_away_score: 0,
        points_awarded: 3,
        locked: 1,
      },
    ]

    const res = await requestGroupPicks(
      createGroupPicksDbMock({ predictions, capturedSql }),
      '?group_id=g1',
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { predictions: typeof predictions }
    expect(body.predictions).toHaveLength(1)
    expect(body.predictions[0]?.match_id).toBe('m2')

    // Verify the SQL uses the locked-match reveal condition (m.start_time <= ?)
    // in addition to the requester's own predictions subquery.
    const predSql = capturedSql.find((s) => s.includes('FROM predictions pr'))
    expect(predSql).toBeDefined()
    expect(predSql).toContain('m.start_time <= ?')
    expect(predSql).toContain('SELECT match_id FROM predictions WHERE group_id = ? AND user_id = ?')
  })

  it('public groups skip the anti-copy filter (no own-prediction subquery)', async () => {
    const capturedSql: string[] = []
    const predictions = [
      {
        match_id: 'm9',
        user_id: 'user-2',
        user_display: 'Ana',
        predicted_home_score: 2,
        predicted_away_score: 1,
        points_awarded: 0,
        locked: 0,
      },
    ]

    const res = await requestGroupPicks(
      createGroupPicksDbMock({
        predictions,
        visibility: 'public',
        capturedSql,
      }),
      '?group_id=g1',
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { predictions: typeof predictions }
    // A future/unlocked pick by another member is revealed even though the
    // requester never predicted it — because the group is public.
    expect(body.predictions).toHaveLength(1)
    expect(body.predictions[0]?.match_id).toBe('m9')

    const predSql = capturedSql.find((s) => s.includes('FROM predictions pr'))
    expect(predSql).toBeDefined()
    expect(predSql).not.toContain(
      'SELECT match_id FROM predictions WHERE group_id = ? AND user_id = ?',
    )
  })
})
