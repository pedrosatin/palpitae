import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncFixtures } from './sync'

// ---------------------------------------------------------------------------
// Fake D1 that records the bind() args of every INSERT and serves the two
// SELECT id lookups (competition + teams) sync.ts depends on. We don't run real
// SQLite, so the ON CONFLICT clause (scored_at reset) isn't *executed* here — it
// is covered by a SQL-shape assertion below. Everything sync.ts computes in JS
// (canonical score, penalty mapping, translation/slug) IS exercised end to end.
// ---------------------------------------------------------------------------

type Captured = {
  competition: unknown[][]
  teams: unknown[][]
  matches: unknown[][]
}

function buildFakeDb() {
  const captured: Captured = { competition: [], teams: [], matches: [] }
  const sqls = { match: '' as string }

  const db = {
    async batch(statements: any[]) {
      for (const stmt of statements) {
        await stmt.run()
      }
    },
    prepare(sql: string) {
      let bound: unknown[] = []
      const stmt = {
        bind(...args: unknown[]) {
          bound = args
          return stmt
        },
        async run() {
          if (sql.includes('INSERT INTO competitions')) captured.competition.push(bound)
          else if (sql.includes('INSERT INTO teams')) captured.teams.push(bound)
          else if (sql.includes('INSERT INTO matches')) {
            captured.matches.push(bound)
            sqls.match = sql
          }
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('SELECT id FROM competitions')) return { id: 'comp-1' } as T
          return null
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (sql.includes('SELECT external_id, id FROM teams')) {
            if (sql.includes('json_each')) {
              const ids = JSON.parse(bound[0] as string)
              const results = ids.map((extId: string) => ({
                external_id: extId,
                id: `team-${extId}`,
              }))
              return { results } as { results: T[] }
            } else {
              // bound = [...extIds, PROVIDER]
              const ids = bound.slice(0, bound.length - 1) as string[]
              const results = ids.map((extId) => ({
                external_id: extId,
                id: `team-${extId}`,
              }))
              return { results } as { results: T[] }
            }
          }
          return { results: [] }
        },
      }
      return stmt
    },
  }

  return { db: db as never, captured, sqls }
}

// Minimal football-data team/match factories.
function team(id: number, name: string, tla: string) {
  return { id, name, shortName: name, tla, crest: `https://x/${id}.png` }
}

type ScoreOverrides = Partial<{
  winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null
  duration: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT' | null
  fullTime: { home: number | null; away: number | null }
  regularTime: { home: number | null; away: number | null }
  extraTime: { home: number | null; away: number | null }
  penalties: { home: number | null; away: number | null }
}>

function match(id: number, score: ScoreOverrides, stage = 'FINAL') {
  return {
    id,
    utcDate: '2026-07-19T19:00:00Z',
    status: 'FINISHED',
    matchday: null,
    stage,
    group: null,
    homeTeam: team(1, 'Brazil', 'BRA'),
    awayTeam: team(2, 'Argentina', 'ARG'),
    score: {
      winner: null,
      duration: 'REGULAR',
      fullTime: { home: null, away: null },
      halfTime: { home: null, away: null },
      ...score,
    },
  }
}

function mockFetch(matches: unknown[], compName = 'FIFA World Cup') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          competition: { id: 2000, name: compName, code: 'WC' },
          matches,
        }
      },
      async text() {
        return ''
      },
    })),
  )
}

// Match INSERT bind order (sync.ts):
// 0 id  1 competition_id  2 external_id  3 provider  4 home_team_id
// 5 away_team_id  6 start_time  7 status  8 home_score(canonical)
// 9 away_score(canonical)  10 phase  11 round  12 group_name  13 duration
// 14 penalty_winner  15 home_penalty_goals  16 away_penalty_goals
const HOME = 8
const AWAY = 9
const DURATION = 13
const PEN_WINNER = 14
const PEN_HOME = 15
const PEN_AWAY = 16

afterEach(() => vi.unstubAllGlobals())

