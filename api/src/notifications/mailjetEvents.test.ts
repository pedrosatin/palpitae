/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import {
  mailjetWebhookAuthorized,
  normalizeMailjetEvents,
  passwordFromBasicAuth,
  userIdFromMailjetCustomId,
} from './mailjetEvents'

const JWT_SECRET = 'jwt-mailjet-events'
const WEBHOOK_SECRET = 'webhook-secret-mailjet'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

function basicAuth(user: string, password: string): string {
  return `Basic ${btoa(`${user}:${password}`)}`
}

function createFixture(opts: { webhookSecret?: string } = {}) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
      ('ana', 'ana@example.com', 'google', 'g-ana', 'Ana'),
      ('bia', 'bia@example.com', 'google', 'g-bia', 'Bia');
  `)

  const env: Env = {
    DB: db,
    JWT_SECRET,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    RESEND_API_KEY: 'test-resend',
    ...(opts.webhookSecret !== undefined
      ? { MAILJET_WEBHOOK_SECRET: opts.webhookSecret }
      : { MAILJET_WEBHOOK_SECRET: WEBHOOK_SECRET }),
  }

  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext

  function post(body: unknown, auth?: string | null) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.0.2.10',
    }
    if (auth !== null) {
      headers.Authorization = auth ?? basicAuth('mailjet', WEBHOOK_SECRET)
    }
    return worker.fetch(
      new Request('https://api.palpitae.com.br/notifications/mailjet-events', {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      env,
      ctx,
    )
  }

  function unsubscribedAt(userId: string) {
    const row = sqlite
      .prepare(`SELECT email_unsubscribed_at FROM users WHERE id = ?`)
      .get(userId) as { email_unsubscribed_at: string | null }
    return row.email_unsubscribed_at
  }

  return { sqlite, post, unsubscribedAt, env }
}

describe('mailjetEvents helpers', () => {
  it('extrai userId do CustomID do lembrete', () => {
    expect(userIdFromMailjetCustomId('lembrete-diario/ana/2026-11-18')).toBe('ana')
    expect(userIdFromMailjetCustomId('lembrete-diario/user-1/2026-01-01')).toBe('user-1')
    expect(userIdFromMailjetCustomId('outro/ana/2026-11-18')).toBeNull()
    expect(userIdFromMailjetCustomId('lembrete-diario/ana')).toBeNull()
    expect(userIdFromMailjetCustomId(undefined)).toBeNull()
    expect(userIdFromMailjetCustomId(123)).toBeNull()
  })

  it('lê a senha do Basic Auth', () => {
    expect(passwordFromBasicAuth(basicAuth('mailjet', 'segredo'))).toBe('segredo')
    expect(passwordFromBasicAuth(basicAuth('', 'só-senha'))).toBe('só-senha')
    expect(passwordFromBasicAuth('Bearer x')).toBeNull()
    expect(passwordFromBasicAuth(undefined)).toBeNull()
  })

  it('normaliza objeto ou array agrupado', () => {
    expect(normalizeMailjetEvents({ event: 'unsub' })).toEqual([{ event: 'unsub' }])
    expect(normalizeMailjetEvents([{ event: 'unsub' }, { event: 'spam' }])).toHaveLength(2)
    expect(normalizeMailjetEvents('x')).toBeNull()
    expect(normalizeMailjetEvents(null)).toBeNull()
  })

  it('autoriza só com o segredo configurado e a senha certa', async () => {
    expect(await mailjetWebhookAuthorized(basicAuth('u', 's'), undefined)).toBe('missing_config')
    expect(await mailjetWebhookAuthorized(basicAuth('u', 's'), '  ')).toBe('missing_config')
    expect(await mailjetWebhookAuthorized(undefined, 's')).toBe('unauthorized')
    expect(await mailjetWebhookAuthorized(basicAuth('u', 'errado'), 's')).toBe('unauthorized')
    expect(await mailjetWebhookAuthorized(basicAuth('u', 's'), 's')).toBe('ok')
  })
})

describe('POST /notifications/mailjet-events', () => {
  it('unsub por CustomID desliga os lembretes', async () => {
    const { post, unsubscribedAt } = createFixture()
    const res = await post({
      event: 'unsub',
      email: 'ana@example.com',
      CustomID: 'lembrete-diario/ana/2026-11-18',
    })
    expect(res.status).toBe(200)
    expect(unsubscribedAt('ana')).not.toBeNull()
    expect(unsubscribedAt('bia')).toBeNull()
  })

  it('spam também desliga os lembretes', async () => {
    const { post, unsubscribedAt } = createFixture()
    const res = await post({
      event: 'spam',
      email: 'bia@example.com',
      CustomID: 'lembrete-diario/bia/2026-11-20',
    })
    expect(res.status).toBe(200)
    expect(unsubscribedAt('bia')).not.toBeNull()
  })

  it('e-mail sem conta é ignorado', async () => {
    const { post, unsubscribedAt } = createFixture()
    const res = await post({
      event: 'unsub',
      email: 'nobody@example.com',
      CustomID: 'lembrete-diario/ghost/2026-11-18',
    })
    expect(res.status).toBe(200)
    expect(unsubscribedAt('ana')).toBeNull()
    expect(unsubscribedAt('bia')).toBeNull()
  })

  it('cai no e-mail quando o CustomID não resolve conta', async () => {
    const { post, unsubscribedAt } = createFixture()
    const res = await post({
      event: 'unsub',
      email: 'ana@example.com',
      CustomID: 'lembrete-diario/ghost/2026-11-18',
    })
    expect(res.status).toBe(200)
    expect(unsubscribedAt('ana')).not.toBeNull()
  })

  it('evento repetido é idempotente e preserva a data', async () => {
    const { sqlite, post, unsubscribedAt } = createFixture()
    expect(
      (await post({ event: 'unsub', CustomID: 'lembrete-diario/ana/2026-11-18' })).status,
    ).toBe(200)
    const first = unsubscribedAt('ana')
    expect(first).not.toBeNull()

    sqlite.exec(`UPDATE users SET email_unsubscribed_at = '2026-01-01 00:00:00' WHERE id = 'ana'`)
    expect(
      (await post({ event: 'unsub', CustomID: 'lembrete-diario/ana/2026-11-18' })).status,
    ).toBe(200)
    expect(unsubscribedAt('ana')).toBe('2026-01-01 00:00:00')
  })

  it('aceita array agrupado de eventos', async () => {
    const { post, unsubscribedAt } = createFixture()
    const res = await post([
      { event: 'open', email: 'ana@example.com', CustomID: 'lembrete-diario/ana/2026-11-18' },
      { event: 'unsub', email: 'ana@example.com', CustomID: 'lembrete-diario/ana/2026-11-18' },
      { event: 'spam', email: 'bia@example.com', CustomID: 'lembrete-diario/bia/2026-11-18' },
      { event: 'bounce', email: 'bia@example.com' },
    ])
    expect(res.status).toBe(200)
    expect(unsubscribedAt('ana')).not.toBeNull()
    expect(unsubscribedAt('bia')).not.toBeNull()
  })

  it('sem segredo configurado responde 404 e não muda nada', async () => {
    const { post, unsubscribedAt } = createFixture({ webhookSecret: '' })
    const res = await post({
      event: 'unsub',
      CustomID: 'lembrete-diario/ana/2026-11-18',
    })
    expect(res.status).toBe(404)
    expect(unsubscribedAt('ana')).toBeNull()
  })

  it('segredo errado responde 401 e não muda nada', async () => {
    const { post, unsubscribedAt } = createFixture()
    const res = await post(
      { event: 'unsub', CustomID: 'lembrete-diario/ana/2026-11-18' },
      basicAuth('mailjet', 'errado'),
    )
    expect(res.status).toBe(401)
    expect(unsubscribedAt('ana')).toBeNull()
  })

  it('sem Authorization responde 401', async () => {
    const { post, unsubscribedAt } = createFixture()
    const res = await post({ event: 'unsub', CustomID: 'lembrete-diario/ana/2026-11-18' }, null)
    expect(res.status).toBe(401)
    expect(unsubscribedAt('ana')).toBeNull()
  })

  it('payload inválido responde 200 sem efeito', async () => {
    const { post, unsubscribedAt } = createFixture()
    const badJson = await post('{')
    expect(badJson.status).toBe(200)
    expect(unsubscribedAt('ana')).toBeNull()

    const notObject = await post('"texto"')
    expect(notObject.status).toBe(200)
    expect(unsubscribedAt('ana')).toBeNull()
  })

  it('falha do banco num unsub responde 500 para a Mailjet reenviar', async () => {
    const { sqlite, post } = createFixture()
    // A consulta do usuário passa a falhar (D1 indisponível); o limitador usa outra tabela.
    sqlite.exec('ALTER TABLE users RENAME TO users_fora')
    const res = await post({
      event: 'unsub',
      email: 'ana@example.com',
      CustomID: 'lembrete-diario/ana/2026-11-18',
    })
    expect(res.status).toBe(500)
  })

  it('item malformado no lote não descarta os eventos válidos', async () => {
    const { post, unsubscribedAt } = createFixture()
    const res = await post([
      'lixo',
      { event: 'unsub', email: 'bia@example.com', CustomID: 'lembrete-diario/bia/2026-11-18' },
    ])
    expect(res.status).toBe(200)
    expect(unsubscribedAt('bia')).not.toBeNull()
  })

  it('CustomID prevalece sobre o e-mail do evento', async () => {
    const { post, unsubscribedAt } = createFixture()
    const res = await post({
      event: 'unsub',
      email: 'bia@example.com',
      CustomID: 'lembrete-diario/ana/2026-11-18',
    })
    expect(res.status).toBe(200)
    expect(unsubscribedAt('ana')).not.toBeNull()
    expect(unsubscribedAt('bia')).toBeNull()
  })

  it('ignora tipos de evento que não são unsub nem spam', async () => {
    const { post, unsubscribedAt } = createFixture()
    const res = await post({
      event: 'open',
      email: 'ana@example.com',
      CustomID: 'lembrete-diario/ana/2026-11-18',
    })
    expect(res.status).toBe(200)
    expect(unsubscribedAt('ana')).toBeNull()
  })
})
