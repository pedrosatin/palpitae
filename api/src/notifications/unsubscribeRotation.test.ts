/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { signUnsubToken } from './unsubscribeToken'

// Valores de teste: o JWT_SECRET de antes e de depois da rotação e o segredo próprio
// do descadastro.
const OLD_JWT_SECRET = 'jwt-antes-da-rotacao'
const NEW_JWT_SECRET = 'jwt-depois-da-rotacao'
const UNSUBSCRIBE_SECRET = 'segredo-do-descadastro'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

function createFixture(secrets: Pick<Env, 'JWT_SECRET' | 'UNSUBSCRIBE_SECRET'>) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
      ('ana', 'ana@example.com', 'google', 'g-ana', 'Ana');
  `)

  const env: Env = {
    DB: db,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    RESEND_API_KEY: 'test-resend',
    ...secrets,
  }

  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext

  function unsubscribe(token: string, method: 'GET' | 'POST') {
    return worker.fetch(
      new Request(`https://api.palpitae.com.br/notifications/unsubscribe?token=${token}`, {
        method,
        headers: { 'CF-Connecting-IP': '192.0.2.10' },
      }),
      env,
      ctx,
    )
  }

  function unsubscribedAt() {
    const row = sqlite.prepare(`SELECT email_unsubscribed_at FROM users WHERE id = 'ana'`).get() as {
      email_unsubscribed_at: string | null
    }
    return row.email_unsubscribed_at
  }

  return { sqlite, unsubscribe, unsubscribedAt }
}

describe('link de descadastro e rotação de chave', () => {
  it('link assinado com o JWT_SECRET antigo continua descadastrando depois da rotação quando o UNSUBSCRIBE_SECRET guarda o valor antigo', async () => {
    // E-mail enviado antes de existir o segredo próprio: o token saiu com o JWT_SECRET.
    const token = await signUnsubToken('ana', OLD_JWT_SECRET)
    // O operador guardou o valor antigo como UNSUBSCRIBE_SECRET e trocou o JWT_SECRET.
    const { unsubscribe, unsubscribedAt } = createFixture({
      JWT_SECRET: NEW_JWT_SECRET,
      UNSUBSCRIBE_SECRET: OLD_JWT_SECRET,
    })

    const page = await unsubscribe(token, 'GET')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<form')
    // GET só mostra a confirmação.
    expect(unsubscribedAt()).toBeNull()

    const res = await unsubscribe(token, 'POST')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('unsubscribed')
    expect(unsubscribedAt()).not.toBeNull()
  })

  it('link assinado com o segredo de descadastro sobrevive à troca do JWT_SECRET', async () => {
    const token = await signUnsubToken('ana', UNSUBSCRIBE_SECRET)
    const { sqlite, unsubscribe, unsubscribedAt } = createFixture({
      JWT_SECRET: NEW_JWT_SECRET,
      UNSUBSCRIBE_SECRET,
    })

    expect((await unsubscribe(token, 'POST')).status).toBe(200)
    const first = unsubscribedAt()
    expect(first).not.toBeNull()

    // Um segundo POST (cliente de e-mail que repete o one-click) não regrava a data.
    sqlite.exec(`UPDATE users SET email_unsubscribed_at = '2026-01-01 00:00:00' WHERE id = 'ana'`)
    expect((await unsubscribe(token, 'POST')).status).toBe(200)
    expect(unsubscribedAt()).toBe('2026-01-01 00:00:00')
  })

  it('link assinado com o JWT_SECRET vale depois de configurar um segredo de descadastro novo', async () => {
    const token = await signUnsubToken('ana', OLD_JWT_SECRET)
    const { unsubscribe, unsubscribedAt } = createFixture({
      JWT_SECRET: OLD_JWT_SECRET,
      UNSUBSCRIBE_SECRET,
    })

    expect((await unsubscribe(token, 'POST')).status).toBe(200)
    expect(unsubscribedAt()).not.toBeNull()
  })

  it('sem segredo de descadastro, o JWT_SECRET segue valendo como hoje', async () => {
    const token = await signUnsubToken('ana', OLD_JWT_SECRET)
    const { unsubscribe, unsubscribedAt } = createFixture({ JWT_SECRET: OLD_JWT_SECRET })

    expect((await unsubscribe(token, 'GET')).status).toBe(200)
    expect((await unsubscribe(token, 'POST')).status).toBe(200)
    expect(unsubscribedAt()).not.toBeNull()
  })

  it('UNSUBSCRIBE_SECRET em branco aceita o token assinado com o JWT_SECRET', async () => {
    const token = await signUnsubToken('ana', OLD_JWT_SECRET)
    const { unsubscribe, unsubscribedAt } = createFixture({
      JWT_SECRET: OLD_JWT_SECRET,
      UNSUBSCRIBE_SECRET: '  ',
    })

    expect((await unsubscribe(token, 'GET')).status).toBe(200)
    expect((await unsubscribe(token, 'POST')).status).toBe(200)
    expect(unsubscribedAt()).not.toBeNull()
  })

  it('token malformado com os dois segredos configurados responde 400 sem escrever', async () => {
    const { unsubscribe, unsubscribedAt } = createFixture({
      JWT_SECRET: NEW_JWT_SECRET,
      UNSUBSCRIBE_SECRET,
    })

    for (const token of ['sem-ponto', 'a.b.c', '%%%.%%%', '.']) {
      expect((await unsubscribe(encodeURIComponent(token), 'GET')).status).toBe(400)
      expect((await unsubscribe(encodeURIComponent(token), 'POST')).status).toBe(400)
    }
    expect(unsubscribedAt()).toBeNull()
  })

  it('recusa token assinado com um segredo que o Worker não conhece', async () => {
    const token = await signUnsubToken('ana', 'segredo-desconhecido')
    const { unsubscribe, unsubscribedAt } = createFixture({
      JWT_SECRET: NEW_JWT_SECRET,
      UNSUBSCRIBE_SECRET,
    })

    expect((await unsubscribe(token, 'GET')).status).toBe(400)
    expect((await unsubscribe(token, 'POST')).status).toBe(400)
    expect(unsubscribedAt()).toBeNull()
  })
})
