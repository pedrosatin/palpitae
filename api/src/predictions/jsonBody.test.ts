import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

async function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(
    `INSERT INTO users (id,email,provider,provider_id) VALUES ('u','u@example.com','google','u')`,
  )
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FRONTEND_WORKER_ZONE: 'palpitae-web.pages.dev',
  } as Env
  const token = await signJwt(
    { sub: 'u', email: 'u@example.com', jti: crypto.randomUUID() },
    env.JWT_SECRET,
    3600,
  )
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext
  return (method: string, path: string, rawBody: string) =>
    worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        method,
        headers: {
          Cookie: `session=${token}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.1',
        },
        body: rawBody,
      }),
      env,
      ctx,
    )
}

const ROUTES = [
  ['PUT', '/predictions'],
  ['PUT', '/predictions/bulk'],
  ['POST', '/predictions/import'],
  ['POST', '/predictions/replicate'],
] as const

const NOT_AN_OBJECT = [
  ['null', 'null'],
  ['um array', '[]'],
  ['um número', '42'],
  ['JSON malformado', '{'],
] as const

describe('corpo JSON que não é objeto nas rotas de palpites', () => {
  for (const [method, path] of ROUTES) {
    for (const [label, rawBody] of NOT_AN_OBJECT) {
      it(`${method} ${path} responde 400 para ${label}`, async () => {
        const request = await setup()
        const response = await request(method, path, rawBody)
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Body JSON inválido' })
      })
    }
  }
})
