/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import type { Env } from '../types'
import { bucketKey, DAILY_BUCKET_ROWS_WRITTEN_PER_ROW } from './limits'
import { reportD1Rows, type ReportedRows } from '../testing/d1RowsReported'
import { createSqliteD1 } from '../testing/sqliteD1'

// Orçamento diário de linhas do D1 por usuário (ADR-022), pela API inteira. O D1 de
// teste informa em cada consulta as linhas que `rows` mandar.

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i
const LIMITER_SQL = /request_limits/

const PREDICTION = {
  group_id: 'group',
  match_id: 'future',
  predicted_home_score: 1,
  predicted_away_score: 0,
}

async function fixture(vars: Partial<Env> = {}) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES
      ('heavy','heavy@example.com','google','1'),
      ('light','light@example.com','google','2');
    INSERT INTO profiles (user_id,nickname) VALUES ('heavy','Heavy'),('light','Light');
    INSERT INTO competitions (id,name,slug,status,penalty_phases)
      VALUES ('competition','League','test-league','ongoing','[]');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code)
      VALUES ('group','Group','competition','heavy','ABCD-EFGH');
    INSERT INTO group_members (id,group_id,user_id,role)
      VALUES ('gm1','group','heavy','owner'),('gm2','group','light','member');
    INSERT INTO teams (id,name,slug) VALUES ('home','Home','home'),('away','Away','away');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round)
      VALUES ('future','competition','1','football-data','home','away','2099-01-01T00:00:00Z','scheduled','1');
  `)
  // Linhas que cada consulta informa. O teste troca no meio do caminho. Com
  // `limiter`, as consultas a `request_limits` informam esse valor.
  const rows = {
    read: 1,
    written: 1,
    limiter: null as ReportedRows | null,
    failOn: null as RegExp | null,
    beforePrepare: null as ((sql: string) => void) | null,
  }
  const reported = reportD1Rows(
    db,
    (sql): ReportedRows =>
      (LIMITER_SQL.test(sql) && rows.limiter) || {
        rows_read: rows.read,
        rows_written: WRITE_SQL.test(sql) ? rows.written : 0,
      },
  )
  // Consultas que casam com `rows.failOn` falham como um D1 fora do ar.
  const DB = new Proxy(reported, {
    get(target, prop) {
      if (prop === 'prepare') {
        return (sql: string) => {
          rows.beforePrepare?.(sql)
          return rows.failOn?.test(sql) ? unavailable() : target.prepare(sql)
        }
      }
      return Reflect.get(target, prop, target)
    },
  })
  const env = {
    DB,
    JWT_SECRET: 'test-secret',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    ...vars,
  } as Env
  // Validade de 3 dias: o teste avança o relógio até o dia seguinte.
  const tokens = Object.fromEntries(
    await Promise.all(
      ['heavy', 'light'].map(async (id) => [
        id,
        await signJwt(
          { sub: id, email: `${id}@example.com`, jti: crypto.randomUUID() },
          env.JWT_SECRET,
          3 * 86400,
        ),
      ]),
    ),
  )
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext
  const request = (path: string, user: string, method = 'GET', body?: unknown) =>
    worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        method,
        headers: {
          Cookie: `session=${tokens[user]}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.1',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      ctx,
    )
  // Repete a requisição até a primeira recusa, com teto para não girar à toa.
  const untilRefused = async (
    path: string,
    user: string,
    max = 20,
    method = 'GET',
    body?: unknown,
  ) => {
    for (let i = 1; i <= max; i++) {
      const response = await request(path, user, method, body)
      if (response.status === 429) return { response, attempts: i }
      expect(response.status).toBe(200)
    }
    return { response: null, attempts: max }
  }
  // Valor gravado hoje no balde diário do usuário, ou undefined sem linha.
  const dailyHits = async (user: string, kind: 'read' | 'written') => {
    const key = await bucketKey(env.JWT_SECRET, `d1_${kind}:user:${user}`)
    const row = sqlite.prepare('SELECT hits FROM request_limits WHERE bucket_key = ?').get(key) as
      | { hits: number }
      | undefined
    return row?.hits
  }
  return { sqlite, env, rows, request, untilRefused, dailyHits }
}

