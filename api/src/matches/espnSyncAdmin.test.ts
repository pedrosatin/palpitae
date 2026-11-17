/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import template from '../providers/__fixtures__/espn-conmebol-sudamericana-scoreboard.json'
import type { EspnScoreboardEvent } from '../providers/espn'
import { resetEspnClientForTests, setEspnMinIntervalForTests } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

/**
 * Sync administrativo de uma competição ESPN (`POST /matches/sync`) com o
 * orçamento compartilhado (ADR-027): a recusa do acesso e a falha parcial viram
 * pendência na fila durável, e a resposta diz isso em vez de falhar.
 */

const ADMIN_EMAIL = 'admin@example.test'
const handles: DatabaseSync[] = []

beforeEach(() => {
  resetEspnClientForTests()
  setEspnMinIntervalForTests(0)
})

afterEach(() => {
  handles.splice(0).forEach((sqlite) => sqlite.close())
  vi.unstubAllGlobals()
  resetEspnClientForTests()
})

function board(id: string, date: string): EspnScoreboardEvent {
  const event = structuredClone(template.events[0]) as EspnScoreboardEvent
  event.id = id
  event.date = date
  event.season = { year: 2026, slug: 'semifinals' }
  return event
}

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    DELETE FROM competitions;
    INSERT INTO users (id,email,provider,provider_id) VALUES ('u1','${ADMIN_EMAIL}','google','sub-1');
    INSERT INTO profiles (user_id,nickname) VALUES ('u1','Admin');
  `)
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    ADMIN_EMAIL,
  } as Env
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext
  const sync = async (body: unknown) => {
    const token = await signJwt({ sub: 'u1', email: ADMIN_EMAIL, jti: 'j1' }, env.JWT_SECRET, 3600)
    return worker.fetch(
      new Request('https://api.palpitae.com.br/matches/sync', {
        method: 'POST',
        headers: {
          Cookie: `session=${token}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.1',
        },
        body: JSON.stringify(body),
      }),
      env,
      ctx,
    )
  }
  return { sqlite, sync }
}

const workRows = (sqlite: DatabaseSync) =>
  sqlite
    .prepare(
      "SELECT kind, round, status, attempts FROM provider_work WHERE provider = 'espn' ORDER BY round",
    )
    .all()

describe('POST /matches/sync de competição ESPN', () => {
  it('403: responde pendente, adia as datas na fila e não chama a ESPN dentro do bloqueio', async () => {
    const { sqlite, sync } = setup()
    const fetchMock = vi.fn(async () => new Response('{}', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    const body = {
      competition: 'conmebol.sudamericana',
      season: 2026,
      dates: ['20261014', '20261015'],
    }

    const first = await sync(body)
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ ok: true, pending: true })
    expect(workRows(sqlite)).toEqual([
      { kind: 'manual', round: '20261014', status: 'pending', attempts: 0 },
      { kind: 'manual', round: '20261015', status: 'pending', attempts: 0 },
    ])

    // Segundo pedido, dentro do bloqueio de 15 min: nenhum request novo.
    const second = await sync(body)
    expect(await second.json()).toMatchObject({ ok: true, pending: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falha parcial: grava a data que chegou e devolve a que ficou pendente', async () => {
    const { sqlite, sync } = setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const date = new URL(String(input)).searchParams.get('dates')
        return date === '20261014'
          ? Response.json({ events: [board('espn-1', '2026-10-14T22:00:00Z')] })
          : new Response('{}', { status: 503 })
      }),
    )

    const response = await sync({
      competition: 'conmebol.sudamericana',
      season: 2026,
      dates: ['20261014', '20261015'],
    })

    expect(await response.json()).toMatchObject({
      ok: true,
      pending: true,
      pendingDates: ['20261015'],
      synced: { matches: 1 },
    })
    expect(sqlite.prepare('SELECT external_id FROM matches').all()).toEqual([
      { external_id: 'espn-1' },
    ])
    expect(workRows(sqlite)).toEqual([
      { kind: 'manual', round: '20261015', status: 'pending', attempts: 0 },
    ])
  })

  it('sem falha, a resposta é a de sempre e nada fica na fila', async () => {
    const { sqlite, sync } = setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ events: [board('espn-1', '2026-10-14T22:00:00Z')] })),
    )

    const response = await sync({
      competition: 'conmebol.sudamericana',
      season: 2026,
      dates: ['20261014'],
    })

    const json = (await response.json()) as Record<string, unknown>
    expect(json).toMatchObject({ ok: true, synced: { matches: 1 } })
    expect(json.pending).toBeUndefined()
    expect(workRows(sqlite)).toEqual([])
  })
})
