/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { signJwt } from './jwt'

// API inteira sobre o D1 em memória. `ADMIN_GOOGLE_SUB` amarra o papel de admin e o
// acesso a piloto do admin à conta Google dona do `ADMIN_EMAIL`, para que um e-mail
// reciclado não herde o papel. Todos os valores são sintéticos.

const ADMIN_EMAIL = 'admin@example.test'
const SUB_CERTO = 'sub-certo-0001'
const SUB_ERRADO = 'sub-errado-0002'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

type Conta = { provider?: string; providerId?: string }

function fixture(envOverrides: Partial<Env> = {}, conta: Conta = {}) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const provider = conta.provider ?? 'google'
  const providerId = conta.providerId ?? SUB_CERTO
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES
      ('u1','${ADMIN_EMAIL}','${provider}','${providerId}');
    INSERT INTO profiles (user_id,nickname) VALUES ('u1','Admin');
    INSERT INTO competitions (id,name,slug,status,penalty_phases,visibility) VALUES
      ('piloto','Piloto','piloto','ongoing','[]','pilot');
  `)
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    ADMIN_EMAIL,
    ...envOverrides,
  } as Env
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext

  const request = async (path: string, method = 'GET', body?: unknown) => {
    const token = await signJwt({ sub: 'u1', email: ADMIN_EMAIL, jti: 'j1' }, env.JWT_SECRET, 3600)
    return worker.fetch(
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
  }

  return { request }
}

async function seesPilot(response: Response): Promise<boolean> {
  const { competitions } = (await response.json()) as { competitions: Array<{ slug: string }> }
  return competitions.some((c) => c.slug === 'piloto')
}

describe('ADMIN_GOOGLE_SUB definido', () => {
  it('conta com o e-mail certo e o sub errado não é admin em nenhuma rota de admin', async () => {
    const { request } = fixture({ ADMIN_GOOGLE_SUB: SUB_CERTO }, { providerId: SUB_ERRADO })

    expect((await request('/metrics/overview')).status).toBe(403)
    expect((await request('/metrics/radar')).status).toBe(403)
    expect((await request('/matches/sync', 'POST', {})).status).toBe(403)
    expect((await request('/competitions/piloto/promote', 'POST')).status).toBe(403)
  })

  it('conta com o e-mail certo e o sub errado perde também o acesso a piloto do admin', async () => {
    const { request } = fixture({ ADMIN_GOOGLE_SUB: SUB_CERTO }, { providerId: SUB_ERRADO })

    expect(await seesPilot(await request('/competitions'))).toBe(false)
    expect((await request('/matches?competition_id=piloto')).status).toBe(404)
  })

  it('o sub certo em outro provedor não vale como sub do Google', async () => {
    const { request } = fixture(
      { ADMIN_GOOGLE_SUB: SUB_CERTO },
      { provider: 'github', providerId: SUB_CERTO },
    )

    expect((await request('/metrics/overview')).status).toBe(403)
    expect(await seesPilot(await request('/competitions'))).toBe(false)
  })

  it('conta com o e-mail e o sub certos é admin e vê o piloto', async () => {
    const { request } = fixture({ ADMIN_GOOGLE_SUB: SUB_CERTO })

    // Métricas: passa do gate de admin e para na configuração ausente da SQL API.
    expect((await request('/metrics/overview')).status).toBe(503)
    // Sync manual: passa do gate e para na validação do corpo.
    expect((await request('/matches/sync', 'POST', {})).status).toBe(400)
    expect(await seesPilot(await request('/competitions'))).toBe(true)
    expect((await request('/matches?competition_id=piloto')).status).toBe(200)
    expect((await request('/competitions/piloto/promote', 'POST')).status).toBe(200)
  })

  it('o sub com espaço ou quebra de linha no fim vale como o sub limpo', async () => {
    const { request } = fixture({ ADMIN_GOOGLE_SUB: `${SUB_CERTO}\n` })

    expect((await request('/metrics/overview')).status).toBe(503)
  })

  it('e-mail diferente do ADMIN_EMAIL não é admin mesmo com o sub certo', async () => {
    const { request } = fixture({ ADMIN_EMAIL: 'outro@example.test', ADMIN_GOOGLE_SUB: SUB_CERTO })

    expect((await request('/metrics/overview')).status).toBe(403)
  })
})

describe('ADMIN_GOOGLE_SUB ausente ou vazio', () => {
  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['só espaços', '   '],
  ])('mantém o comportamento de só e-mail (%s)', async (_nome, valor) => {
    const { request } = fixture({ ADMIN_GOOGLE_SUB: valor }, { providerId: SUB_ERRADO })

    expect((await request('/metrics/overview')).status).toBe(503)
    expect((await request('/matches/sync', 'POST', {})).status).toBe(400)
    expect(await seesPilot(await request('/competitions'))).toBe(true)
    expect((await request('/competitions/piloto/promote', 'POST')).status).toBe(200)
  })
})