function unavailable(): D1PreparedStatement {
  const reject = () => Promise.reject(new Error('D1_ERROR: storage unavailable'))
  const statement = { bind: () => statement, first: reject, all: reject, run: reject, raw: reject }
  return statement as unknown as D1PreparedStatement
}

function freezeAt(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

describe('orçamento diário de linhas do D1 por usuário', () => {
  it('recusa com 429 o usuário que passou de 250 mil linhas lidas, sem afetar outro, e libera no dia seguinte', async () => {
    freezeAt('2026-11-13T23:50:00Z')
    const { rows, request, untilRefused } = await fixture()
    rows.read = 40_000

    const refused = await untilRefused('/auth/me', 'heavy')
    expect(refused.response?.status).toBe(429)
    // Cada requisição faz várias consultas, então o corte vem em poucas requisições.
    expect(refused.attempts).toBeGreaterThan(1)
    expect(refused.response?.headers.get('Retry-After')).toBe(String(10 * 60))
    const body = (await refused.response?.json()) as { error: string }
    expect(body.error).toMatch(/limite diário/i)

    // Outro usuário segue normal.
    expect((await request('/auth/me', 'light')).status).toBe(200)

    // A recusa continua até a virada e some à 00:00 UTC.
    vi.setSystemTime(new Date('2026-11-13T23:59:59Z'))
    expect((await request('/auth/me', 'heavy')).status).toBe(429)
    vi.setSystemTime(new Date('2026-11-14T00:00:00Z'))
    rows.read = 1
    expect((await request('/auth/me', 'heavy')).status).toBe(200)
  })

  it('responde Retry-After até a virada medido no mesmo instante da checagem', async () => {
    freezeAt('2026-11-13T23:50:00Z')
    const { rows, request, untilRefused } = await fixture()
    rows.read = 40_000
    expect((await untilRefused('/auth/me', 'heavy')).response?.status).toBe(429)

    // O relógio cruza a meia-noite enquanto o limitador lê o balde do dia.
    vi.setSystemTime(new Date('2026-11-13T23:59:59Z'))
    rows.beforePrepare = (sql) => {
      if (/^\s*SELECT bucket_key, hits FROM request_limits/.test(sql)) {
        vi.setSystemTime(new Date('2026-11-14T00:00:00Z'))
      }
    }
    const refused = await request('/auth/me', 'heavy')
    expect(refused.status).toBe(429)
    expect(refused.headers.get('Retry-After')).toBe('1')
  })

  it('recusa com 429 o usuário que passou de 5 mil linhas escritas', async () => {
    freezeAt('2026-11-13T12:00:00Z')
    const { rows, request, untilRefused } = await fixture()
    rows.written = 2_000

    const refused = await untilRefused('/predictions', 'heavy', 20, 'PUT', PREDICTION)
    expect(refused.response?.status).toBe(429)
    expect(refused.response?.headers.get('Retry-After')).toBe(String(12 * 3600))
    expect((await request('/auth/me', 'light')).status).toBe(200)
  })

  it('usa os limites das variáveis de ambiente e volta ao padrão com valor inválido', async () => {
    freezeAt('2026-11-13T12:00:00Z')
    const configured = await fixture({ D1_DAILY_ROWS_READ_PER_USER: '50' } as Partial<Env>)
    configured.rows.read = 10
    expect((await configured.untilRefused('/auth/me', 'heavy')).response?.status).toBe(429)

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const invalid = await fixture({ D1_DAILY_ROWS_READ_PER_USER: '50mil' } as Partial<Env>)
    invalid.rows.read = 10
    // Com o padrão de 250 mil, dez requisições de poucas dezenas de linhas passam.
    expect((await invalid.untilRefused('/auth/me', 'heavy', 10)).response).toBeNull()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('D1_DAILY_ROWS_READ_PER_USER'))
  })

  it('deixa o usuário sem orçamento sair da conta', async () => {
    freezeAt('2026-11-13T12:00:00Z')
    const { rows, request, untilRefused } = await fixture()
    rows.read = 100_000
    expect((await untilRefused('/auth/me', 'heavy')).response?.status).toBe(429)

    expect((await request('/auth/logout', 'heavy', 'POST')).status).toBe(200)
  })

  it('com o balde indisponível, deixa a leitura passar e recusa a escrita', async () => {
    freezeAt('2026-11-13T12:00:00Z')
    const { rows, request } = await fixture()
    rows.failOn = /request_limits/

    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await request('/auth/me', 'heavy')).status).toBe(200)
    const write = await request('/predictions', 'heavy', 'PUT', PREDICTION)
    expect(write.status).toBe(503)
  })
})

