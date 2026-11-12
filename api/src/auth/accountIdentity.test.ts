/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import * as googleAuth from './google'
import { signJwt, verifyJwt } from './jwt'

// A troca com o Google e a verificação do ID token são a fronteira externa; o
// cadastro (`upsertUser`) roda de verdade contra o SQLite com as migrations.
vi.mock('./google', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./google')>()
  return { ...mod, exchangeCode: vi.fn(), verifyGoogleIdToken: vi.fn() }
})

const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.mocked(googleAuth.exchangeCode).mockResolvedValue({
    id_token: 'id-token',
    access_token: 'access-token',
  })
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.clearAllMocks()
})

function fixture(envOverrides: Partial<Env> = {}) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES
      ('u1','antigo@example.com','google','g1'),
      ('u2','ocupado@example.com','google','g2');
    INSERT INTO profiles (user_id,nickname) VALUES ('u1','Um'),('u2','Dois');
    INSERT INTO competitions (id,name,slug,status,penalty_phases,visibility) VALUES
      ('publica','Liga','liga','ongoing','[]','public'),
      ('piloto','Piloto','piloto','ongoing','[]','pilot');
  `)
  const events: string[][] = []
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    AE: {
      writeDataPoint: (point: { blobs?: string[] }) => events.push(point.blobs ?? []),
    } as unknown as AnalyticsEngineDataset,
    ...envOverrides,
  } as Env
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext

  const callback = (google: { sub: string; email: string }) => {
    vi.mocked(googleAuth.verifyGoogleIdToken).mockResolvedValue({
      ...google,
      email_verified: true,
      name: 'Nome',
    })
    return worker.fetch(
      new Request('https://api.palpitae.com.br/auth/callback?state=s&code=c', {
        headers: { Cookie: 'oauth_state=s; oauth_nonce=n; oauth_verifier=v' },
      }),
      env,
      ctx,
    )
  }

  const tokenFor = (sub: string, email: string) =>
    signJwt({ sub, email, jti: crypto.randomUUID() }, env.JWT_SECRET, 3600)

  const request = (token: string, path: string, method = 'GET', body?: unknown) =>
    worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        method,
        headers: {
          Cookie: `session=${token}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.1',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      ctx,
    )

  const emailOf = (id: string) =>
    (
      sqlite.prepare('SELECT email FROM users WHERE id = ?').get(id) as
        | { email: string }
        | undefined
    )?.email

  return { sqlite, env, events, callback, tokenFor, request, emailOf }
}

function sessionToken(response: Response): string | undefined {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith('session='))
  return cookie?.match(/^session=([^;]+)/)?.[1]
}

describe('e-mail da conta Google no login', () => {
  it('atualiza o e-mail da conta existente, em minúsculas, e o JWT carrega o novo', async () => {
    const { callback, emailOf, env } = fixture()

    const response = await callback({ sub: 'g1', email: ' Novo.Email@Example.COM ' })

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('https://palpitae.com.br')
    expect(emailOf('u1')).toBe('novo.email@example.com')
    const token = sessionToken(response)
    expect(token).toBeDefined()
    const payload = await verifyJwt(token!, env.JWT_SECRET)
    expect(payload).toMatchObject({ sub: 'u1', email: 'novo.email@example.com' })
  })

  it('grava conta nova com e-mail normalizado', async () => {
    const { callback, sqlite } = fixture()

    const response = await callback({ sub: 'g3', email: 'Nova@Example.com' })

    expect(response.status).toBe(302)
    expect(sessionToken(response)).toBeDefined()
    expect(sqlite.prepare("SELECT email FROM users WHERE provider_id = 'g3'").get()).toEqual({
      email: 'nova@example.com',
    })
  })

  it.each([['ocupado@example.com'], ['Ocupado@Example.com']])(
    'recusa conta nova com e-mail já usado por outra conta (%s), sem criar conta nem sessão',
    async (email) => {
      const { callback, sqlite, events, emailOf } = fixture()

      const response = await callback({ sub: 'g3', email })

      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe(
        'https://palpitae.com.br?auth_error=email_conflict',
      )
      expect(sessionToken(response)).toBeUndefined()
      expect(sqlite.prepare("SELECT id FROM users WHERE provider_id = 'g3'").get()).toBeUndefined()
      expect(emailOf('u2')).toBe('ocupado@example.com')
      expect(events).toContainEqual(['login_failure', 'email_conflict'])
    },
  )

  it('recusa a troca para um e-mail de outra conta e não mexe em nenhuma das duas', async () => {
    const { callback, events, emailOf } = fixture()

    const response = await callback({ sub: 'g1', email: 'OCUPADO@example.com' })

    expect(response.headers.get('Location')).toBe(
      'https://palpitae.com.br?auth_error=email_conflict',
    )
    expect(sessionToken(response)).toBeUndefined()
    expect(emailOf('u1')).toBe('antigo@example.com')
    expect(emailOf('u2')).toBe('ocupado@example.com')
    expect(events).toContainEqual(['login_failure', 'email_conflict'])
  })
})

