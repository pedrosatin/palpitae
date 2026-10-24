/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import template from '../providers/__fixtures__/espn-conmebol-sudamericana-scoreboard.json'
import type { EspnScoreboardEvent } from '../providers/espn'
import {
  resetEspnClientForTests,
  setEspnMinIntervalForTests,
} from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import { ESPN_PRIMARY_COMPETITIONS, syncEspnFixtures } from './espnSync'
import { discoverFixtures } from './fixtureDiscovery'
import { pollActiveMatches } from './poller'

const handles: DatabaseSync[] = []
beforeEach(() => {
  resetEspnClientForTests()
  // Mantém exclusão mútua HTTP; zera só o sleep de 1,3s entre dezenas de mocks.
  setEspnMinIntervalForTests(0)
})
afterEach(() => {
  handles.splice(0).forEach((db) => db.close())
  vi.unstubAllGlobals()
  vi.useRealTimers()
  resetEspnClientForTests()
})
function database() {
  const result = createSqliteD1()
  handles.push(result.sqlite)
  result.sqlite.exec('DELETE FROM competitions')
  return result
}
function event(id: string, date: string, finished = false): EspnScoreboardEvent {
  const ev = structuredClone(template.events[0]) as EspnScoreboardEvent
  ev.id = id
  ev.date = date
  ev.season = { year: 2026, slug: 'semifinals' }
  ev.competitions![0].status = {
    type: {
      state: finished ? 'post' : 'pre',
      name: finished ? 'STATUS_FINAL' : 'STATUS_SCHEDULED',
    },
  }
  for (const c of ev.competitions![0].competitors!) c.score = finished ? '1' : undefined
  return ev
}
function feed(boards: Record<string, EspnScoreboardEvent[]>) {
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const date = new URL(String(input)).searchParams.get('dates') ?? ''
    return new Response(JSON.stringify({ events: boards[date] ?? [] }))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const queriedDates = (fetch: ReturnType<typeof feed>) =>
  fetch.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('dates'))

