/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import type { EspnScoreboard, EspnScoreboardEvent } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { ESPN_PRIMARY_COMPETITIONS } from './espnSync'
import { discoverFixtures } from './fixtureDiscovery'

const handles: DatabaseSync[] = []
const codes = Object.keys(ESPN_PRIMARY_COMPETITIONS)
const JWT_SECRET = 'season-2027-test-secret'

afterEach(() => {
  handles.splice(0).forEach((sqlite) => sqlite.close())
  vi.unstubAllGlobals()
})

// Dados sintéticos para testar o contrato de importação. Não representam jogos reais de 2027.
function event(code: string, year = 2027): EspnScoreboardEvent {
  return {
    id: `synthetic-${code}-${year}`,
    date: `${year}-02-01T20:00:00Z`,
    season: { year, slug: 'first-round' },
    competitions: [
      {
        status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
        competitors: [
          {
            homeAway: 'home',
            score: '0',
            team: { id: 'synthetic-a', displayName: 'Time de teste A' },
          },
          {
            homeAway: 'away',
            score: '0',
            team: { id: 'synthetic-b', displayName: 'Time de teste B' },
          },
        ],
      },
    ],
  }
}

function stubBoard(board: (code: string) => EspnScoreboard) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const code = String(input).split('/soccer/')[1]?.split('/')[0] ?? ''
    return new Response(JSON.stringify(board(code)), {
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function fixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  // D1 serializa os batches. O adaptador SQLite assíncrono precisa da mesma fila
  // quando o discovery sincroniza várias competições em paralelo.
  const originalBatch = db.batch.bind(db)
  let pending = Promise.resolve()
  db.batch = async (statements) => {
    const previous = pending
    let release!: () => void
    pending = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await originalBatch(statements)
    } finally {
      release()
    }
  }
  sqlite.exec("UPDATE competitions SET status = 'finished' WHERE provider = 'football-data'")
  const env = {
    DB: db,
    JWT_SECRET,
    ADMIN_EMAIL: 'admin@test.com',
    PILOT_EMAILS: 'pilot@test.com',
  } as Env
  const tokens = {
    admin: await signJwt({ sub: 'admin', email: 'admin@test.com' }, JWT_SECRET, 3600),
    pilot: await signJwt({ sub: 'pilot', email: 'pilot@test.com' }, JWT_SECRET, 3600),
    ordinary: await signJwt({ sub: 'ordinary', email: 'ordinary@test.com' }, JWT_SECRET, 3600),
  }
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext
  const request = (path: string, user: keyof typeof tokens = 'admin', body?: unknown) =>
    worker.fetch(
      new Request(`https://api.palpitae.com${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Cookie: `session=${tokens[user]}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      ctx,
    )
  return { sqlite, db, request }
}

describe('preparação das temporadas ESPN 2027', () => {
  it.each(codes)(
    '%s exige ano explícito do evento antes de cadastrar temporada, time ou jogo',
    async (code) => {
      const { sqlite, request } = await fixture()
      const before = sqlite.prepare('SELECT * FROM competitions ORDER BY id').all()
      const withoutYear = event(code)
      delete withoutYear.season?.year
      const wrongYear = event(code, 2026)
      const stringYear = event(code)
      // Simula payload externo fora do contrato TypeScript.
      Object.assign(stringYear.season!, { year: '2027' })
      const boards: EspnScoreboard[] = [
        { leagues: [{ season: { year: 2026 } }], events: [] },
        { leagues: [{ season: { year: 2027 } }], events: [wrongYear, withoutYear, stringYear] },
      ]
      for (const board of boards) {
        stubBoard(() => board)
        const res = await request('/matches/sync', 'admin', {
          competition: code,
          season: 2027,
          dates: ['20270201'],
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({
          synced: { competitionId: '', matches: 0, teams: 0 },
        })
        expect(sqlite.prepare('SELECT * FROM competitions ORDER BY id').all()).toEqual(before)
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM teams').get()).toEqual({ n: 0 })
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM matches').get()).toEqual({ n: 0 })
      }
    },
  )

  it('sincroniza 2027 sem duplicar, preserva 2026 e promove apenas a competição escolhida pelo admin', async () => {
    const { sqlite, db, request } = await fixture()
    const before2026 = sqlite
      .prepare("SELECT * FROM competitions WHERE season = '2026' ORDER BY id")
      .all()
    const fetchMock = stubBoard((code) => ({ events: [event(code, 2026), event(code)] }))
    expect(
      (await request('/matches/sync', 'ordinary', { competition: codes[0], season: 2027 })).status,
    ).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()

    for (const code of codes) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await request('/matches/sync', 'admin', {
          competition: code,
          season: 2027,
          dates: ['20270201'],
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ synced: { matches: 1, teams: 2 } })
      }
    }
    const seasons = sqlite
      .prepare(
        "SELECT slug, status, type, visibility FROM competitions WHERE season = '2027' ORDER BY slug",
      )
      .all()
    expect(seasons).toHaveLength(3)
    expect(
      seasons.every(
        (row) => row.status === 'upcoming' && row.type === 'cup' && row.visibility === 'pilot',
      ),
    ).toBe(true)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM teams').get()).toEqual({ n: 2 })
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM matches').get()).toEqual({ n: 3 })
    expect(
      sqlite.prepare("SELECT * FROM competitions WHERE season = '2026' ORDER BY id").all(),
    ).toEqual(before2026)

    await discoverFixtures(db, '')
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM matches').get()).toEqual({ n: 6 })
    expect(
      sqlite.prepare("SELECT * FROM competitions WHERE season = '2026' ORDER BY id").all(),
    ).toEqual(before2026)

    const list = async (user: 'ordinary' | 'pilot') => {
      const res = await request('/competitions', user)
      expect(res.status).toBe(200)
      return ((await res.json()) as { competitions: { slug: string }[] }).competitions.map(
        (c) => c.slug,
      )
    }
    for (const row of seasons) {
      expect(await list('pilot')).toContain(row.slug)
      expect(await list('ordinary')).not.toContain(row.slug)
    }
    const slug = String(seasons[0].slug)
    expect((await request(`/competitions/${slug}/promote`, 'pilot', {})).status).toBe(403)
    expect((await request(`/competitions/${slug}/promote`, 'admin', {})).status).toBe(200)
    expect(await list('ordinary')).toContain(slug)
    for (const row of seasons.slice(1)) expect(await list('ordinary')).not.toContain(row.slug)
    await discoverFixtures(db, '')
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM matches').get()).toEqual({ n: 6 })
    expect(sqlite.prepare('SELECT visibility FROM competitions WHERE slug = ?').get(slug)).toEqual({
      visibility: 'public',
    })
  })
})
