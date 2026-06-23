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
  const { isMember = true, members = [], predictions = [], visibility = 'hidden', capturedSql } = opts

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

interface BulkMatchData {
  start_time: string
  phase?: string | null
}

interface BulkMockOptions {
  isMember?: boolean
  // match_id -> start_time (ISO) or a richer object. Absent matches are "not found".
  matches?: Record<string, string | BulkMatchData>
  penaltyPicksEnabled?: number
  pointsExact?: number
}

function createBulkDbMock(opts: BulkMockOptions = {}) {
  const { isMember = true, matches = {}, penaltyPicksEnabled = 1, pointsExact = 3 } = opts
  const batched: unknown[] = []

  const db = {
    batched,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first() {
              // Bulk reads membership + group penalty config in one JOIN query.
              if (sql.includes('FROM group_members gm')) {
                return isMember
                  ? { membership_id: 'gm-1', penalty_picks_enabled: penaltyPicksEnabled, points_exact: pointsExact }
                  : null
              }
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
                  .map((id) => {
                    const entry = matches[id]
                    const start_time = typeof entry === 'string' ? entry : entry.start_time
                    const phase = typeof entry === 'string' ? null : (entry.phase ?? null)
                    return {
                      id,
                      start_time,
                      phase,
                      home_team_id: `${id}-home`,
                      away_team_id: `${id}-away`,
                    }
                  })
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

interface SingleMatchConfig {
  id: string
  start_time: string
  round: string
  phase?: string | null
  home_team_id?: string
  away_team_id?: string
  penalty_picks_enabled?: number
  points_exact?: number
}

function createSingleDbMock(matchConfig: SingleMatchConfig | null, isMember = true) {
  const runs: Array<{ sql: string; params: unknown[] }> = []
  const db = {
    _runs: runs,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first() {
              if (sql.includes('FROM group_members WHERE')) {
                return isMember ? { id: 'gm-1' } : null
              }
              if (sql.includes('penalty_picks_enabled')) {
                if (!matchConfig) return null
                return {
                  id: matchConfig.id,
                  start_time: matchConfig.start_time,
                  round: matchConfig.round,
                  phase: matchConfig.phase ?? null,
                  home_team_id: matchConfig.home_team_id ?? 'team-home',
                  away_team_id: matchConfig.away_team_id ?? 'team-away',
                  penalty_picks_enabled: matchConfig.penalty_picks_enabled ?? 1,
                  points_exact: matchConfig.points_exact ?? 3,
                }
              }
              return null
            },
            async run() { runs.push({ sql, params }) },
            async all() { return { results: [] } },
          }
        },
      }
    },
  }
  return db as unknown as D1Database & { _runs: typeof runs }
}

