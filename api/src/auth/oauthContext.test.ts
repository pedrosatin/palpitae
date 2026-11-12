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

const FRONTEND_URL = 'http://localhost:5173'
const OAUTH_COOKIES = [
  'oauth_state',
  'oauth_nonce',
  'oauth_verifier',
  'oauth_redirect',
  'oauth_origin',
]

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(googleAuth.exchangeCode).mockResolvedValue({
    id_token: 'id-token',
    access_token: 'access-token',
  })
  vi.mocked(googleAuth.verifyGoogleIdToken).mockResolvedValue({
    sub: 'google-1',
    email: 'pessoa@example.com',
    email_verified: true,
    name: 'Pessoa Teste',
    picture: 'https://example.com/foto.jpg',
  })
})

/**
 * Um navegador só: guarda os cookies entre as requisições e aplica Max-Age=0
 * como remoção. O TTL de 5 minutos não corre aqui; o cookie vencido é simulado
 * removendo-o do pote.
 */
function browser() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const env = {
    JWT_SECRET: 'test-secret-oauth-context',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'http://localhost:8787',
    FRONTEND_URL,
    DB: db,
    AE: { writeDataPoint() {} },
  } as unknown as Env
  const app = new Hono<AppContext>()
  app.route('/auth', authRouter)
  const jar = new Map<string, string>()

  async function visit(path: string) {
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
    const res = await app.request(path, { headers: cookie ? { Cookie: cookie } : {} }, env)
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';')
      const name = pair.slice(0, pair.indexOf('='))
      if (/Max-Age=0(;|$)/.test(header)) jar.delete(name)
      else jar.set(name, pair.slice(pair.indexOf('=') + 1))
    }
    return res
  }

  /** Abre o login e devolve o `state` que o Google devolveria no callback. */
  async function startLogin(query = '') {
    const res = await visit(`/auth/google${query}`)
    return new URL(res.headers.get('Location') ?? '').searchParams.get('state') ?? ''
  }

  function returnFromGoogle(query: string) {
    return visit(`/auth/callback?${query}`)
  }

  const oauthCookies = () => [...jar.keys()].filter((name) => name.startsWith('oauth_'))
  return { jar, startLogin, returnFromGoogle, oauthCookies }
}

describe('contexto OAuth de cada tentativa de login', () => {
  it('callback com error apaga os cookies da tentativa', async () => {
    const b = browser()
    await b.startLogin('?redirect=/grupos/g1&origem=convite')
    expect(b.oauthCookies().sort()).toEqual([...OAUTH_COOKIES].sort())

    const res = await b.returnFromGoogle('error=access_denied')

    expect(res.headers.get('Location')).toBe(`${FRONTEND_URL}?auth_error=access_denied`)
    for (const name of OAUTH_COOKIES) {
      const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))
      expect(cookie, name).toContain('Max-Age=0')
    }
    expect(b.oauthCookies()).toEqual([])
  })

  it('login sem redirect depois de um login recusado no Google vai para a raiz', async () => {
    const b = browser()
    await b.startLogin('?redirect=?convite=ABC123')
    await b.returnFromGoogle('error=access_denied')

    const state = await b.startLogin()
    const res = await b.returnFromGoogle(`state=${state}&code=abc`)

    expect(res.headers.get('Location')).toBe(FRONTEND_URL)
    expect(b.jar.has('session')).toBe(true)
  })

  it('login sem redirect depois de uma tentativa abandonada vai para a raiz', async () => {
    const b = browser()
    await b.startLogin('?redirect=/grupos/g1?rodada=3')

    const state = await b.startLogin()
    const res = await b.returnFromGoogle(`state=${state}&code=abc`)

    expect(res.headers.get('Location')).toBe(FRONTEND_URL)
  })

  it('redirect recusado numa nova tentativa não reaproveita o destino anterior', async () => {
    const b = browser()
    await b.startLogin('?redirect=/grupos/g1')

    const state = await b.startLogin('?redirect=https://evil.com/roubo')
    const res = await b.returnFromGoogle(`state=${state}&code=abc`)

    expect(res.headers.get('Location')).toBe(FRONTEND_URL)
  })

  it('a tentativa nova com redirect leva ao destino dela, como no convite', async () => {
    const b = browser()
    await b.startLogin('?redirect=/grupos/g1')

    const state = await b.startLogin('?redirect=?convite=ABC123')
    const res = await b.returnFromGoogle(`state=${state}&code=abc`)

    expect(res.headers.get('Location')).toBe(`${FRONTEND_URL}/?convite=ABC123`)
    expect(b.oauthCookies()).toEqual([])
  })

  it('state inválido é recusado, limpa a tentativa e não leva ao destino guardado', async () => {
    const b = browser()
    await b.startLogin('?redirect=/grupos/g1')

    const res = await b.returnFromGoogle('state=outro&code=abc')

    expect(res.headers.get('Location')).toBe(`${FRONTEND_URL}?auth_error=state_mismatch`)
    expect(b.jar.has('session')).toBe(false)
    expect(b.oauthCookies()).toEqual([])
    expect(googleAuth.exchangeCode).not.toHaveBeenCalled()
  })

  it('cookie vencido é recusado como sessão expirada sem usar o destino que restou', async () => {
    const b = browser()
    const state = await b.startLogin('?redirect=/grupos/g1')
    b.jar.delete('oauth_state')
    b.jar.delete('oauth_nonce')
    b.jar.delete('oauth_verifier')

    const res = await b.returnFromGoogle(`state=${state}&code=abc`)

    expect(res.headers.get('Location')).toBe(`${FRONTEND_URL}?auth_error=session_expired`)
    expect(b.jar.has('session')).toBe(false)
    expect(b.oauthCookies()).toEqual([])
  })

  it('falha na troca do código limpa a tentativa', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(googleAuth.exchangeCode).mockRejectedValueOnce(new Error('Google fora'))
    const b = browser()
    const state = await b.startLogin('?redirect=/grupos/g1')

    const res = await b.returnFromGoogle(`state=${state}&code=abc`)

    expect(res.headers.get('Location')).toBe(`${FRONTEND_URL}?auth_error=exchange_failed`)
    expect(b.oauthCookies()).toEqual([])
  })

  it.each([
    ['https://evil.com/roubo'],
    ['//evil.com/roubo'],
    ['/\\evil.com/roubo'],
    ['javascript:alert(1)'],
  ])('destino externo %s no cookie é recusado no callback', async (target) => {
    const b = browser()
    const state = await b.startLogin('?redirect=/grupos/g1')
    b.jar.set('oauth_redirect', encodeURIComponent(target))

    const res = await b.returnFromGoogle(`state=${state}&code=abc`)

    expect(res.headers.get('Location')).toBe(FRONTEND_URL)
  })

  it('caminho que o navegador resolveria para outro host é recusado', async () => {
    const b = browser()
    const state = await b.startLogin(
      `?redirect=${encodeURIComponent(`${FRONTEND_URL}//evil.com/roubo`)}`,
    )

    const res = await b.returnFromGoogle(`state=${state}&code=abc`)

    expect(res.headers.get('Location')).toBe(FRONTEND_URL)
  })
})