describe('syncFixtures — canonical score & penalty mapping', () => {
  it('PENALTY_SHOOTOUT: canonical = regularTime + extraTime, NOT fullTime (which includes penalty goals)', async () => {
    // Regression for the football-data fullTime bug: in a shootout, fullTime
    // (4-3) carries the penalty goals; the canonical draw is reg+ET = 1-1.
    mockFetch([
      match(101, {
        winner: 'HOME_TEAM',
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 4, away: 3 },
        regularTime: { home: 1, away: 1 },
        extraTime: { home: 0, away: 0 },
        penalties: { home: 3, away: 2 },
      }),
    ])
    const { db, captured } = buildFakeDb()
    await syncFixtures({ competitionCode: 'WC', season: 2026, apiKey: 'k', db })

    const row = captured.matches[0]
    expect(row[HOME]).toBe(1)
    expect(row[AWAY]).toBe(1)
    expect(row[DURATION]).toBe('PENALTY_SHOOTOUT')
    expect(row[PEN_WINNER]).toBe('home')
    expect(row[PEN_HOME]).toBe(3)
    expect(row[PEN_AWAY]).toBe(2)
  })

  it('PENALTY_SHOOTOUT with ET goals: canonical derives from fullTime (which includes penalties here)', async () => {
    mockFetch([
      match(102, {
        winner: 'AWAY_TEAM',
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 5, away: 6 },
        regularTime: { home: 1, away: 1 },
        extraTime: { home: 1, away: 1 },
        penalties: { home: 3, away: 4 },
      }),
    ])
    const { db, captured } = buildFakeDb()
    await syncFixtures({ competitionCode: 'WC', season: 2026, apiKey: 'k', db })

    const row = captured.matches[0]
    expect(row[HOME]).toBe(2) // 5 - 3
    expect(row[AWAY]).toBe(2) // 6 - 4
    expect(row[PEN_WINNER]).toBe('away')
    expect(row[PEN_HOME]).toBe(3)
    expect(row[PEN_AWAY]).toBe(4)
  })

  it('PENALTY_SHOOTOUT without regularTime/extraTime: canonical score derives from fullTime correctly', async () => {
    mockFetch([
      match(110, {
        winner: 'HOME_TEAM',
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 5, away: 4 }, // Includes penalties (2-2 + 3-2 penalties)
        regularTime: { home: null, away: null }, // Missing from upstream
        extraTime: { home: null, away: null }, // Missing from upstream
        penalties: { home: 3, away: 2 },
      }),
      match(111, {
        winner: 'HOME_TEAM',
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 2, away: 2 }, // Does NOT include penalties
        regularTime: { home: null, away: null },
        extraTime: { home: null, away: null },
        penalties: { home: 3, away: 2 },
      }),
    ])
    const { db, captured } = buildFakeDb()
    await syncFixtures({ competitionCode: 'WC', season: 2026, apiKey: 'k', db })

    // Match 110: fullTime includes penalties
    expect(captured.matches[0][HOME]).toBe(2) // 5 - 3
    expect(captured.matches[0][AWAY]).toBe(2) // 4 - 2

    // Match 111: fullTime does NOT include penalties
    expect(captured.matches[1][HOME]).toBe(2) // Kept as 2
    expect(captured.matches[1][AWAY]).toBe(2) // Kept as 2
  })

  it('PENALTY_SHOOTOUT: regularTime wins over fullTime heuristic when fullTime is inconsistent (AUS -1 / EGI 1 bug)', async () => {
    // Regression: football-data sent fullTime={home:1,away:2} for an actual 1-1 draw
    // that went to penalties (e.g. AUS vs EGY). The old heuristic subtracted the
    // penalty goals from fullTime and produced canonicalHome=-1. The fix: when
    // regularTime is available it is the authoritative canonical score.
    mockFetch([
      match(112, {
        winner: 'AWAY_TEAM',
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 1, away: 2 }, // inconsistent from provider
        regularTime: { home: 1, away: 1 }, // authoritative: the actual draw
        extraTime: { home: 0, away: 0 }, // no extra time
        penalties: { home: 2, away: 1 }, // shootout (does not affect canonical)
      }),
    ])
    const { db, captured } = buildFakeDb()
    await syncFixtures({ competitionCode: 'WC', season: 2026, apiKey: 'k', db })

    const row = captured.matches[0]
    expect(row[HOME]).toBe(1) // must be 1, not -1
    expect(row[AWAY]).toBe(1) // must be 1, not  2
    expect(row[PEN_WINNER]).toBe('away')
  })

  it('PENALTY_SHOOTOUT with winner null: derives penalty_winner from penalties score, not fullTime', async () => {
    // Regression (Holanda x Marrocos em prod): o provider mandou winner=null e
    // fullTime = placar do tempo normal (empate). Derivar de fullTime devolvia null
    // e zerava o bônus de quem acertou o vencedor. A fonte canônica é score.penalties.
    mockFetch([
      match(109, {
        winner: null,
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 1, away: 1 },
        regularTime: { home: 1, away: 1 },
        extraTime: { home: 0, away: 0 },
        penalties: { home: 2, away: 4 },
      }),
    ])
    const { db, captured } = buildFakeDb()
    await syncFixtures({ competitionCode: 'WC', season: 2026, apiKey: 'k', db })

    const row = captured.matches[0]
    expect(row[HOME]).toBe(1)
    expect(row[AWAY]).toBe(1)
    expect(row[PEN_WINNER]).toBe('away') // Derived away from penalties home=2 < away=4
  })

  it('EXTRA_TIME (no shootout): canonical = fullTime, penalty fields null', async () => {
    mockFetch([
      match(103, {
        winner: 'HOME_TEAM',
        duration: 'EXTRA_TIME',
        fullTime: { home: 2, away: 1 },
        regularTime: { home: 1, away: 1 },
        extraTime: { home: 1, away: 0 },
      }),
    ])
    const { db, captured } = buildFakeDb()
    await syncFixtures({ competitionCode: 'WC', season: 2026, apiKey: 'k', db })

    const row = captured.matches[0]
    expect(row[HOME]).toBe(2)
    expect(row[AWAY]).toBe(1)
    expect(row[DURATION]).toBe('EXTRA_TIME')
    expect(row[PEN_WINNER]).toBeNull()
    expect(row[PEN_HOME]).toBeNull()
    expect(row[PEN_AWAY]).toBeNull()
  })

  it('REGULAR match with a winner does NOT set penalty_winner (score.winner is the regular-time winner)', async () => {
    // Guard: score.winner is populated on plain wins too; penalty_winner must
    // stay null unless duration === PENALTY_SHOOTOUT.
    mockFetch([
      match(104, {
        winner: 'HOME_TEAM',
        duration: 'REGULAR',
        fullTime: { home: 2, away: 0 },
      }),
    ])
    const { db, captured } = buildFakeDb()
    await syncFixtures({ competitionCode: 'WC', season: 2026, apiKey: 'k', db })

    const row = captured.matches[0]
    expect(row[HOME]).toBe(2)
    expect(row[AWAY]).toBe(0)
    expect(row[DURATION]).toBe('REGULAR')
    expect(row[PEN_WINNER]).toBeNull()
    expect(row[PEN_HOME]).toBeNull()
    expect(row[PEN_AWAY]).toBeNull()
  })

  it('scheduled match (no scores yet): canonical home/away null, penalty fields null', async () => {
    const m = match(105, {
      winner: null,
      duration: null,
      fullTime: { home: null, away: null },
    })
    m.status = 'SCHEDULED'
    mockFetch([m])
    const { db, captured } = buildFakeDb()
    await syncFixtures({ competitionCode: 'WC', season: 2026, apiKey: 'k', db })

    const row = captured.matches[0]
    expect(row[HOME]).toBeNull()
    expect(row[AWAY]).toBeNull()
    expect(row[PEN_WINNER]).toBeNull()
  })
})