describe('sessão de usuário apagado', () => {
  it('recusa leitura e escrita com 401 depois que o usuário some', async () => {
    const { sqlite, tokenFor, request } = fixture()
    const token = await tokenFor('u1', 'antigo@example.com')
    expect((await request(token, '/groups')).status).toBe(200)

    sqlite.exec("DELETE FROM users WHERE id = 'u1'")

    expect((await request(token, '/groups')).status).toBe(401)
    expect((await request(token, '/notifications/preferences')).status).toBe(401)
    const write = await request(token, '/groups', 'POST', {
      name: 'Grupo',
      competition_id: 'publica',
    })
    expect(write.status).toBe(401)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM groups').get()).toEqual({ n: 0 })
  })

  it('/auth/me trata o token de usuário apagado como sessão ausente', async () => {
    const { sqlite, tokenFor, request } = fixture()
    const token = await tokenFor('u1', 'antigo@example.com')
    sqlite.exec("DELETE FROM users WHERE id = 'u1'")

    const response = await request(token, '/auth/me')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authenticated: false })
  })
})

/** A listagem de competições mostra o piloto da fixture? */
async function seesPilot(response: Response): Promise<boolean> {
  const { competitions } = (await response.json()) as { competitions: Array<{ slug: string }> }
  return competitions.some((c) => c.slug === 'piloto')
}

describe('permissões seguem o e-mail atual da conta', () => {
  it('token emitido antes da troca de e-mail perde o admin que o e-mail antigo dava', async () => {
    const { sqlite, tokenFor, request } = fixture({ ADMIN_EMAIL: 'antigo@example.com' })
    const token = await tokenFor('u1', 'antigo@example.com')
    sqlite.exec("UPDATE users SET email = 'novo@example.com' WHERE id = 'u1'")

    expect((await request(token, '/competitions/piloto/promote', 'POST')).status).toBe(403)
    expect(await seesPilot(await request(token, '/competitions'))).toBe(false)
  })

  it('token emitido antes da troca de e-mail ganha o acesso que o e-mail novo dá', async () => {
    const { sqlite, tokenFor, request } = fixture({ PILOT_EMAILS: 'novo@example.com' })
    const token = await tokenFor('u1', 'antigo@example.com')
    sqlite.exec("UPDATE users SET email = 'novo@example.com' WHERE id = 'u1'")

    expect(await seesPilot(await request(token, '/competitions'))).toBe(true)
  })
})

describe('ADMIN_EMAIL com espaço ou quebra de linha no fim', () => {
  it.each([['admin@example.com'], ['admin@example.com\n'], [' Admin@Example.com \n']])(
    'dá o mesmo resultado em métricas, sync manual, promoção e piloto (%j)',
    async (adminEmail) => {
      const { sqlite, tokenFor, request } = fixture({ ADMIN_EMAIL: adminEmail })
      sqlite.exec("UPDATE users SET email = 'admin@example.com' WHERE id = 'u1'")
      const token = await tokenFor('u1', 'admin@example.com')

      // Métricas: passa do gate de admin e para na configuração ausente da SQL API.
      expect((await request(token, '/metrics/overview')).status).toBe(503)
      // Sync manual: passa do gate e para na validação do corpo.
      expect((await request(token, '/matches/sync', 'POST', {})).status).toBe(400)
      expect((await request(token, '/competitions/piloto/promote', 'POST')).status).toBe(200)
      expect(await seesPilot(await request(token, '/competitions'))).toBe(true)
    },
  )

  it('não dá admin a quem não é o e-mail configurado', async () => {
    const { tokenFor, request } = fixture({ ADMIN_EMAIL: 'admin@example.com\n' })
    const token = await tokenFor('u1', 'antigo@example.com')

    expect((await request(token, '/metrics/overview')).status).toBe(403)
    expect((await request(token, '/matches/sync', 'POST', {})).status).toBe(403)
    expect((await request(token, '/competitions/piloto/promote', 'POST')).status).toBe(403)
  })
})
