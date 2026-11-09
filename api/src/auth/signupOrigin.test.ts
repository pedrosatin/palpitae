/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { AppContext, Env } from '../types'
import * as googleAuth from './google'
import { authRouter } from './router'

vi.mock('./google', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./google')>()
  return { ...mod, exchangeCode: vi.fn(), verifyGoogleIdToken: vi.fn() }
})

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.restoreAllMocks()
})

interface Point {
  indexes: string[]
  blobs: string[]
}

function harness() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const points: Point[] = []
  const env = {
    JWT_SECRET: 'test-secret-signup-origin',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'http://localhost:8787',
    FRONTEND_URL: 'http://localhost:5173',
    DB: db,
    AE: { writeDataPoint: (point: Point) => points.push(point) },
  } as unknown as Env
  const app = new Hono<AppContext>()
  app.route('/auth', authRouter)

  async function start(query = '') {
    const res = await app.request(`/auth/google${query}`, {}, env)
    const setCookies = res.headers.getSetCookie()
    return {
      setCookies,
      cookies: setCookies.map((cookie) => cookie.split(';')[0]).join('; '),
      state: new URL(res.headers.get('Location') ?? '').searchParams.get('state') ?? '',
    }
  }

  function callback(flow: { cookies: string; state: string }) {
    return app.request(
      `/auth/callback?state=${encodeURIComponent(flow.state)}&code=abc`,
      { headers: { Cookie: flow.cookies } },
      env,
    )
  }

  const created = () => points.filter((point) => point.indexes[0] === 'account_created')
  return { sqlite, db, env, start, callback, created, points }
}

function signInAs(sub: string, email = `${sub}@example.com`) {
  vi.mocked(googleAuth.verifyGoogleIdToken).mockResolvedValue({
    sub,
    email,
    email_verified: true,
    name: 'Pessoa Teste',
    picture: 'https://example.com/foto.jpg',
  })
}

beforeEach(() => {
  vi.mocked(googleAuth.exchangeCode).mockResolvedValue({
    id_token: 'id-token',
    access_token: 'access-token',
  })
  signInAs('google-1')
})

