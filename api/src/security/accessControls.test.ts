/// <reference types="node" />
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { verifySession } from '../auth/session'
import { getGroupMembership } from '../groups/membership'
import { clearExpiredSecurityRecords, consumeLimit } from './limits'
import type { Env } from '../types'

// Exercise the production SQL against SQLite, including constraints and batches.
function database() {
  const sqlite = new DatabaseSync(':memory:')
  const migrations = new URL('../../migrations/', import.meta.url)
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'))
  }
  function prepare(sql: string, values: SQLInputValue[] = []) {
    return {
      bind(...args: SQLInputValue[]) {
        return prepare(sql, args)
      },
      async first() {
        return sqlite.prepare(sql).get(...values) ?? null
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values), success: true }
      },
      async run() {
        const result = sqlite.prepare(sql).run(...values)
        return { success: true, meta: { changes: Number(result.changes) } }
      },
    }
  }
  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.all())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES
      ('owner','owner@example.com','google','1'),
      ('member','member@example.com','google','2'),
      ('other','other@example.com','google','3');
    INSERT INTO profiles (user_id,nickname) VALUES ('owner','Owner'),('member','Member'),('other','Other');
    INSERT INTO competitions (id,name,slug,status,penalty_phases) VALUES ('competition','League','test-league','ongoing','[]');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code)
      VALUES ('group','Private group','competition','owner','ABCD-EFGH');
    INSERT INTO group_members (id,group_id,user_id,role) VALUES
      ('gm1','group','owner','owner'),('gm2','group','member','member'),('gm3','group','other','member');
    INSERT INTO teams (id,name,slug) VALUES ('home','Home','home'),('away','Away','away');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status)
      VALUES ('future','competition','1','football-data','home','away','2099-01-01T00:00:00Z','scheduled'),
             ('past','competition','2','football-data','home','away','2020-01-01T00:00:00Z','finished');
    INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
      VALUES ('p1','member','group','future',1,0),('p2','other','group','future',2,0),
             ('p3','other','group','past',3,0);
  `)
  return { sqlite, db }
}

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

async function fixture() {
  const { sqlite, db } = database()
  handles.push(sqlite)
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
  } as Env
  const tokens = Object.fromEntries(
    await Promise.all(
      ['owner', 'member', 'other'].map(async (id) => [
        id,
        await signJwt(
          { sub: id, email: `${id}@example.com`, jti: crypto.randomUUID() },
          env.JWT_SECRET,
          3600,
        ),
      ]),
    ),
  )
  const waitUntil = vi.fn()
  const ctx = {
    waitUntil,
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext
  const request = (path: string, user = 'member', method = 'GET', body?: unknown) =>
    worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        method,
        headers: {
          Cookie: `session=${tokens[user]}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.1',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      ctx,
    )
  return { sqlite, db, env, tokens, request, ctx, waitUntil }
}

