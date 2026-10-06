/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { verifySession } from '../auth/session'
import { getGroupMembership } from '../groups/membership'
import {
  bucketKey,
  CLIENT_IP_HEADER,
  clearExpiredSecurityRecords,
  consumeLimit,
  ipBucketIdentity,
  PROXY_SECRET_HEADER,
} from './limits'
import type { Env } from '../types'
import { createSqliteD1 } from '../testing/sqliteD1'

// Exercise the production SQL against SQLite, including constraints and batches.
function database() {
  const { sqlite, db } = createSqliteD1()
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
  const anonymous = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    worker.fetch(new Request(`https://api.palpitae.com.br${path}`, { method, headers }), env, ctx)
  // Hits already counted for an identity in the current window.
  const hits = async (identity: string) => {
    const row = sqlite
      .prepare('SELECT hits FROM request_limits WHERE bucket_key = ?')
      .get(await bucketKey(env.JWT_SECRET, identity)) as { hits: number } | undefined
    return row?.hits ?? 0
  }
  // Fills an identity's bucket up to its limit for the current window.
  const exhaust = async (identity: string, limit: number) => {
    await consumeLimit(db, await bucketKey(env.JWT_SECRET, identity), limit)
    sqlite
      .prepare('UPDATE request_limits SET hits = ? WHERE bucket_key = ?')
      .run(limit, await bucketKey(env.JWT_SECRET, identity))
  }
  return { sqlite, db, env, tokens, request, anonymous, hits, exhaust, ctx, waitUntil }
}

