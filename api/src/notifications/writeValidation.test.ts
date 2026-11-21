import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

const PREFS_ERROR = { error: 'round_reminders (boolean) é obrigatório' }
const WEBHOOK_SECRET = 'webhook-secret-mailjet'

async function setupPreferences() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES ('u1','u@example.com','google','u1');
  `)
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FRONTEND_WORKER_ZONE: 'palpitae-web.pages.dev',
  } as Env
  const token = await signJwt(
    { sub: 'u1', email: 'u@example.com', jti: crypto.randomUUID() },
    env.JWT_SECRET,
    3600,
  )
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext
  return async (
    body: unknown | undefined,
    contentType: string | null = 'application/json',
  ) => {
    const headers: Record<string, string> = {
      Cookie: `session=${token}`,
      'CF-Connecting-IP': '192.0.2.1',
    }
    const init: RequestInit = { method: 'PATCH', headers }
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body)
      if (contentType !== null) headers['Content-Type'] = contentType
    }
    const response = await worker.fetch(
      new Request('https://api.palpitae.com.br/notifications/preferences', init),
      env,
      ctx,
    )
    return {
      status: response.status,
      body: (await response.json()) as { error?: string; round_reminders?: boolean },
    }
  }
}

function setupMailjet() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id) VALUES
      ('ana', 'ana@example.com', 'google', 'g-ana');
  `)
  const env = {
    DB: db,
    JWT_SECRET: 'jwt-mailjet-write-val',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    MAILJET_WEBHOOK_SECRET: WEBHOOK_SECRET,
  } as Env
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext
  async function post(body: unknown, contentType: string | null = 'application/json') {
    const headers: Record<string, string> = {
      Authorization: `Basic ${btoa(`mailjet:${WEBHOOK_SECRET}`)}`,
      'CF-Connecting-IP': '192.0.2.10',
    }
    if (contentType !== null) headers['Content-Type'] = contentType
    const response = await worker.fetch(
      new Request('https://api.palpitae.com.br/notifications/mailjet-events', {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      env,
      ctx,
    )
    return { status: response.status, text: await response.text() }
  }
  function unsubscribedAt(userId: string) {
    const row = sqlite
      .prepare(`SELECT email_unsubscribed_at FROM users WHERE id = ?`)
      .get(userId) as { email_unsubscribed_at: string | null }
    return row.email_unsubscribed_at
  }
  return { post, unsubscribedAt }
}

describe('validação de escrita PATCH /notifications/preferences', () => {
  it('corpo malformado, lista ou valor solto responde a mensagem de round_reminders', async () => {
    const request = await setupPreferences()
    for (const raw of ['{', '[]', '42', '"x"']) {
      const res = await request(raw)
      expect(res).toEqual({ status: 400, body: PREFS_ERROR })
    }
  })

  it('campo ausente, tipo errado ou null responde a mensagem de round_reminders', async () => {
    const request = await setupPreferences()
    const cases = [
      {},
      { round_reminders: 'yes' },
      { round_reminders: 1 },
      { round_reminders: null },
      { other: true },
    ]
    for (const body of cases) {
      const res = await request(body)
      expect(res).toEqual({ status: 400, body: PREFS_ERROR })
    }
  })

  it('JSON válido sem Content-Type ainda valida o schema', async () => {
    const request = await setupPreferences()
    expect(await request({}, null)).toEqual({ status: 400, body: PREFS_ERROR })
    expect(await request('{', null)).toEqual({ status: 400, body: PREFS_ERROR })
  })

  it('boolean válido com campo extra responde 200', async () => {
    const request = await setupPreferences()
    for (const round_reminders of [true, false]) {
      const res = await request({ round_reminders, extra: 'x' })
      expect(res).toEqual({ status: 200, body: { round_reminders } })
    }
  })

  it('corpo JSON null responde 400 com a mensagem de round_reminders', async () => {
    const request = await setupPreferences()
    expect(await request('null')).toEqual({ status: 400, body: PREFS_ERROR })
  })
})

describe('validação de escrita POST /notifications/mailjet-events', () => {
  it('JSON inválido ou valor solto responde 200 ok', async () => {
    const { post } = setupMailjet()
    for (const raw of ['{', 'null', '42', '"x"', '[]']) {
      const res = await post(raw)
      expect(res).toEqual({ status: 200, text: 'ok' })
    }
  })

  it('objeto único com campo extra aplica unsub', async () => {
    const { post, unsubscribedAt } = setupMailjet()
    const res = await post({
      event: 'unsub',
      email: 'ana@example.com',
      CustomID: 'lembrete-diario/ana/2026-11-18',
      mj_campaign_id: 99,
    })
    expect(res).toEqual({ status: 200, text: 'ok' })
    expect(unsubscribedAt('ana')).not.toBeNull()
  })

  it('lista com campo extra aplica unsub', async () => {
    const { post, unsubscribedAt } = setupMailjet()
    const res = await post([
      {
        event: 'unsub',
        email: 'ana@example.com',
        CustomID: 'lembrete-diario/ana/2026-11-18',
        provider: 'mailjet',
      },
    ])
    expect(res).toEqual({ status: 200, text: 'ok' })
    expect(unsubscribedAt('ana')).not.toBeNull()
  })

  it('JSON válido sem Content-Type ainda aceita o payload', async () => {
    const { post } = setupMailjet()
    const res = await post(
      {
        event: 'unsub',
        email: 'ana@example.com',
        CustomID: 'lembrete-diario/ana/2026-11-18',
      },
      null,
    )
    expect(res).toEqual({ status: 200, text: 'ok' })
  })
})
