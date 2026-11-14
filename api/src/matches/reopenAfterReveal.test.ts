/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { syncFixtures } from './sync'

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const T0 = Date.now()
const KICKOFF = iso(T0 - 30 * 60_000) // O horário já revelou os palpites, sem confirmação de início pelo provedor.
const SEED_NOW = iso(T0 - 26 * 3600_000)
const SYNC_NOW = iso(T0)
const PLACEHOLDER = iso(T0 + 5 * 86400_000).slice(0, 10) + 'T00:00:00Z'
const LATER = iso(T0 + 3 * 3600_000)
const EXT_ID = 880042

function fdMatch(status: string, utcDate: string) {
  return {
    id: EXT_ID,
    utcDate,
    status,
    matchday: 7,
    stage: 'REGULAR_SEASON',
    group: null,
    homeTeam: {
      id: 11,
      name: 'Casa sintética',
      shortName: 'DHome',
      tla: 'DHO',
      crest: 'https://x/11.png',
    },
    awayTeam: {
      id: 12,
      name: 'Visitante sintético',
      shortName: 'DAway',
      tla: 'DAW',
      crest: 'https://x/12.png',
    },
    score: {
      winner: null,
      duration: 'REGULAR',
      fullTime: { home: null, away: null },
      halfTime: { home: null, away: null },
    },
  }
}

const open: DatabaseSync[] = []
afterEach(() => {
  for (const s of open.splice(0)) s.close()
  vi.unstubAllGlobals()
})

function world(provider: 'football-data' | 'espn') {
  const { sqlite, db } = createSqliteD1()
  open.push(sqlite)
  const sync = async (status: string, utcDate: string, now: string) => {
    const match = fdMatch(status, utcDate)
    const statuses: Record<string, string> = {
      TIMED: 'STATUS_SCHEDULED',
      POSTPONED: 'STATUS_POSTPONED',
      CANCELLED: 'STATUS_CANCELED',
    }
    const name = statuses[status]!
    const type = { name, state: status === 'TIMED' ? 'pre' : 'post', completed: false }
    const event = {
      id: String(EXT_ID),
      date: utcDate,
      season: { year: 2026, slug: '2026-27-portuguese-primeira-liga' },
      status: { type },
      competitions: [
        {
          date: utcDate,
          status: { type },
          competitors: [
            { homeAway: 'home', team: { id: '11', displayName: 'Casa sintética' } },
            { homeAway: 'away', team: { id: '12', displayName: 'Visitante sintético' } },
          ],
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          provider === 'espn'
            ? { events: [event] }
            : { competition: { id: 2013, name: 'Liga sintética', code: 'BSA' }, matches: [match] },
        ),
      ),
    )
    await syncFixtures({
      competitionCode: provider === 'espn' ? 'bra.2' : 'BSA',
      season: 2026,
      dates: [utcDate.slice(0, 10).replaceAll('-', '')],
      apiKey: 'dummy',
      db,
      now,
    })
  }
  const call = async (user: string, path: string, method = 'GET', body?: unknown) => {
    const token = await signJwt({ sub: user, email: `${user}@example.test` }, 'dummy-secret', 3600)
    const res = await worker.fetch(
      new Request(`https://test${path}`, {
        method,
        headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      {
        DB: db,
        JWT_SECRET: 'dummy-secret',
        BASE_URL: 'https://test',
        FRONTEND_URL: 'https://test',
      } as Env,
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
        props: {},
      } as unknown as ExecutionContext,
    )
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }
  const row = () =>
    sqlite.prepare('SELECT start_time, status, postponed, locked_at FROM matches').get() as Record<
      string,
      unknown
    >
  const pick = (user: string, group: string) =>
    sqlite
      .prepare(
        `SELECT predicted_home_score h, predicted_away_score a FROM predictions WHERE user_id=? AND group_id=?`,
      )
      .get(user, group)
  async function seed() {
    await sync('TIMED', KICKOFF, SEED_NOW)
    const m = sqlite.prepare('SELECT id, competition_id FROM matches').get() as {
      id: string
      competition_id: string
    }
    sqlite.exec(`UPDATE competitions SET visibility = 'public'`)
    sqlite.exec(
      `INSERT INTO users (id,email,provider,provider_id) VALUES ('ana','ana@example.test','google','ana'), ('bia','bia@example.test','google','bia')`,
    )
    sqlite
      .prepare(
        `INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code) VALUES ('g','Hidden',?,'bia','HIDD-ENGR'), ('src','AnaOther',?,'ana','ANAO-THER')`,
      )
      .run(m.competition_id, m.competition_id)
    sqlite.exec(
      `INSERT INTO group_members (id,group_id,user_id,role) VALUES ('gm1','g','bia','owner'), ('gm2','g','ana','member'), ('gm3','src','ana','owner')`,
    )
    sqlite
      .prepare(
        `INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score) VALUES ('pa','ana','g',?,0,0), ('pb','bia','g',?,3,1)`,
      )
      .run(m.id, m.id)
    return m.id
  }
  return { sqlite, sync, call, row, pick, seed }
}

describe.each(['football-data', 'espn'] as const)(
  'trava após revelação pelo sync %s',
  (provider) => {
    it.each(['POSTPONED', 'CANCELLED', 'TIMED'])(
      '%s mantém as três escritas recusadas',
      async (status) => {
        const w = world(provider)
        const id = await w.seed()
        const feed = await w.call('ana', '/predictions/group?group_id=g')
        expect(feed.status).toBe(200)
        expect(feed.body.predictions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              user_id: 'bia',
              match_id: id,
              predicted_home_score: 3,
              locked: 1,
            }),
          ]),
        )
        const payload = {
          group_id: 'g',
          match_id: id,
          predicted_home_score: 3,
          predicted_away_score: 1,
        }
        expect((await w.call('ana', '/predictions', 'PUT', payload)).status).toBe(422)
        w.sqlite
          .prepare(`INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
      VALUES ('ps','ana','src',?,3,1)`)
          .run(id)

        await w.sync(status, status === 'TIMED' ? LATER : PLACEHOLDER, SYNC_NOW)
        expect((await w.call('ana', '/predictions', 'PUT', payload)).status).toBe(422)
        const bulk = await w.call('ana', '/predictions/bulk', 'PUT', {
          group_id: 'g',
          predictions: [payload],
        })
        expect(bulk.status).toBe(200)
        expect(bulk.body.locked).toEqual([id])
        expect(bulk.body.saved).toEqual([])
        const replicate = await w.call('ana', '/predictions/replicate', 'POST', {
          source_group_id: 'src',
          target_group_ids: ['g'],
          match_ids: [id],
        })
        expect(replicate.status).toBe(200)
        expect(replicate.body.locked_matches).toEqual([id])
        expect(replicate.body.groups).toEqual([
          expect.objectContaining({ group_id: 'g', saved: 0, replaced: 0 }),
        ])
        expect(w.pick('ana', 'g')).toEqual({ h: 0, a: 0 })
        expect(w.row().locked_at).toBe(SYNC_NOW)
        const revealed = await w.call('ana', '/predictions/group?group_id=g')
        expect(revealed.body.predictions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ user_id: 'bia', match_id: id, locked: 1 }),
          ]),
        )
      },
    )
  },
)