const WORKER_SUBREQUEST = {
  'CF-Worker': 'palpitae.com.br',
  'CF-Connecting-IP': '2a06:98c0:3600::103',
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

  it('blocks importing picks from a group the member was removed from', async () => {
    const { request, sqlite } = await fixture()
    sqlite.exec(`
      INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code)
        VALUES ('group2','Second group','competition','member','WXYZ-1234');
      INSERT INTO group_members (id,group_id,user_id,role) VALUES ('gm4','group2','member','owner');
    `)
    const body = { source_group_id: 'group', target_group_id: 'group2' }
    expect((await request('/predictions/import', 'member', 'POST', body)).status).toBe(200)
    expect((await request('/groups/group/members/member', 'owner', 'DELETE')).status).toBe(200)
    // A stale membership row must not reopen access while the ban exists.
    sqlite.exec(
      "INSERT INTO group_members (id,group_id,user_id,role) VALUES ('gm5','group','member','member')",
    )
    expect((await request('/predictions/import', 'member', 'POST', body)).status).toBe(403)
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

  it('enforces IP quotas on anonymous requests and fails open only for reads', async () => {
    const { anonymous, exhaust, sqlite } = await fixture()
    await exhaust('read:ip:192.0.2.1', 300)
    expect(
      (await anonymous('/public/invites/nope', { 'CF-Connecting-IP': '192.0.2.1' })).status,
    ).toBe(429)
    sqlite.exec('DROP TABLE request_limits')
    expect(
      (await anonymous('/public/invites/nope', { 'CF-Connecting-IP': '192.0.2.1' })).status,
    ).toBe(404)
    expect(
      (await anonymous('/groups/join', { 'CF-Connecting-IP': '192.0.2.1' }, 'POST')).status,
    ).toBe(503)
    expect((await anonymous('/auth/google', { 'CF-Connecting-IP': '192.0.2.1' })).status).toBe(503)
    expect((await anonymous('/health')).status).toBe(200)
  })

  it('limits an authenticated request only by user, never by IP', async () => {
    const { request, anonymous, exhaust, hits } = await fixture()
    await exhaust('read:ip:192.0.2.1', 300)
    expect((await request('/groups')).status).toBe(200)
    expect(await hits('read:user:member')).toBe(1)
    expect(await hits('read:ip:192.0.2.1')).toBe(300)
    expect(
      (await anonymous('/public/invites/nope', { 'CF-Connecting-IP': '192.0.2.1' })).status,
    ).toBe(429)
    await exhaust('read:user:member', 300)
    expect((await request('/groups')).status).toBe(429)
  })

  it('uses the visitor IP forwarded by the proxy when the shared secret matches', async () => {
    const { anonymous, env, exhaust, hits } = await fixture()
    env.PROXY_SHARED_SECRET = 'proxy-secret'
    const viaProxy = (ip: string) =>
      anonymous('/public/invites/nope', {
        ...WORKER_SUBREQUEST,
        [CLIENT_IP_HEADER]: ip,
        [PROXY_SECRET_HEADER]: 'proxy-secret',
      })
    await exhaust('read:ip:198.51.100.7', 300)
    expect((await viaProxy('198.51.100.7')).status).toBe(429)
    expect((await viaProxy('198.51.100.8')).status).toBe(404)
    expect(await hits('read:ip:198.51.100.8')).toBe(1)
    expect(await hits('read:proxy:anonymous:frontend')).toBe(0)
  })

  it('ignores a forged client IP header without the shared secret', async () => {
    const { anonymous, env, exhaust, hits } = await fixture()
    await exhaust('read:ip:198.51.100.7', 300)
    const forged = { [CLIENT_IP_HEADER]: '198.51.100.7', [PROXY_SECRET_HEADER]: 'guess' }
    // Direct access: the forged header is ignored and CF-Connecting-IP counts.
    const direct = await anonymous('/public/invites/nope', {
      ...forged,
      'CF-Connecting-IP': '192.0.2.50',
    })
    expect(direct.status).toBe(404)
    expect(await hits('read:ip:192.0.2.50')).toBe(1)
    // Through a Worker with a wrong secret: shared anonymous bucket with the higher cap.
    env.PROXY_SHARED_SECRET = 'proxy-secret'
    expect(
      (await anonymous('/public/invites/nope', { ...WORKER_SUBREQUEST, ...forged })).status,
    ).toBe(404)
    expect(await hits('read:proxy:anonymous:frontend')).toBe(1)
    await exhaust('read:proxy:anonymous:frontend', 3000)
    expect(
      (await anonymous('/public/invites/nope', { ...WORKER_SUBREQUEST, ...forged })).status,
    ).toBe(429)
    expect(await hits('read:ip:198.51.100.7')).toBe(300)
  })

  it('checks session revocation once per request', async () => {
    const { request, sqlite } = await fixture()
    const prepare = vi.spyOn(sqlite, 'prepare')
    expect((await request('/groups')).status).toBe(200)
    const revocationReads = prepare.mock.calls.filter(([sql]) => sql.includes('revoked_sessions'))
    expect(revocationReads).toHaveLength(1)
  })

  it('clears the cookie on logout even when revocation storage fails', async () => {
    const { request, sqlite } = await fixture()
    sqlite.exec('DROP TABLE revoked_sessions')
    const response = await request('/auth/logout', 'member', 'POST')
    expect(response.status).toBe(503)
    expect(response.headers.get('Set-Cookie')).toMatch(/session=;.*Max-Age=0/)
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

describe('follow-up security controls with a real SQL database', () => {
  const pick = (score: number) => ({
    group_id: 'group',
    match_id: 'future',
    predicted_home_score: score,
    predicted_away_score: 0,
  })

  it('keeps a pick locked once the sync saw the match started, even if postponed later', async () => {
    const { request, sqlite } = await fixture()
    sqlite.exec(
      "UPDATE matches SET start_time = '2020-06-01T00:00:00Z', status = 'scheduled', postponed = 1 WHERE id = 'future'",
    )
    // Adiado sem ter começado: segue aberto.
    expect((await request('/predictions', 'member', 'PUT', pick(2))).status).toBe(200)
    // O sync viu o jogo iniciado: travado para sempre, mesmo adiado e com horário futuro.
    sqlite.exec(
      "UPDATE matches SET locked_at = '2020-06-01T00:10:00Z', start_time = '2099-01-01T00:00:00Z' WHERE id = 'future'",
    )
    expect((await request('/predictions', 'member', 'PUT', pick(3))).status).toBe(422)
    const bulk = await request('/predictions/bulk', 'member', 'PUT', {
      group_id: 'group',
      predictions: [{ match_id: 'future', predicted_home_score: 4, predicted_away_score: 0 }],
    })
    expect(((await bulk.json()) as { locked: string[] }).locked).toEqual(['future'])
    // E os palpites dos outros continuam revelados no grupo oculto.
    const feed = await request('/predictions/group?group_id=group')
    const body = (await feed.json()) as { predictions: { user_id: string; match_id: string }[] }
    expect(body.predictions.map((p) => `${p.user_id}:${p.match_id}`)).toContain('other:future')
  })

  it('caps predicted scores at 99', async () => {
    const { request } = await fixture()
    expect((await request('/predictions', 'member', 'PUT', pick(99))).status).toBe(200)
    expect((await request('/predictions', 'member', 'PUT', pick(100))).status).toBe(400)
    const bulk = await request('/predictions/bulk', 'member', 'PUT', {
      group_id: 'group',
      predictions: [{ match_id: 'future', predicted_home_score: 1000, predicted_away_score: 0 }],
    })
    expect(bulk.status).toBe(400)
  })

  it('drops picks of removed members from the group feed', async () => {
    const { request } = await fixture()
    expect((await request('/groups/group/members/other', 'owner', 'DELETE')).status).toBe(200)
    const feed = await request('/predictions/group?group_id=group', 'owner')
    const body = (await feed.json()) as { predictions: { user_id: string }[] }
    expect(body.predictions.map((p) => p.user_id)).not.toContain('other')
  })

  it('lets only the owner rotate the invite and invalidates the old code', async () => {
    const { request, sqlite } = await fixture()
    expect((await request('/groups/group/invite/rotate', 'member', 'POST')).status).toBe(403)
    expect((await request('/groups/nope/invite/rotate', 'owner', 'POST')).status).toBe(404)

    const rotated = await request('/groups/group/invite/rotate', 'owner', 'POST')
    expect(rotated.status).toBe(200)
    const { invite_code } = (await rotated.json()) as { invite_code: string }
    expect(invite_code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(invite_code).not.toBe('ABCD-EFGH')
    expect(
      (
        sqlite.prepare("SELECT invite_code FROM groups WHERE id = 'group'").get() as {
          invite_code: string
        }
      ).invite_code,
    ).toBe(invite_code)

    // Members stay; the old code no longer admits anyone.
    expect((await request('/groups/group')).status).toBe(200)
    expect((await request('/groups/group/members/member', 'member', 'DELETE')).status).toBe(200)
    expect(
      (await request('/groups/join', 'member', 'POST', { invite_code: 'ABCD-EFGH' })).status,
    ).toBe(404)
    expect((await request('/groups/join', 'member', 'POST', { invite_code })).status).toBe(200)
  })

  it('handles an invite code collision on rotation instead of failing with an unhandled error', async () => {
    const { request, env, db } = await fixture()
    let failures = 1
    const collide = (sql: string) =>
      sql.startsWith('UPDATE groups SET invite_code') && failures-- > 0
    env.DB = {
      ...db,
      prepare(sql: string) {
        const statement = db.prepare(sql)
        if (!sql.startsWith('UPDATE groups SET invite_code')) return statement
        return {
          bind(...args: unknown[]) {
            const bound = statement.bind(...args)
            return {
              ...bound,
              async run() {
                if (collide(sql))
                  throw new Error('D1_ERROR: UNIQUE constraint failed: groups.invite_code')
                return bound.run()
              },
            }
          },
        }
      },
    } as unknown as D1Database
    expect((await request('/groups/group/invite/rotate', 'owner', 'POST')).status).toBe(200)

    failures = 10
    const exhausted = await request('/groups/group/invite/rotate', 'owner', 'POST')
    expect(exhausted.status).toBe(503)
    expect(await exhausted.json()).toEqual({ error: 'Erro interno ao gerar convite' })
  })

  it('never lets concurrent joins exceed the member cap', async () => {
    const { request, sqlite, tokens, env } = await fixture()
    sqlite.exec(`
      INSERT INTO users (id,email,provider,provider_id) VALUES
        ('new1','new1@example.com','google','4'),('new2','new2@example.com','google','5');
      UPDATE groups SET max_members = 4 WHERE id = 'group';
    `)
    for (const id of ['new1', 'new2']) {
      tokens[id] = await signJwt(
        { sub: id, email: `${id}@example.com`, jti: crypto.randomUUID() },
        env.JWT_SECRET,
        3600,
      )
    }
    const statuses = await Promise.all(
      ['new1', 'new2'].map(
        async (id) =>
          (await request('/groups/join', id, 'POST', { invite_code: 'ABCD-EFGH' })).status,
      ),
    )
    expect(statuses.sort()).toEqual([200, 409])
    expect(
      (
        sqlite
          .prepare("SELECT COUNT(*) AS n FROM group_members WHERE group_id = 'group'")
          .get() as {
          n: number
        }
      ).n,
    ).toBe(4)
  })

  it('does not write to the database once a bucket is full', async () => {
    const { db, sqlite } = await fixture()
    const changes = () => (sqlite.prepare('SELECT total_changes() AS n').get() as { n: number }).n
    expect(await consumeLimit(db, 'full', 2, 120)).toBe(true)
    expect(await consumeLimit(db, 'full', 2, 120)).toBe(true)
    const before = changes()
    for (let i = 0; i < 5; i++) expect(await consumeLimit(db, 'full', 2, 130)).toBe(false)
    expect(changes()).toBe(before)
    expect(
      (
        sqlite.prepare("SELECT hits FROM request_limits WHERE bucket_key = 'full'").get() as {
          hits: number
        }
      ).hits,
    ).toBe(2)
    // A new window writes again.
    expect(await consumeLimit(db, 'full', 2, 180)).toBe(true)
    expect(changes()).toBe(before + 1)
  })

  it('groups IPv6 clients by /64', async () => {
    expect(ipBucketIdentity('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64')
    expect(ipBucketIdentity('2001:0DB8:0001:0002::1')).toBe('2001:db8:1:2::/64')
    expect(ipBucketIdentity('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(ipBucketIdentity('::ffff:192.0.2.9')).toBe('192.0.2.9')
    expect(ipBucketIdentity('192.0.2.9')).toBe('192.0.2.9')
    expect(ipBucketIdentity('not-an-ip')).toBe('not-an-ip')

    const { anonymous, exhaust, hits } = await fixture()
    await exhaust('read:ip:2001:db8:1:2::/64', 300)
    expect(
      (await anonymous('/public/invites/nope', { 'CF-Connecting-IP': '2001:db8:1:2::9999' }))
        .status,
    ).toBe(429)
    expect(
      (await anonymous('/public/invites/nope', { 'CF-Connecting-IP': '2001:db8:1:3::1' })).status,
    ).toBe(404)
    expect(await hits('read:ip:2001:db8:1:3::/64')).toBe(1)
  })

  it('keeps third-party Workers out of the frontend shared bucket', async () => {
    const { anonymous, exhaust, hits } = await fixture()
    const thirdParty = {
      'CF-Worker': 'attacker.example',
      'CF-Connecting-IP': '2a06:98c0:3600::103',
    }
    await exhaust('read:proxy:anonymous:worker', 3000)
    expect((await anonymous('/public/invites/nope', thirdParty)).status).toBe(429)
    expect((await anonymous('/public/invites/nope', WORKER_SUBREQUEST)).status).toBe(404)
    expect(await hits('read:proxy:anonymous:frontend')).toBe(1)
  })
})
