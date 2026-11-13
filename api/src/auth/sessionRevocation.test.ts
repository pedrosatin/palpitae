/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { signJwt } from './jwt'

// A revogação do logout guarda o hash da string do token. Estes testes passam
// pela API inteira para garantir que só uma string autentica cada sessão.

const SECRET = 'test-secret'
const API = 'https://api.palpitae.com.br'
const FRONT = 'https://palpitae.com.br'
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
// Rota com `requireAuth` que lê (GET) e grava (PATCH) na conta da sessão.
const PROTECTED = '/notifications/preferences'

/** Troca o último caractere da assinatura por outro que difere só nos bits dados. */
function flipLastChar(token: string, bits: number): string {
  const index = ALPHABET.indexOf(token.at(-1)!)
  return `${token.slice(0, -1)}${ALPHABET[index ^ bits]}`
}

function splitSignature(token: string): [string, string] {
  const cut = token.lastIndexOf('.') + 1
  return [token.slice(0, cut), token.slice(cut)]
}

/**
 * Reescritas da assinatura que um decodificador de base64 tolerante lê como os
 * mesmos bytes. A assinatura HS256 tem 43 caracteres, e os 2 bits baixos do
 * último não entram nos 32 bytes decodificados.
 */
const VARIANTS: [string, (token: string) => string][] = [
  ['`=` no fim', (token) => `${token}=`],
  ['bit 0 do último caractere trocado', (token) => flipLastChar(token, 1)],
  ['bits 0 e 1 do último caractere trocados', (token) => flipLastChar(token, 3)],
  [
    'alfabeto `+` e `/`',
    (token) => {
      const [head, signature] = splitSignature(token)
      return `${head}${signature.replace(/-/g, '+').replace(/_/g, '/')}`
    },
  ],
  [
    'espaço interno',
    (token) => {
      const [head, signature] = splitSignature(token)
      return `${head}${signature.slice(0, 10)} ${signature.slice(10)}`
    },
  ],
]

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

async function fixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES ('member','member@example.com','google','1');
    INSERT INTO profiles (user_id,nickname) VALUES ('member','Member');
  `)
  const env = { DB: db, JWT_SECRET: SECRET, BASE_URL: API, FRONTEND_URL: FRONT } as Env
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext

  const call = (path: string, token: string, method = 'GET', body?: unknown) =>
    worker.fetch(
      new Request(`${API}${path}`, {
        method,
        headers: {
          Cookie: `session=${token}`,
          'CF-Connecting-IP': '192.0.2.1',
          ...(method === 'GET' ? {} : { Origin: FRONT, 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      ctx,
    )

  /** Sessão da conta. Com `-` ou `_` na assinatura, a variante de alfabeto difere do token. */
  const session = async () => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const token = await signJwt(
        { sub: 'member', email: 'member@example.com', jti: crypto.randomUUID() },
        SECRET,
        3600,
      )
      if (/[-_]/.test(splitSignature(token)[1])) return token
    }
    throw new Error('nenhuma assinatura com - ou _ em 500 tentativas')
  }

  const me = async (token: string) => (await call('/auth/me', token)).json()
  const status = async (token: string, method = 'GET', body?: unknown) =>
    (await call(PROTECTED, token, method, body)).status
  const unsubscribedAt = () =>
    (
      sqlite.prepare("SELECT email_unsubscribed_at AS at FROM users WHERE id = 'member'").get() as {
        at: string | null
      }
    ).at

  return { call, session, me, status, unsubscribedAt }
}

describe('revogação de sessão pela API inteira', () => {
  it('o token emitido autentica até o logout e é recusado depois', async () => {
    const { call, session, me, status } = await fixture()
    const token = await session()

    expect(await me(token)).toMatchObject({ user: { id: 'member' } })
    expect(await status(token)).toBe(200)

    expect((await call('/auth/logout', token, 'POST')).status).toBe(200)

    expect(await me(token)).toEqual({ authenticated: false })
    expect(await status(token)).toBe(401)
  })

  it.each(VARIANTS)('depois do logout, a variante com %s não autentica', async (_name, rewrite) => {
    const { call, session, me, status, unsubscribedAt } = await fixture()
    const token = await session()
    const variant = rewrite(token)
    expect(variant).not.toBe(token)

    expect((await call('/auth/logout', token, 'POST')).status).toBe(200)

    expect(await me(variant)).toEqual({ authenticated: false })
    expect(await status(variant)).toBe(401)
    expect(await status(variant, 'PATCH', { round_reminders: false })).toBe(401)
    expect(unsubscribedAt()).toBeNull()
  })

  it.each(VARIANTS)(
    'com a sessão ativa, a variante com %s também é recusada',
    async (_name, rewrite) => {
      const { session, me, status } = await fixture()
      const token = await session()
      const variant = rewrite(token)

      expect(await me(variant)).toEqual({ authenticated: false })
      expect(await status(variant)).toBe(401)
      // A recusa da variante não derruba a sessão legítima.
      expect(await status(token)).toBe(200)
    },
  )

  it('logout-all corta as outras sessões da conta e as variantes delas', async () => {
    const { call, session, me, status } = await fixture()
    const phone = await session()
    const laptop = await session()

    expect((await call('/auth/logout-all', laptop, 'POST')).status).toBe(200)

    for (const token of [phone, laptop]) {
      expect(await me(token)).toEqual({ authenticated: false })
      expect(await status(token)).toBe(401)
      for (const [, rewrite] of VARIANTS) {
        expect(await me(rewrite(token))).toEqual({ authenticated: false })
        expect(await status(rewrite(token))).toBe(401)
      }
    }
  })
})
