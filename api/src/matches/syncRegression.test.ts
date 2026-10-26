import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { syncFixtures } from './sync'
import { pollActiveMatches } from './poller'

afterEach(() => vi.unstubAllGlobals())

function fixture(status: string, home: number | null, away: number | null) {
  return {
    id: 555050,
    utcDate: '2026-10-24T22:30:00Z',
    status,
    matchday: 32,
    stage: 'REGULAR_SEASON',
    group: null,
    homeTeam: { id: 1, name: 'Chapecoense AF', shortName: 'Chapecoense', tla: 'CHA' },
    awayTeam: { id: 2, name: 'Fluminense FC', shortName: 'Fluminense', tla: 'FLU' },
    score: { duration: 'REGULAR', fullTime: { home, away } },
  }
}

function respond(match: ReturnType<typeof fixture>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            competition: { id: 2013, code: 'BSA', name: 'Campeonato Brasileiro Série A' },
            matches: [match],
          }),
          { status: 200 },
        ),
    ),
  )
}

describe('football-data result regression', () => {
  it('recovers and scores a pending result after HTTP 200, then preserves it on the next primary sync', async () => {
    const { sqlite, db } = createSqliteD1()
    try {
      const options = { competitionCode: 'BSA', season: 2026, db, apiKey: 'test' }
      const pending = fixture('TIMED', 0, 0)
      respond(pending)
      await syncFixtures(options)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request) => {
          const url = new URL(String(input))
          if (url.hostname === 'api.football-data.org') {
            return new Response(
              JSON.stringify({
                competition: { id: 2013, code: 'BSA', name: 'Campeonato Brasileiro Série A' },
                matches: [pending],
              }),
            )
          }
          expect(url.hostname).toBe('site.api.espn.com')
          const events =
            url.searchParams.get('dates') === '20261024'
              ? [
                  {
                    date: pending.utcDate,
                    status: { type: { state: 'post' } },
                    competitions: [
                      {
                        competitors: [
                          { homeAway: 'home', team: { displayName: 'Chapecoense' }, score: '2' },
                          { homeAway: 'away', team: { displayName: 'Fluminense' }, score: '1' },
                        ],
                      },
                    ],
                  },
                ]
              : []
          return new Response(JSON.stringify({ events }))
        }),
      )
      await pollActiveMatches(
        db,
        'test',
        undefined,
        Date.parse(pending.utcDate) + 10 * 60 * 60 * 1000,
      )
      const final = sqlite
        .prepare('SELECT status,home_score,away_score,scored_at FROM matches')
        .get()
      expect(final).toMatchObject({
        status: 'finished',
        home_score: 2,
        away_score: 1,
        scored_at: expect.any(String),
      })
      respond(pending)
      await syncFixtures(options)
      expect(
        sqlite.prepare('SELECT status,home_score,away_score,scored_at FROM matches').get(),
      ).toEqual(final)
    } finally {
      sqlite.close()
    }
  })

  it.each(['TIMED', 'IN_PLAY', 'SUSPENDED', 'POSTPONED'])(
    'preserves the entire scored final when a later sync returns %s',
    async (status) => {
      const { sqlite, db } = createSqliteD1()
      try {
        const options = { competitionCode: 'BSA', season: 2026, db, apiKey: 'test' }
        respond(fixture('FINISHED', 2, 1))
        await syncFixtures(options)
        sqlite.exec("UPDATE matches SET scored_at = '2026-10-25T08:30:32Z'")
        const before = sqlite.prepare('SELECT * FROM matches').get()

        const stale = fixture(status, 0, 0)
        stale.utcDate = '2026-10-25T01:00:00Z'
        respond(stale)
        await syncFixtures(options)

        expect(sqlite.prepare('SELECT * FROM matches').get()).toEqual(before)
      } finally {
        sqlite.close()
      }
    },
  )

  it('still accepts final score corrections and clears scored_at for recalculation', async () => {
    const { sqlite, db } = createSqliteD1()
    try {
      const options = { competitionCode: 'BSA', season: 2026, db, apiKey: 'test' }
      respond(fixture('FINISHED', 2, 1))
      await syncFixtures(options)
      sqlite.exec("UPDATE matches SET scored_at = '2026-10-25T08:30:32Z'")
      respond(fixture('FINISHED', 3, 1))
      await syncFixtures(options)
      expect(
        sqlite.prepare('SELECT status,home_score,away_score,scored_at FROM matches').get(),
      ).toEqual({ status: 'finished', home_score: 3, away_score: 1, scored_at: null })
    } finally {
      sqlite.close()
    }
  })

  it('continues updating kickoff and partial scores before the final result', async () => {
    const { sqlite, db } = createSqliteD1()
    try {
      const options = { competitionCode: 'BSA', season: 2026, db, apiKey: 'test' }
      respond(fixture('TIMED', null, null))
      await syncFixtures(options)
      const live = fixture('IN_PLAY', 1, 0)
      live.utcDate = '2026-10-24T23:00:00Z'
      respond(live)
      await syncFixtures(options)
      expect(sqlite.prepare('SELECT start_time,home_score,away_score FROM matches').get()).toEqual({
        start_time: live.utcDate,
        home_score: 1,
        away_score: 0,
      })
    } finally {
      sqlite.close()
    }
  })
})