describe('access controls with a real SQL database', () => {
  it('does not reveal editable picks after the requester submitted, and preserves own editing', async () => {
    const { request } = await fixture()
    const response = await request('/predictions/group?group_id=group')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { predictions: { user_id: string; match_id: string }[] }
    expect(body.predictions.map((p) => `${p.user_id}:${p.match_id}`).sort()).toEqual([
      'member:future',
      'other:past',
    ])
    const edit = await request('/predictions', 'member', 'PUT', {
      group_id: 'group',
      match_id: 'future',
      predicted_home_score: 5,
      predicted_away_score: 1,
    })
    expect(edit.status).toBe(200)
    const own = await request('/predictions?group_id=group&match_id=future')
    expect(
      ((await own.json()) as { predictions: { predicted_home_score: number }[] }).predictions[0]
        .predicted_home_score,
    ).toBe(5)
  })

  it('reveals all picks in public groups and locks live picks even with future kickoff', async () => {
    const { request, sqlite } = await fixture()
    sqlite.exec("UPDATE groups SET predictions_visibility = 'public'")
    const response = await request('/predictions/group?group_id=group')
    expect(((await response.json()) as { predictions: unknown[] }).predictions).toHaveLength(3)
    sqlite.exec("UPDATE matches SET status = 'live' WHERE id = 'future'")
    const edit = await request('/predictions', 'member', 'PUT', {
      group_id: 'group',
      match_id: 'future',
      predicted_home_score: 5,
      predicted_away_score: 1,
    })
    expect(edit.status).toBe(422)
  })

  it('returns the invite only to the owner', async () => {
    const { request } = await fixture()
    expect(
      ((await (await request('/groups/group')).json()) as { group: { invite_code: string | null } })
        .group.invite_code,
    ).toBeNull()
    expect(
      (
        (await (await request('/groups/group', 'owner')).json()) as {
          group: { invite_code: string }
        }
      ).group.invite_code,
    ).toBe('ABCD-EFGH')
  })

  it('revokes only group access on removal, including reuse of the saved invite', async () => {
    const { request, db } = await fixture()
    expect((await request('/groups/group/members/member', 'owner', 'DELETE')).status).toBe(200)
    expect(await getGroupMembership(db, 'group', 'member')).toBeNull()
    expect(
      (await request('/groups/join', 'member', 'POST', { invite_code: 'ABCD-EFGH' })).status,
    ).toBe(403)
    expect((await request('/auth/me')).status).toBe(200)
    expect((await request('/predictions/group?group_id=group')).status).toBe(403)
  })

  it('allows a member who leaves voluntarily to rejoin', async () => {
    const { request } = await fixture()
    expect((await request('/groups/group/members/member', 'member', 'DELETE')).status).toBe(200)
    expect(
      (await request('/groups/join', 'member', 'POST', { invite_code: 'ABCD-EFGH' })).status,
    ).toBe(200)
  })

  it('rejects all group reads and writes after soft deletion', async () => {
    const { request } = await fixture()
    expect((await request('/groups/group', 'owner', 'DELETE')).status).toBe(200)
    for (const path of [
      '/groups/group',
      '/groups/group/members',
      '/predictions?group_id=group',
      '/predictions/group?group_id=group',
      '/predictions/user?group_id=group&user_id=other',
    ]) {
      expect([403, 404]).toContain((await request(path)).status)
    }
    for (const path of ['/predictions', '/predictions/bulk']) {
      const prediction = { match_id: 'future', predicted_home_score: 1, predicted_away_score: 0 }
      expect(
        (
          await request(
            path,
            'member',
            'PUT',
            path.endsWith('bulk')
              ? { group_id: 'group', predictions: [prediction] }
              : { group_id: 'group', ...prediction },
          )
        ).status,
      ).toBe(403)
    }
  })

  it('invalidates a copied session on logout and keeps another session valid', async () => {
    const { request, tokens, db, env } = await fixture()
    const secondToken = await signJwt(
      { sub: 'member', email: 'member@example.com', jti: crypto.randomUUID() },
      env.JWT_SECRET,
      3600,
    )
    expect((await request('/auth/logout', 'member', 'POST')).status).toBe(200)
    await expect(verifySession(tokens.member, env.JWT_SECRET, db)).rejects.toThrow(
      'Session revoked',
    )
    await expect(verifySession(secondToken, env.JWT_SECRET, db)).resolves.toHaveProperty(
      'sub',
      'member',
    )
    expect((await request('/groups')).status).toBe(401)
    expect(await (await request('/auth/me')).json()).toEqual({ authenticated: false })
  })

  it('canonicalizes the cache and never calls an external provider on GET', async () => {
    const { request, waitUntil } = await fixture()
    const match = vi.fn(async (_key: Request) => undefined)
    const put = vi.fn(async () => {})
    const fetch = vi.fn()
    vi.stubGlobal('caches', { default: { match, put } })
    vi.stubGlobal('fetch', fetch)
    expect((await request('/matches?competition_id=competition&noise=one')).status).toBe(200)
    expect((await request('/matches?noise=two&competition_id=competition')).status).toBe(200)
    expect(match.mock.calls.map(([key]) => (key as Request).url)).toEqual([
      'https://api.palpitae.com.br/matches?competition_id=competition',
      'https://api.palpitae.com.br/matches?competition_id=competition',
    ])
    await Promise.all(waitUntil.mock.calls.map(([promise]) => promise))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects oversized bodies before parsing and limits bulk before match lookup', async () => {
    const { request } = await fixture()
    expect(
      (await request('/predictions/bulk', 'member', 'PUT', { data: 'a'.repeat(65536) })).status,
    ).toBe(413)
    expect(
      (
        await request('/predictions/bulk', 'member', 'PUT', {
          group_id: 'group',
          predictions: Array.from({ length: 101 }, () => ({
            match_id: 'future',
            predicted_home_score: 1,
            predicted_away_score: 0,
          })),
        })
      ).status,
    ).toBe(400)
  })

  it('counts concurrent requests in shared storage and resets only at a new window', async () => {
    const { db } = await fixture()
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeLimit(db, 'shared-user', 5, 120)),
    )
    expect(results.filter(Boolean)).toHaveLength(5)
    expect(await consumeLimit(db, 'shared-user', 5, 179)).toBe(false)
    expect(await consumeLimit(db, 'shared-user', 5, 180)).toBe(true)
  })

  it('enforces IP quotas on public requests and fails closed when the table is unavailable', async () => {
    const { request, db, sqlite } = await fixture()
    await consumeLimit(db, 'read:ip:192.0.2.1', 0)
    const windowStart = Math.floor(Date.now() / 60000) * 60
    sqlite.prepare('UPDATE request_limits SET hits = 300 WHERE window_start = ?').run(windowStart)
    expect((await request('/public/invites/nope')).status).toBe(429)
    sqlite.exec('DROP TABLE request_limits')
    expect((await request('/public/invites/nope')).status).toBe(503)
    expect((await request('/health')).status).toBe(200)
  })

  it('fails closed on unavailable revocation storage and rejects a foreign Origin on writes', async () => {
    const { request, env, tokens, sqlite, ctx } = await fixture()
    const foreignRequest = new Request('https://api.palpitae.com.br/groups', {
      method: 'POST',
      headers: { Origin: 'https://untrusted.palpitae.com.br', Cookie: `session=${tokens.member}` },
      body: JSON.stringify({ name: 'Group', competition_id: 'competition' }),
    })
    expect((await worker.fetch(foreignRequest, env, ctx)).status).toBe(403)
    sqlite.exec('DROP TABLE revoked_sessions')
    expect((await request('/groups')).status).toBe(503)
    expect((await request('/auth/me')).status).toBe(503)
  })

  it('cleans expired counters and revocations during maintenance', async () => {
    const { db, sqlite } = await fixture()
    await consumeLimit(db, 'expired', 1, 0)
    sqlite.exec("INSERT INTO revoked_sessions VALUES ('expired',1)")
    await clearExpiredSecurityRecords(db)
    expect(sqlite.prepare('SELECT * FROM request_limits').all()).toEqual([])
    expect(sqlite.prepare('SELECT * FROM revoked_sessions').all()).toEqual([])
  })
})