describe('registro da origem do cadastro', () => {
  it.each([
    ['?origem=convite', 'convite', ''],
    ['?origem=busca', 'busca', ''],
    ['?origem=direto', 'direto', ''],
    ['?origem=guia_planilha-de-bolao', 'guia', 'planilha-de-bolao'],
    ['?origem=guia_planilha-de-bolao_header', 'guia', 'planilha-de-bolao'],
    ['?origem=guias_header', 'guia', ''],
  ])('conta nova em %s gera um único evento com a categoria', async (query, category, slug) => {
    const h = harness()
    const res = await h.callback(await h.start(query))

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('http://localhost:5173')
    expect(h.created()).toEqual([
      {
        indexes: ['account_created'],
        blobs: ['account_created', category, slug],
        doubles: [],
      },
    ])
  })

  it('não grava dado pessoal, id de usuário nem URL no evento', async () => {
    const h = harness()
    signInAs('google-privado', 'pessoa.privada@example.com')
    await h.callback(await h.start('?origem=busca'))

    const user = h.sqlite.prepare('SELECT id FROM users').get() as { id: string }
    const serialized = JSON.stringify(h.created())
    for (const secret of [
      user.id,
      'pessoa.privada',
      'google-privado',
      'Pessoa Teste',
      'http',
      'foto',
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('login de conta existente não gera o evento', async () => {
    const h = harness()
    await h.callback(await h.start('?origem=busca'))
    expect(h.created()).toHaveLength(1)

    const res = await h.callback(await h.start('?origem=convite'))

    expect(res.status).toBe(302)
    expect(res.headers.getSetCookie().some((c) => c.startsWith('session='))).toBe(true)
    expect(h.created()).toHaveLength(1)
    expect(h.points.filter((p) => p.indexes[0] === 'login_success')).toHaveLength(2)
  })

  it('callback repetido com o mesmo fluxo gera o evento uma vez', async () => {
    const h = harness()
    const flow = await h.start('?origem=busca')

    await h.callback(flow)
    await h.callback(flow)

    expect(h.created()).toHaveLength(1)
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 })
  })

  it('callbacks simultâneos da mesma conta nova geram o evento uma vez e ambos entram', async () => {
    const h = harness()
    const [first, second] = await Promise.all([
      h.start('?origem=busca'),
      h.start('?origem=convite'),
    ])

    const responses = await Promise.all([h.callback(first), h.callback(second)])

    for (const res of responses) {
      expect(res.headers.get('Location')).toBe('http://localhost:5173')
    }
    expect(h.created()).toHaveLength(1)
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 })
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM profiles').get()).toEqual({ n: 1 })
  })

  it.each([
    '?origem=site-qualquer',
    '?origem=guia_nao-existe',
    '?origem=joao%40example.com',
    '?origem=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3Dbolao',
    '',
  ])('origem fora da lista (%s) vira desconhecida e não entra no cookie', async (query) => {
    const h = harness()
    const flow = await h.start(query)

    expect(flow.setCookies.some((c) => c.startsWith('oauth_origin=;'))).toBe(true)

    await h.callback(flow)

    expect(h.created()[0]?.blobs).toEqual(['account_created', 'desconhecida', ''])
  })

  it('valida de novo o cookie adulterado no callback', async () => {
    const h = harness()
    const flow = await h.start('?origem=busca')

    await h.callback({
      ...flow,
      cookies: flow.cookies.replace('oauth_origin=busca', 'oauth_origin=joao@example.com'),
    })

    expect(h.created()[0]?.blobs).toEqual(['account_created', 'desconhecida', ''])
  })

  it('apaga o cookie de origem no callback', async () => {
    const h = harness()
    const res = await h.callback(await h.start('?origem=busca'))

    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('oauth_origin='))
    expect(cookie).toContain('Max-Age=0')
  })

  it('falha no Analytics Engine não bloqueia o cadastro nem o login', async () => {
    const h = harness()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.env.AE = {
      writeDataPoint: () => {
        throw new Error('AE fora do ar')
      },
    } as unknown as AnalyticsEngineDataset

    const res = await h.callback(await h.start('?origem=busca'))

    expect(res.headers.get('Location')).toBe('http://localhost:5173')
    expect(res.headers.getSetCookie().some((c) => c.startsWith('session='))).toBe(true)
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 })
    expect(consoleError).toHaveBeenCalled()
  })

  it('sem binding do Analytics Engine o cadastro segue normal', async () => {
    const h = harness()
    h.env.AE = undefined

    const res = await h.callback(await h.start('?origem=busca'))

    expect(res.headers.get('Location')).toBe('http://localhost:5173')
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 })
  })

  it('falha na troca do código não gera o evento', async () => {
    const h = harness()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(googleAuth.exchangeCode).mockRejectedValue(new Error('invalid_grant'))

    const res = await h.callback(await h.start('?origem=busca'))

    expect(res.headers.get('Location')).toContain('auth_error=exchange_failed')
    expect(h.created()).toHaveLength(0)
  })
})

describe('upsertUser', () => {
  const data = { email: 'a@example.com', providerId: 'g-1', provider: 'google', name: 'A' }

  function database() {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    return { sqlite, db }
  }

  it('marca como nova só a conta criada agora', async () => {
    const { db } = database()

    const first = await googleAuth.upsertUser(db, data)
    const second = await googleAuth.upsertUser(db, data)

    expect(first.isNew).toBe(true)
    expect(second).toEqual({ id: first.id, email: data.email, isNew: false })
  })

  it('num INSERT simultâneo, um único chamador recebe isNew', async () => {
    const { sqlite, db } = database()

    const results = await Promise.all([
      googleAuth.upsertUser(db, data),
      googleAuth.upsertUser(db, data),
    ])

    expect(results.filter((result) => result.isNew)).toHaveLength(1)
    expect(results[0].id).toBe(results[1].id)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 })
  })

  it('mantém o erro quando o conflito é de outra conta com o mesmo e-mail', async () => {
    const { db } = database()
    await googleAuth.upsertUser(db, data)

    await expect(googleAuth.upsertUser(db, { ...data, providerId: 'g-2' })).rejects.toThrow()
  })
})