describe('linhas que o balde diário grava', () => {
  it('GET só de leitura não grava a linha de escrita nem gasta o orçamento de escrita', async () => {
    freezeAt('2026-11-13T12:00:00Z')
    const { rows, request, dailyHits } = await fixture({
      D1_DAILY_ROWS_WRITTEN_PER_USER: '3',
    } as Partial<Env>)
    rows.written = 1

    for (let i = 0; i < 10; i++) expect((await request('/auth/me', 'heavy')).status).toBe(200)

    expect(await dailyHits('heavy', 'written')).toBeUndefined()
    expect(await dailyHits('heavy', 'read')).toBeGreaterThan(0)
  })

  it('as consultas do próprio limitador ficam fora da medição', async () => {
    freezeAt('2026-11-13T12:00:00Z')
    const { rows, request, dailyHits } = await fixture()
    rows.limiter = { rows_read: 10_000, rows_written: 10_000 }

    expect((await request('/auth/me', 'heavy')).status).toBe(200)
    expect((await request('/auth/me', 'heavy')).status).toBe(200)

    // A sessão e o handler informam 1 linha por consulta, bem menos que 10 mil.
    expect(await dailyHits('heavy', 'read')).toBeLessThan(10_000)
    expect(await dailyHits('heavy', 'written')).toBeUndefined()
  })

  it('requisição que só escreve grava só a linha de escrita, com o custo da gravação', async () => {
    freezeAt('2026-11-13T12:00:00Z')
    const { rows, request, dailyHits } = await fixture()
    rows.read = 0
    rows.written = 3

    expect((await request('/predictions', 'heavy', 'PUT', PREDICTION)).status).toBe(200)

    expect(await dailyHits('heavy', 'read')).toBeUndefined()
    const written = (await dailyHits('heavy', 'written')) ?? 0
    expect(written).toBeGreaterThanOrEqual(3 + DAILY_BUCKET_ROWS_WRITTEN_PER_ROW)
    expect((written - DAILY_BUCKET_ROWS_WRITTEN_PER_ROW) % 3).toBe(0)
  })

  it('requisição que lê e escreve grava as duas linhas, com o custo das duas gravações', async () => {
    freezeAt('2026-11-13T12:00:00Z')
    const { rows, request, dailyHits } = await fixture()
    rows.read = 1
    rows.written = 3

    expect((await request('/predictions', 'heavy', 'PUT', PREDICTION)).status).toBe(200)

    expect(await dailyHits('heavy', 'read')).toBeGreaterThan(0)
    const written = (await dailyHits('heavy', 'written')) ?? 0
    expect((written - 2 * DAILY_BUCKET_ROWS_WRITTEN_PER_ROW) % 3).toBe(0)
    expect(written).toBeGreaterThanOrEqual(3 + 2 * DAILY_BUCKET_ROWS_WRITTEN_PER_ROW)
  })
})
