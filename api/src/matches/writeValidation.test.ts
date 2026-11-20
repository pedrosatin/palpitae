import { afterEach, describe, expect, it } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

const INVALID_BODY = { error: 'Body JSON inválido' }
const SYNC_REQUIRED = { error: 'competition e season são obrigatórios' }
const SYNC_SEASON = { error: 'season deve ser um número' }
const SYNC_DATES = { error: 'dates deve ser uma lista de datas YYYYMMDD' }
const SYNC_FORBIDDEN = { error: 'Você não tem permissão para sincronizar partidas' }

async function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES
      ('admin','admin@example.com','google','admin'),
      ('user','user@example.com','google','user');
  `)
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FRONTEND_WORKER_ZONE: 'palpitae-web.pages.dev',
    ADMIN_EMAIL: 'admin@example.com',
    FOOTBALL_API_KEY: 'test-key',
  } as Env
  const adminToken = await signJwt(
    { sub: 'admin', email: 'admin@example.com', jti: crypto.randomUUID() },
    env.JWT_SECRET,
    3600,
  )
  const userToken = await signJwt(
    { sub: 'user', email: 'user@example.com', jti: crypto.randomUUID() },
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
    opts: { token?: 'admin' | 'user'; contentType?: string | null } = {},
  ) => {
    const token = opts.token === 'user' ? userToken : adminToken
    const headers: Record<string, string> = {
      Cookie: `session=${token}`,
      'CF-Connecting-IP': '192.0.2.1',
    }
    const init: RequestInit = { method: 'POST', headers }
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body)
      if (opts.contentType !== null) {
        headers['Content-Type'] = opts.contentType ?? 'application/json'
      }
    }
    const response = await worker.fetch(
      new Request('https://api.palpitae.com.br/matches/sync', init),
      env,
      ctx,
    )
    return {
      status: response.status,
      body: (await response.json()) as { error?: string },
    }
  }
}

describe('validação de escrita POST /matches/sync', () => {
  it('não-admin responde 403 antes de validar o corpo', async () => {
    const request = await setup()
    const res = await request('{', { token: 'user' })
    expect(res).toEqual({ status: 403, body: SYNC_FORBIDDEN })
  })

  it('JSON malformado responde Body JSON inválido', async () => {
    const request = await setup()
    for (const contentType of ['application/json', null] as const) {
      const res = await request('{', { contentType })
      expect(res).toEqual({ status: 400, body: INVALID_BODY })
    }
  })

  it('lista ou valor solto responde mensagem de obrigatórios', async () => {
    const request = await setup()
    for (const raw of ['[]', '42', '"x"']) {
      const res = await request(raw)
      expect(res).toEqual({ status: 400, body: SYNC_REQUIRED })
    }
  })

  it('objeto sem competition ou season responde mensagem de obrigatórios', async () => {
    const request = await setup()
    const cases = [
      {},
      { competition: 'WC' },
      { season: 2026 },
      { competition: '', season: 2026 },
      { competition: 'WC', season: 0 },
      { competition: 'WC', season: null },
    ]
    for (const body of cases) {
      const res = await request(body)
      expect(res).toEqual({ status: 400, body: SYNC_REQUIRED })
    }
  })

  it('season com tipo errado responde season deve ser um número', async () => {
    const request = await setup()
    // `null` e `0` caem na mensagem de obrigatórios pela truthiness da base.
    for (const season of ['2026', true]) {
      const res = await request({ competition: 'WC', season })
      expect(res).toEqual({ status: 400, body: SYNC_SEASON })
    }
  })

  it('dates inválidas respondem a mensagem de formato', async () => {
    const request = await setup()
    const cases = [
      { competition: 'WC', season: 2026, dates: '20260101' },
      { competition: 'WC', season: 2026, dates: ['2026-01-01'] },
      { competition: 'WC', season: 2026, dates: [20260101] },
      { competition: 'WC', season: 2026, dates: [null] },
    ]
    for (const body of cases) {
      const res = await request(body)
      expect(res).toEqual({ status: 400, body: SYNC_DATES })
    }
  })

  it('obrigatórios têm prioridade sobre dates inválidas', async () => {
    const request = await setup()
    const res = await request({ dates: [1] })
    expect(res).toEqual({ status: 400, body: SYNC_REQUIRED })
  })

  it('season com tipo errado tem prioridade sobre dates inválidas', async () => {
    const request = await setup()
    const res = await request({ competition: 'WC', season: 'x', dates: [1] })
    expect(res).toEqual({ status: 400, body: SYNC_SEASON })
  })

  it('JSON válido sem Content-Type ainda valida o schema', async () => {
    const request = await setup()
    expect(await request({}, { contentType: null })).toEqual({
      status: 400,
      body: SYNC_REQUIRED,
    })
  })

  it('corpo JSON null responde 400 com mensagem de obrigatórios', async () => {
    // Na base, `null` gerava TypeError → 500. Correção intencional para 400.
    const request = await setup()
    expect(await request('null')).toEqual({ status: 400, body: SYNC_REQUIRED })
  })
})
