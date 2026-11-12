/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import template from '../providers/__fixtures__/espn-conmebol-sudamericana-scoreboard.json'
import type { EspnScoreboardEvent } from '../providers/espn'
import { resetEspnClientForTests, setEspnMinIntervalForTests } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import { syncEspnFixtures } from './espnSync'
import { isMatchLocked } from './locking'
import { LATE_SWEEP_INTERVAL_MS } from './matchPollingWindow'
import { pollActiveMatches } from './poller'

// Varredura de atrasados com o sync ESPN de verdade: o resultado chega ao D1 e é pontuado.

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

const handles: DatabaseSync[] = []
beforeEach(() => {
  resetEspnClientForTests()
  setEspnMinIntervalForTests(0)
})
afterEach(() => {
  handles.splice(0).forEach((db) => db.close())
  vi.unstubAllGlobals()
  resetEspnClientForTests()
})

function database() {
  const result = createSqliteD1()
  handles.push(result.sqlite)
  result.sqlite.exec('DELETE FROM competitions')
  return result
}

type State = 'pre' | 'final' | 'postponed'

function event(id: string, date: string, state: State): EspnScoreboardEvent {
  const ev = structuredClone(template.events[0]) as EspnScoreboardEvent
  ev.id = id
  ev.date = date
  ev.season = { year: 2026, slug: 'semifinals' }
  const type = {
    pre: { state: 'pre', name: 'STATUS_SCHEDULED', completed: false },
    final: { state: 'post', name: 'STATUS_FULL_TIME', completed: true },
    postponed: { state: 'post', name: 'STATUS_POSTPONED', completed: false },
  }[state]
  ev.competitions![0].status = { type }
  ev.competitions![0].date = date
  for (const c of ev.competitions![0].competitors!) c.score = state === 'final' ? '1' : undefined
  return ev
}

/** Scoreboard por data `YYYYMMDD`; devolve o mock de `fetch` para contar as consultas. */
function feed(boards: () => Record<string, EspnScoreboardEvent[]>) {
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const date = new URL(String(input)).searchParams.get('dates') ?? ''
    return new Response(JSON.stringify({ events: boards()[date] ?? [] }))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function seed(db: D1Database, ev: EspnScoreboardEvent) {
  feed(() => ({ seed: [ev] }))
  await syncEspnFixtures({
    db,
    competitionCode: 'conmebol.sudamericana',
    season: 2026,
    dates: ['seed'],
  })
}

const row = (sqlite: DatabaseSync) =>
  sqlite
    .prepare(
      'SELECT start_time, status, postponed, locked_at, home_score, scored_at IS NOT NULL AS scored FROM matches',
    )
    .get() as {
    start_time: string
    status: string
    postponed: number
    locked_at: string | null
    home_score: number | null
    scored: number
  }

describe('pollActiveMatches varredura de atrasados (ESPN)', () => {
  it('registra e pontua resultado que a ESPN publica 30 h depois, fora do horizonte da descoberta', async () => {
    const kickoff = Date.parse('2026-10-14T21:00:00Z')
    const { sqlite, db } = database()
    await seed(db, event('m1', '2026-10-14T21:00:00Z', 'pre'))
    let published = false
    const fetch = feed(() => ({
      '20261014': [event('m1', '2026-10-14T21:00:00Z', published ? 'final' : 'pre')],
    }))

    const fetchesAfter24h: number[] = []
    for (let now = kickoff + 2 * HOUR; now <= kickoff + 48 * HOUR; now += 30 * MINUTE) {
      published = now >= kickoff + 30 * HOUR
      const before = fetch.mock.calls.length
      await pollActiveMatches(db, '', undefined, now)
      if (now > kickoff + 24 * HOUR && fetch.mock.calls.length > before) fetchesAfter24h.push(now)
      if (row(sqlite).scored) break
    }

    expect(row(sqlite)).toMatchObject({ status: 'finished', home_score: 1, scored: 1 })
    // Depois das 24 h, só nos blocos de 3 h: 00:00 e 03:00 UTC de 16/10.
    expect(fetchesAfter24h.every((t) => t % LATE_SWEEP_INTERVAL_MS === 0)).toBe(true)
    expect(fetchesAfter24h.map((t) => new Date(t).toISOString())).toEqual([
      '2026-10-16T00:00:00.000Z',
      '2026-10-16T03:00:00.000Z',
    ])
  })

  it('adiado remarcado e disputado antes da próxima descoberta trava e recebe o resultado', async () => {
    const { sqlite, db } = database()
    await seed(db, event('p1', '2026-10-15T10:00:00Z', 'postponed'))
    expect(row(sqlite)).toMatchObject({ postponed: 1, status: 'scheduled' })
    // A ESPN remarca para 15:00 do mesmo dia; a descoberta das 06:15 já passou.
    const fetch = feed(() => ({ '20261015': [event('p1', '2026-10-15T15:00:00Z', 'final')] }))

    // 17:30 não é bloco de varredura: o adiado vencido segue fora da consulta contínua.
    await pollActiveMatches(db, '', undefined, Date.parse('2026-10-15T17:30:00Z'))
    expect(fetch).not.toHaveBeenCalled()
    expect(isMatchLocked(row(sqlite), '2026-10-15T17:30:00Z')).toBe(false)

    await pollActiveMatches(db, '', undefined, Date.parse('2026-10-15T18:00:00Z'))

    // Consulta o dia corrente (e o anterior, pelo fuso da ESPN), não o horário antigo.
    expect(
      fetch.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('dates')).sort(),
    ).toEqual(['20261014', '20261015'])
    const after = row(sqlite)
    expect(after).toMatchObject({
      start_time: '2026-10-15T15:00:00Z',
      postponed: 0,
      status: 'finished',
      scored: 1,
    })
    expect(isMatchLocked(after, '2026-10-15T18:00:00Z')).toBe(true)
  })
})