describe('cron ESPN com datas explícitas', () => {
  it('resgata após meia-noite, preserva dois dias da mesma fase e deduplica datas entre fases e duelos', async () => {
    const scheduledTime = Date.parse('2026-10-15T04:00:00Z')
    const { sqlite, db } = database()
    const events = [
      event('old', '2026-10-14T22:00:00Z'),
      event('midnight', '2026-10-15T00:30:00Z'),
      event('other', '2026-10-15T01:00:00Z'),
    ]
    events[2].season!.slug = 'quarterfinals'
    feed({ seed: events })
    await syncEspnFixtures({
      db,
      competitionCode: 'conmebol.sudamericana',
      season: 2026,
      dates: ['seed'],
    })
    const finished = events.map((ev) => event(ev.id!, ev.date as string, true))
    const fetch = feed({ '20261014': finished })
    const ae = { writeDataPoint: vi.fn() }

    await pollActiveMatches(db, '', ae as unknown as AnalyticsEngineDataset, scheduledTime)

    expect(queriedDates(fetch).sort()).toEqual(['20261013', '20261014', '20261015'])
    expect(
      sqlite
        .prepare(
          'SELECT status, home_score, locked_at IS NOT NULL AS locked, scored_at IS NOT NULL AS scored FROM matches',
        )
        .all(),
    ).toEqual(Array(3).fill({ status: 'finished', home_score: 1, locked: 1, scored: 1 }))
    const point = ae.writeDataPoint.mock.calls.find(([p]) => p.blobs[0] === 'poller_run')![0]
    expect(point.doubles[2]).toBe(3)
  })

  it('descobre sem jogos no banco, consulta nove dias, preserva futuro e rejeita outro ano e TBD', async () => {
    const now = Date.parse('2026-10-15T04:00:00Z')
    const { sqlite, db } = database()
    sqlite.exec(
      `INSERT INTO competitions (id,name,slug,external_id,provider,season,status,visibility) VALUES ('cup','Copa Sul-Americana','conmebol-sudamericana-2026','conmebol.sudamericana','espn','2026','upcoming','pilot')`,
    )
    const valid = event('future', '2026-10-20T22:00:00Z')
    const wrongYear = event('wrong-year', '2027-10-20T22:00:00Z')
    wrongYear.season!.year = 2027
    const tbd = event('tbd', '2026-10-21T22:00:00Z')
    tbd.competitions![0].competitors![0].team!.displayName = 'TBD Home'
    const fetch = feed({ '20261020': [valid, wrongYear, tbd] })
    const ae = { writeDataPoint: vi.fn() }

    await discoverFixtures(db, '', ae as unknown as AnalyticsEngineDataset, now)

    expect(queriedDates(fetch).sort()).toEqual(
      Array.from({ length: 9 }, (_, i) => String(20261014 + i)),
    )
    expect(sqlite.prepare('SELECT external_id FROM matches').all()).toEqual([
      { external_id: 'future' },
    ])
    expect(sqlite.prepare('SELECT visibility FROM competitions').get()).toEqual({
      visibility: 'pilot',
    })
    expect(
      ae.writeDataPoint.mock.calls.find(([p]) => p.blobs[0] === 'fixture_discovery_run')![0]
        .doubles[2],
    ).toBe(9)
    valid.date = '2026-10-21T23:00:00Z'
    feed({ '20261021': [valid] })
    await discoverFixtures(db, '', undefined, now)
    expect(sqlite.prepare('SELECT start_time FROM matches').get()).toEqual({
      start_time: '2026-10-21T23:00:00Z',
    })
    feed({})
    await discoverFixtures(db, '', undefined, Date.parse('2026-10-01T04:00:00Z'))
    expect(sqlite.prepare('SELECT external_id FROM matches').all()).toEqual([
      { external_id: 'future' },
    ])
  })

  it('não importa a edição 2026 na competição de 2027', async () => {
    const { sqlite, db } = database()
    sqlite.exec(
      `INSERT INTO competitions (id,name,slug,external_id,provider,season,status) VALUES ('cup','Copa','conmebol-sudamericana-2027','conmebol.sudamericana','espn','2027','upcoming')`,
    )
    const ev = event('old-season', '2026-10-20T22:00:00Z')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ events: [ev] }))),
    )
    await discoverFixtures(db, '')
    expect(sqlite.prepare('SELECT * FROM matches').all()).toEqual([])
    expect(sqlite.prepare('SELECT season FROM competitions').all()).toEqual([{ season: '2027' }])
  })

  it('planeja 27 requests para três copas na virada do ano, sem chave', async () => {
    const { sqlite, db } = database()
    for (const [id, code] of [
      ['lib', 'conmebol.libertadores'],
      ['sud', 'conmebol.sudamericana'],
      ['bra', 'bra.copa_do_brazil'],
    ]) {
      sqlite
        .prepare(
          `INSERT INTO competitions (id,name,slug,external_id,provider,season,status) VALUES (?, ?, ?, ?, 'espn','2026','upcoming')`,
        )
        .run(id, id, id, code)
    }
    const fetch = feed({})
    const ae = { writeDataPoint: vi.fn() }
    await discoverFixtures(
      db,
      '',
      ae as unknown as AnalyticsEngineDataset,
      Date.parse('2026-12-31T23:59:00Z'),
    )
    expect(fetch).toHaveBeenCalledTimes(27)
    for (const code of ['conmebol.libertadores', 'conmebol.sudamericana', 'bra.copa_do_brazil']) {
      const dates = fetch.mock.calls
        .filter(([url]) => String(url).includes(code))
        .map(([url]) => new URL(String(url)).searchParams.get('dates'))
        .sort()
      expect(dates).toEqual([
        '20261230',
        '20261231',
        '20270101',
        '20270102',
        '20270103',
        '20270104',
        '20270105',
        '20270106',
        '20270107',
      ])
    }
    expect(
      ae.writeDataPoint.mock.calls.find(([p]) => p.blobs[0] === 'fixture_discovery_run')![0]
        .doubles[2],
    ).toBe(27)
  })

  it('mantém football-data em uma request por rodada e calendário completo na descoberta', async () => {
    const { sqlite, db } = database()
    sqlite.exec(`
      INSERT INTO competitions (id,name,slug,external_id,provider,season,status) VALUES ('league','League','league','BSA','football-data','2026','ongoing');
      INSERT INTO teams (id,name,slug) VALUES ('h','Home','h'), ('a','Away','a');
      INSERT INTO matches (id,external_id,provider,competition_id,home_team_id,away_team_id,start_time,round,status) VALUES
        ('one','one','football-data','league','h','a','2026-10-14T22:00:00Z','30','scheduled'),
        ('two','two','football-data','league','h','a','2026-10-15T00:30:00Z','30','scheduled'),
        ('three','three','football-data','league','h','a','2026-10-15T00:30:00Z','31','scheduled');
    `)
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ competition: { name: 'League' }, matches: [] })),
    )
    vi.stubGlobal('fetch', fetch)
    const now = Date.parse('2026-10-15T04:00:00Z')
    await pollActiveMatches(db, 'key', undefined, now)
    expect(fetch).toHaveBeenCalledTimes(2)
    const requests = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => new URL(String(url)))
    expect(requests.map((url) => url.searchParams.get('matchday')).sort()).toEqual(['30', '31'])
    expect(
      requests.every(
        (url) => url.searchParams.get('season') === '2026' && !url.searchParams.has('dates'),
      ),
    ).toBe(true)
    fetch.mockClear()
    await discoverFixtures(db, 'key', undefined, now)
    expect(fetch).toHaveBeenCalledTimes(1)
    const url = new URL(String(vi.mocked(globalThis.fetch).mock.calls[0][0]))
    expect(url.searchParams.get('season')).toBe('2026')
    expect(url.searchParams.has('matchday')).toBe(false)
    expect(url.searchParams.has('dates')).toBe(false)
  })

  it('conta requests planejadas sem incluir o retry HTTP', async () => {
    const { sqlite, db } = database()
    sqlite.exec(
      `INSERT INTO competitions (id,name,slug,external_id,provider,season,status) VALUES ('cup','Copa','cup','conmebol.sudamericana','espn','2026','upcoming')`,
    )
    let failed = false
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('20261014') && !failed) {
        failed = true
        return new Response('temporarily unavailable', { status: 500 })
      }
      return new Response(JSON.stringify({ events: [] }))
    })
    vi.stubGlobal('fetch', fetch)
    const ae = { writeDataPoint: vi.fn() }
    await discoverFixtures(
      db,
      '',
      ae as unknown as AnalyticsEngineDataset,
      Date.parse('2026-10-15T04:00:00Z'),
    )
    expect(fetch).toHaveBeenCalledTimes(10)
    const point = ae.writeDataPoint.mock.calls.find(
      ([p]) => p.blobs[0] === 'fixture_discovery_run',
    )![0]
    expect(point.doubles[2]).toBe(9)
    expect(point.blobs[1]).toBe('ok')
  })

  it('cobre 10 competições ESPN temporárias só na janela de 9 dias, serializa HTTP e persiste contadores', async () => {
    const { sqlite, db } = database()
    const codes = Array.from({ length: 10 }, (_, i) => `test.cron.${i}`)
    for (const [i, code] of codes.entries()) {
      ESPN_PRIMARY_COMPETITIONS[code] = {
        name: `Temp ${i}`,
        slugPrefix: `temp-cron-${i}`,
      }
      sqlite
        .prepare(
          `INSERT INTO competitions (id,name,slug,external_id,provider,season,status,visibility)
           VALUES (?, ?, ?, ?, 'espn', '2026', 'upcoming', 'pilot')`,
        )
        .run(`c${i}`, `Temp ${i}`, `temp-cron-${i}-2026`, code)
    }

    let inFlight = 0
    let peak = 0
    const fetch = vi.fn(async (input: string | URL | Request) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      const url = new URL(String(input))
      const date = url.searchParams.get('dates') ?? ''
      const slug = url.pathname.split('/').at(-2) ?? ''
      const idx = codes.indexOf(slug)
      const events =
        date === '20261020' && idx >= 0
          ? [event(`m-${idx}`, '2026-10-20T22:00:00Z')]
          : []
      // Identidade por competição: reusa o template trocando só o id do evento.
      if (events[0]) {
        events[0].competitions![0].competitors![0].team!.id = `home-${idx}`
        events[0].competitions![0].competitors![1].team!.id = `away-${idx}`
        events[0].competitions![0].competitors![0].team!.displayName = `Home ${idx}`
        events[0].competitions![0].competitors![1].team!.displayName = `Away ${idx}`
      }
      inFlight--
      return new Response(JSON.stringify({ events }))
    })
    vi.stubGlobal('fetch', fetch)
    const ae = { writeDataPoint: vi.fn() }

    try {
      await discoverFixtures(
        db,
        '',
        ae as unknown as AnalyticsEngineDataset,
        Date.parse('2026-10-15T06:00:00Z'),
      )

      expect(fetch).toHaveBeenCalledTimes(90)
      expect(peak).toBe(1)
      const dates = [...new Set(queriedDates(fetch))].sort()
      expect(dates).toEqual([
        '20261014',
        '20261015',
        '20261016',
        '20261017',
        '20261018',
        '20261019',
        '20261020',
        '20261021',
        '20261022',
      ])
      expect(dates).not.toContain('20260101')
      expect(dates).not.toContain('20261231')
      expect(sqlite.prepare('SELECT COUNT(*) AS n FROM matches').get()).toEqual({ n: 10 })
      const point = ae.writeDataPoint.mock.calls.find(
        ([p]) => p.blobs[0] === 'fixture_discovery_run',
      )![0]
      expect(point.blobs[1]).toBe('ok')
      expect(point.doubles[0]).toBe(10)
      expect(point.doubles[1]).toBe(10)
      expect(point.doubles[2]).toBe(90)
    } finally {
      for (const code of codes) delete ESPN_PRIMARY_COMPETITIONS[code]
    }
  })

  it('preserva backfill manual por dates confirmadas fora do cron', async () => {
    const { sqlite, db } = database()
    const ev = event('backfill', '2026-03-03T22:00:00Z')
    feed({ '20260303': [ev] })
    await syncEspnFixtures({
      db,
      competitionCode: 'conmebol.sudamericana',
      season: 2026,
      dates: ['20260303'],
    })
    expect(sqlite.prepare('SELECT external_id, start_time FROM matches').all()).toEqual([
      { external_id: 'backfill', start_time: '2026-03-03T22:00:00Z' },
    ])
  })
})
