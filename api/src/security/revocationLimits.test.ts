/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

const handles: DatabaseSync[] = []
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T12:00:00Z'))
})
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function fixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(
    "INSERT INTO users (id,email,provider,provider_id) VALUES ('member','member@example.com','google','1')",
  )
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    BASE_URL: 'https://api.example.com',
    FRONTEND_URL: 'https://example.com',
  } as Env
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext
  const sign = () =>
    signJwt(
      { sub: 'member', email: 'member@example.com', jti: crypto.randomUUID() },
      env.JWT_SECRET,
      3600,
    )
  const call = (path: string, token = '', method = 'POST', ip = '192.0.2.1') =>
    worker.fetch(
      new Request(`${env.BASE_URL}${path}`, {
        method,
        headers: {
          Cookie: `session=${token}`,
          Origin: env.FRONTEND_URL,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': ip,
        },
        ...(method === 'PUT' ? { body: '{}' } : {}),
      }),
      env,
      ctx,
    )
  const flood = async (token = '', remaining = 60) => {
    for (let i = 0; i < remaining; i++) {
      expect((await call('/predictions', token, 'PUT')).status).toBe(token ? 400 : 401)
    }
    expect((await call('/predictions', token, 'PUT')).status).toBe(429)
  }
  return { sqlite, env, sign, call, flood }
}

const ROUTES = ['/auth/logout', '/auth/logout-all']

describe('limite próprio de revogação pela API inteira', () => {
  it('logout-all revoga o token A mesmo depois de A esgotar as escritas da conta', async () => {
    const { sign, call, flood } = await fixture()
    const tokenA = await sign()
    const tokenB = await sign()
    await flood(tokenA)
    expect((await call('/auth/logout-all', tokenB, 'POST', '192.0.2.2')).status).toBe(200)
    expect((await call('/notifications/preferences', tokenA, 'GET')).status).toBe(401)
    expect((await call('/notifications/preferences', tokenB, 'GET')).status).toBe(401)
  })

  it('logout revoga o mesmo token com as escritas da conta esgotadas', async () => {
    const { sign, call, flood } = await fixture()
    const token = await sign()
    await flood(token)
    expect((await call('/auth/logout', token)).status).toBe(200)
    expect((await call('/notifications/preferences', token, 'GET')).status).toBe(401)
  })

  it.each(ROUTES)(
    '%s limita a 10 tentativas por token e libera na próxima janela',
    async (route) => {
      const { sqlite, sign, call } = await fixture()
      // A falha de armazenamento mantém a sessão válida para as novas tentativas.
      sqlite.exec(`
      CREATE TRIGGER falha_logout BEFORE INSERT ON revoked_sessions
      BEGIN SELECT RAISE(FAIL, 'falha simulada'); END;
      CREATE TRIGGER falha_logout_all BEFORE UPDATE OF sessions_valid_after ON users
      BEGIN SELECT RAISE(FAIL, 'falha simulada'); END;
    `)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const tokenA = await sign()
      const tokenB = await sign()
      for (let i = 0; i < 10; i++) expect((await call(route, tokenA)).status).toBe(503)
      const blocked = await call(route, tokenA, 'POST', '192.0.2.2')
      expect(blocked.status).toBe(429)
      expect(blocked.headers.get('Retry-After')).toBe('60')
      // As duas rotas compartilham o teto, e outro token da conta tem saldo próprio.
      expect(
        (
          await call(
            ROUTES.find((path) => path !== route)!,
            tokenA,
          )
        ).status,
      ).toBe(429)
      expect((await call(route, tokenB)).status).toBe(503)
      expect((await call('/predictions', tokenA, 'PUT')).status).toBe(400)
      vi.setSystemTime(new Date('2026-10-06T12:01:00Z'))
      expect((await call(route, tokenA)).status).toBe(503)
    },
  )

  it.each(ROUTES.flatMap((route) => ['', 'invalido'].map((token) => [route, token])))(
    '%s com token "%s" continua no balde anônimo por IP',
    async (route, token) => {
      const { call, flood } = await fixture()
      await flood()
      expect((await call(route, token)).status).toBe(429)
      expect((await call(route, token, 'POST', '192.0.2.2')).status).toBe(
        route.endsWith('-all') ? 401 : 200,
      )
    },
  )

  it('token revogado volta ao balde anônimo', async () => {
    const { sign, call, flood } = await fixture()
    const token = await sign()
    expect((await call('/auth/logout', token)).status).toBe(200)
    await flood()
    expect((await call('/auth/logout', token)).status).toBe(429)
  })

  it.each(ROUTES.flatMap((route) => [route + '/', route.toUpperCase(), route + '-extra']))(
    '%s permanece no balde de escrita e não recebe a categoria própria',
    async (path) => {
      const { sign, call, flood } = await fixture()
      const token = await sign()
      expect((await call(path, token)).status).toBe(404)
      await flood(token, 59)
      expect((await call(path, token)).status).toBe(429)
    },
  )
})