async function requestSinglePut(db: D1Database, body: unknown) {
  const token = await signJwt({ sub: 'user-1', email: 'user@example.com' }, JWT_SECRET, 3600)
  const headers = new Headers({
    Cookie: `session=${token}`,
    'Content-Type': 'application/json',
  })

  const app = new Hono<AppContext>()
  app.route('/predictions', predictionsRouter)

  return app.fetch(
    new Request('http://localhost/predictions', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
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

  it('rejects an empty predictions list', async () => {
    const res = await requestBulk(createBulkDbMock(), { group_id: 'g1', predictions: [] })
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
})

describe('predictions router – PUT /bulk — penalty picks', () => {
  const future = '2999-01-01T00:00:00.000Z'

  it('saves a knockout draw with a valid penalty pick', async () => {
    const db = createBulkDbMock({ matches: { m1: { start_time: future, phase: 'QUARTER_FINALS' } } })
    const res = await requestBulk(db, {
      group_id: 'g1',
      predictions: [{
        match_id: 'm1', predicted_home_score: 1, predicted_away_score: 1,
        predicted_penalty_winner_team_id: 'm1-home',
      }],
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { saved: string[]; missing_penalty: string[] }
    expect(body.saved).toEqual(['m1'])
    expect(body.missing_penalty).toEqual([])
  })

  it('puts a knockout draw without a penalty pick in missing_penalty', async () => {
    const db = createBulkDbMock({ matches: { m1: { start_time: future, phase: 'QUARTER_FINALS' } } })
    const res = await requestBulk(db, {
      group_id: 'g1',
      predictions: [{
        match_id: 'm1', predicted_home_score: 1, predicted_away_score: 1,
        // no penalty pick
      }],
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { saved: string[]; missing_penalty: string[] }
    expect(body.saved).toEqual([])
    expect(body.missing_penalty).toEqual(['m1'])
  })

  it('puts a knockout draw with an invalid team in missing_penalty', async () => {
    const db = createBulkDbMock({ matches: { m1: { start_time: future, phase: 'QUARTER_FINALS' } } })
    const res = await requestBulk(db, {
      group_id: 'g1',
      predictions: [{
        match_id: 'm1', predicted_home_score: 1, predicted_away_score: 1,
        predicted_penalty_winner_team_id: 'not-a-real-team',
      }],
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { saved: string[]; missing_penalty: string[] }
    expect(body.saved).toEqual([])
    expect(body.missing_penalty).toEqual(['m1'])
  })

  it('saves a knockout non-draw and silently drops a spurious penalty pick', async () => {
    const db = createBulkDbMock({ matches: { m1: { start_time: future, phase: 'QUARTER_FINALS' } } })
    const res = await requestBulk(db, {
      group_id: 'g1',
      predictions: [{
        match_id: 'm1', predicted_home_score: 2, predicted_away_score: 1,
        predicted_penalty_winner_team_id: 'm1-home', // irrelevant: not a draw
      }],
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { saved: string[]; missing_penalty: string[] }
    expect(body.saved).toEqual(['m1'])
    expect(body.missing_penalty).toEqual([])
  })

  it('saves the score and drops a stray penalty pick when the group has picks disabled', async () => {
    const db = createBulkDbMock({
      matches: { m1: { start_time: future, phase: 'QUARTER_FINALS' } },
      penaltyPicksEnabled: 0,
    })
    const res = await requestBulk(db, {
      group_id: 'g1',
      predictions: [{
        match_id: 'm1', predicted_home_score: 1, predicted_away_score: 1,
        predicted_penalty_winner_team_id: 'm1-home',
      }],
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { saved: string[]; missing_penalty: string[] }
    // Stray pick dropped (group disabled), but the score is still saved — no data loss.
    expect(body.saved).toEqual(['m1'])
    expect(body.missing_penalty).toEqual([])
  })
})

describe('predictions router – PUT / (single) — penalty pick validation', () => {
  const future = '2999-01-01T00:00:00.000Z'

  const knockoutDraw: SingleMatchConfig = {
    id: 'm1', start_time: future, round: '1',
    phase: 'QUARTER_FINALS',
    home_team_id: 'team-home', away_team_id: 'team-away',
  }

  it('saves a knockout draw without a penalty pick and sets missing_penalty', async () => {
    const db = createSingleDbMock(knockoutDraw)
    const res = await requestSinglePut(db, {
      group_id: 'g1', match_id: 'm1',
      predicted_home_score: 1, predicted_away_score: 1,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; missing_penalty?: boolean }
    expect(body.ok).toBe(true)
    expect(body.missing_penalty).toBe(true)
    // Verify the UPSERT was actually executed with 9 bind params (matches UPSERT_PREDICTION_SQL)
    const upsertRun = (db as unknown as { _runs: Array<{ sql: string; params: unknown[] }> })._runs
      .find((r) => r.sql.includes('INSERT INTO predictions'))
    expect(upsertRun).toBeDefined()
    expect(upsertRun!.params).toHaveLength(9)
  })

  it('rejects a penalty pick for an invalid team', async () => {
    const db = createSingleDbMock(knockoutDraw)
    const res = await requestSinglePut(db, {
      group_id: 'g1', match_id: 'm1',
      predicted_home_score: 1, predicted_away_score: 1,
      predicted_penalty_winner_team_id: 'not-a-valid-team',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('inválido')
  })

  it('accepts a knockout draw with a valid penalty pick', async () => {
    const db = createSingleDbMock(knockoutDraw)
    const res = await requestSinglePut(db, {
      group_id: 'g1', match_id: 'm1',
      predicted_home_score: 1, predicted_away_score: 1,
      predicted_penalty_winner_team_id: 'team-home',
    })
    expect(res.status).toBe(200)
  })

  it('accepts a knockout non-draw without a penalty pick', async () => {
    const db = createSingleDbMock(knockoutDraw)
    const res = await requestSinglePut(db, {
      group_id: 'g1', match_id: 'm1',
      predicted_home_score: 2, predicted_away_score: 1,
    })
    expect(res.status).toBe(200)
  })

  it('rejects a penalty pick when the group has picks disabled', async () => {
    const db = createSingleDbMock({ ...knockoutDraw, penalty_picks_enabled: 0 })
    const res = await requestSinglePut(db, {
      group_id: 'g1', match_id: 'm1',
      predicted_home_score: 1, predicted_away_score: 1,
      predicted_penalty_winner_team_id: 'team-home',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('pênaltis')
  })
})

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
      createGroupPicksDbMock({ predictions, visibility: 'public', capturedSql }),
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
    expect(predSql).not.toContain('SELECT match_id FROM predictions WHERE group_id = ? AND user_id = ?')
  })
})