describe('syncFixtures — upsert preserves scored_at reset on penalty_winner change', () => {
  it('matches upsert clears scored_at when penalty_winner changes (re-score guard)', async () => {
    mockFetch([
      match(106, {
        winner: 'HOME_TEAM',
        duration: 'PENALTY_SHOOTOUT',
        regularTime: { home: 0, away: 0 },
        extraTime: { home: 0, away: 0 },
        penalties: { home: 4, away: 2 },
      }),
    ])
    const { db, sqls } = buildFakeDb()
    await syncFixtures({ competitionCode: 'WC', season: 2026, apiKey: 'k', db })

    // The ON CONFLICT clause must reset scored_at on a penalty_winner correction
    // so scoreUnprocessedMatches re-runs the penalty bonus. (Pure SQL — asserted
    // by shape since the fake DB doesn't execute SQLite.)
    expect(sqls.match).toContain('scored_at')
    expect(sqls.match).toContain('matches.penalty_winner IS NOT excluded.penalty_winner')
  })
})

describe('syncFixtures — competition translation & stable slug (Decision 7/8)', () => {
  it('translates the display name but derives the slug from the RAW api name', async () => {
    mockFetch(
      [
        match(107, {
          winner: 'DRAW',
          duration: 'REGULAR',
          fullTime: { home: 0, away: 0 },
        }),
      ],
      'FIFA World Cup',
    )
    const { db, captured } = buildFakeDb()
    await syncFixtures({ competitionCode: 'WC', season: 2026, apiKey: 'k', db })

    // competition INSERT bind order: [id, name, slug, external_id, provider, season]
    const comp = captured.competition[0]
    expect(comp[1]).toBe('Copa do Mundo FIFA') // fuzzy-translated display name
    expect(comp[2]).toBe('fifa-world-cup-2026') // slug from raw name, stays stable
  })
})
