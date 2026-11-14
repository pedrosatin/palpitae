/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { bucketKey, consumeLimit } from './limits'
import type { Env } from '../types'
import { createSqliteD1 } from '../testing/sqliteD1'

const PRIVATE_NO_STORE = 'private, no-store'

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

// A API inteira sobre SQLite em memória, com a sessão assinada como no login.
async function fixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES ('member','member@example.com','google','1');
    INSERT INTO profiles (user_id,nickname) VALUES ('member','Member');
    INSERT INTO competitions (id,name,slug,status,penalty_phases) VALUES ('competition','League','test-league','ongoing','[]');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code)
      VALUES ('group','Private group','competition','member','ABCD-EFGH');
    INSERT INTO group_members (id,group_id,user_id,role) VALUES ('gm1','group','member','owner');
    INSERT INTO teams (id,name,slug) VALUES ('home','Home','home'),('away','Away','away');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,home_score,away_score)
      VALUES ('future','competition','1','football-data','home','away','2099-01-01T00:00:00Z','scheduled','1',NULL,NULL);
  `)
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FRONTEND_WORKER_ZONE: 'palpitae-web.pages.dev',
    FOOTBALL_API_KEY: 'test-key',
  } as Env
  const token = await signJwt(
    { sub: 'member', email: 'member@example.com', jti: crypto.randomUUID() },
    env.JWT_SECRET,
    3600,
  )
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext
  const call = (path: string, init: RequestInit = {}, session = true) =>
    worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        ...init,
        headers: {
          'CF-Connecting-IP': '192.0.2.1',
          ...(session ? { Cookie: `session=${token}` } : {}),
          ...init.headers,
        },
      }),
      env,
      ctx,
    )
  const exhaust = async (identity: string, limit: number) => {
    const key = await bucketKey(env.JWT_SECRET, identity)
    await consumeLimit(db, key, limit)
    sqlite.prepare('UPDATE request_limits SET hits = ? WHERE bucket_key = ?').run(limit, key)
  }
  return { call, exhaust }
}

describe('Cache-Control da API', () => {
  it.each([
    '/auth/me',
    '/groups/group',
    '/predictions/group?group_id=group',
    '/notifications/preferences',
  ])('%s com sessão sai com private, no-store', async (path) => {
    const { call } = await fixture()
    const response = await call(path)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE)
  })

  it('a lista de jogos mantém o cache curto, só do navegador', async () => {
    const { call } = await fixture()
    const response = await call('/matches?competition_id=competition')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=60')
  })

  it('as rotas públicas mantêm o cache público da rota', async () => {
    const { call } = await fixture()
    const competitions = await call('/public/competitions', {}, false)
    expect(competitions.status).toBe(200)
    expect(competitions.headers.get('Cache-Control')).toBe('public, max-age=300')
    const missing = await call('/public/invites/ZZZZ-ZZZZ', {}, false)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('Cache-Control')).toBe('public, max-age=60')
  })

  it('respostas de middlewares e de erro também saem com private, no-store', async () => {
    const { call, exhaust } = await fixture()

    const unauthenticated = await call('/groups', {}, false)
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE)

    const notFound = await call('/rota-que-nao-existe')
    expect(notFound.status).toBe(404)
    expect(notFound.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE)

    const tooLarge = await call('/predictions', {
      method: 'PUT',
      body: 'x'.repeat(65 * 1024),
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(65 * 1024) },
    })
    expect(tooLarge.status).toBe(413)
    expect(tooLarge.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE)

    await exhaust('read:user:member', 300)
    const limited = await call('/groups')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE)
  })
})
