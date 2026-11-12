/// <reference types="node" />
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sync', () => ({ syncFixtures: vi.fn(async () => ({ matches: 0 })) }))
vi.mock('./scoring', () => ({ scoreUnprocessedMatches: vi.fn(async () => undefined) }))
vi.mock('./espnFallback', () => ({
  scoreWindowFromEspn: vi.fn(async () => new Map<string, number>()),
}))

import { LATE_SWEEP_INTERVAL_MS } from './matchPollingWindow'
import { pollActiveMatches } from './poller'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

// Runs the poller query against the real migrations to check which matches it picks.
function database() {
  const sqlite = new DatabaseSync(':memory:')
  const migrations = new URL('../../migrations/', import.meta.url)
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'))
  }
  const db = {
    prepare(sql: string) {
      let values: SQLInputValue[] = []
      const stmt = {
        bind(...args: SQLInputValue[]) {
          values = args
          return stmt
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...values), success: true }
        },
      }
      return stmt
    },
  } as unknown as D1Database
  return { sqlite, db }
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000).toISOString()

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.mocked(syncFixtures).mockReset()
  vi.mocked(syncFixtures).mockResolvedValue({ matches: 0 } as never)
  vi.mocked(scoreUnprocessedMatches).mockClear()
})

describe('pollActiveMatches rescue window', () => {
  it('rescues unfinished and unscored matches up to 24 h old, skipping postponed ones', async () => {
    const { sqlite, db } = database()
    handles.push(sqlite)
    sqlite.exec(`
      INSERT INTO competitions (id,name,slug,status,penalty_phases,external_id,season,provider)
        VALUES ('c1','League','league','ongoing','[]','BSA','2026','football-data');
      INSERT INTO teams (id,name,slug) VALUES ('home','Home','home'),('away','Away','away');
    `)
    const insert = sqlite.prepare(`INSERT INTO matches
      (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,
       postponed,home_score,away_score)
      VALUES (?, 'c1', ?, 'football-data', 'home', 'away', ?, ?, ?, ?, ?, ?)`)
    insert.run('late', '1', minutesAgo(10 * 60), 'scheduled', '10', 0, null, null)
    insert.run('unscored', '2', minutesAgo(20 * 60), 'finished', '11', 0, 2, 1)
    insert.run('postponed', '3', minutesAgo(8 * 60), 'scheduled', '12', 1, null, null)
    insert.run('active-postponed', '4', minutesAgo(150), 'scheduled', '13', 1, null, null)
    insert.run('too-old', '5', minutesAgo(30 * 60), 'scheduled', '14', 0, null, null)
    insert.run('scored', '6', minutesAgo(5 * 60), 'finished', '15', 0, 1, 0)
    sqlite.exec("UPDATE matches SET scored_at = '2026-01-01T00:00:00Z' WHERE id = 'scored'")

    await pollActiveMatches(db, 'key')

    const rounds = vi
      .mocked(syncFixtures)
      .mock.calls.map(([options]) => options.matchday)
      .sort()
    expect(rounds).toEqual([10, 11, 13])
    expect(scoreUnprocessedMatches).toHaveBeenCalledWith('c1', db)
  })
})

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/** Uma competição football-data e os jogos dados, todos na rodada informada. */
function seed(
  matches: { id: string; round: string; start: number; postponed?: number; comp?: string }[],
) {
  const { sqlite, db } = database()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO competitions (id,name,slug,status,penalty_phases,external_id,season,provider)
      VALUES ('c1','League','league','ongoing','[]','BSA','2026','football-data'),
             ('c2','Other','other','ongoing','[]','PL','2026','football-data');
    INSERT INTO teams (id,name,slug) VALUES ('home','Home','home'),('away','Away','away');
  `)
  const insert = sqlite.prepare(`INSERT INTO matches
    (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,postponed)
    VALUES (?, ?, ?, 'football-data', 'home', 'away', ?, 'scheduled', ?, ?)`)
  for (const m of matches) {
    insert.run(
      m.id,
      m.comp ?? 'c1',
      m.id,
      new Date(m.start).toISOString(),
      m.round,
      m.postponed ?? 0,
    )
  }
  return { db, insert, sqlite }
}

/** Roda o poller a cada 30 min de `from` até `to` e devolve os instantes em que ele sincronizou. */
async function tickUntil(db: D1Database, from: number, to: number): Promise<number[]> {
  const synced: number[] = []
  for (let now = from; now <= to; now += 30 * MINUTE) {
    const before = vi.mocked(syncFixtures).mock.calls.length
    await pollActiveMatches(db, 'key', undefined, now)
    if (vi.mocked(syncFixtures).mock.calls.length > before) synced.push(now)
  }
  return synced
}

const KICKOFF = Date.parse('2026-10-10T18:00:00Z')

describe('pollActiveMatches varredura de atrasados', () => {
  it('jogo sem resultado depois de 24 h segue consultado a cada 3 h até 7 dias, sem consulta contínua', async () => {
    const { db } = seed([{ id: 'late', round: '10', start: KICKOFF }])
    // O provedor falha em todas as consultas: falha não gera nova tentativa fora da agenda.
    vi.mocked(syncFixtures).mockRejectedValue(new Error('HTTP 503'))

    const synced = await tickUntil(db, KICKOFF + 2 * HOUR, KICKOFF + 9 * 24 * HOUR)

    const rescue = synced.filter((t) => t <= KICKOFF + 24 * HOUR)
    const late = synced.filter((t) => t > KICKOFF + 24 * HOUR)
    // Janela ativa e resgate: todo tick de 115 min a 24 h.
    expect(rescue).toHaveLength(45)
    // Depois de 24 h: um tick a cada 3 h, até 7 dias após o início.
    expect(late.length).toBeGreaterThan(0)
    expect(late.every((t) => t % LATE_SWEEP_INTERVAL_MS === 0)).toBe(true)
    expect(late).toHaveLength((6 * 24) / 3)
    expect(Math.max(...late)).toBeLessThanOrEqual(KICKOFF + 7 * 24 * HOUR)
  })

  it('adiado sai da consulta contínua após 200 min e é revisto a cada 3 h até 7 dias', async () => {
    const { db } = seed([{ id: 'postponed', round: '12', start: KICKOFF, postponed: 1 }])

    const synced = await tickUntil(db, KICKOFF + 2 * HOUR, KICKOFF + 9 * 24 * HOUR)

    // 120, 150 e 180 min: janela ativa.
    expect(synced.slice(0, 3)).toEqual([2, 2.5, 3].map((h) => KICKOFF + h * HOUR))
    const after = synced.slice(3)
    expect(after.every((t) => t % LATE_SWEEP_INTERVAL_MS === 0)).toBe(true)
    // Primeiro bloco de 3 h depois dos 200 min (00:00 UTC) até 7 dias.
    expect(after[0]).toBe(KICKOFF + 6 * HOUR)
    expect(after).toHaveLength((7 * 24) / 3 - 1)
    expect(Math.max(...after)).toBeLessThanOrEqual(KICKOFF + 7 * 24 * HOUR)
  })

  it('consulta um atrasado por varredura, alterna entre eles e cede a vez ao tick com jogo na janela', async () => {
    const sweep = KICKOFF + 2 * 24 * HOUR + 6 * HOUR // 00:00 UTC, três blocos no mesmo dia
    const { db, insert } = seed([
      { id: 'a', round: '10', start: KICKOFF },
      { id: 'b', round: '11', start: KICKOFF + HOUR },
      { id: 'c', round: '7', start: KICKOFF, comp: 'c2' },
    ])

    const visited: string[] = []
    for (let slot = 0; slot < 3; slot++) {
      vi.mocked(syncFixtures).mockClear()
      await pollActiveMatches(db, 'key', undefined, sweep + slot * LATE_SWEEP_INTERVAL_MS)
      expect(syncFixtures).toHaveBeenCalledTimes(1)
      const [options] = vi.mocked(syncFixtures).mock.calls[0]
      visited.push(`${options.competitionCode}:${options.matchday}`)
    }
    expect(visited.sort()).toEqual(['BSA:10', 'BSA:11', 'PL:7'])

    // Com jogo na janela ativa, o tick não soma a varredura ao custo dele.
    const busy = sweep + 3 * LATE_SWEEP_INTERVAL_MS
    insert.run('now', 'c1', 'now', new Date(busy - 2 * HOUR).toISOString(), '20', 0)
    vi.mocked(syncFixtures).mockClear()
    await pollActiveMatches(db, 'key', undefined, busy)
    expect(vi.mocked(syncFixtures).mock.calls.map(([options]) => options.matchday)).toEqual([20])
  })

  it.each([8, 9, 10])('com %i atrasados e o bloco das 00:00 sempre ocupado, todos são consultados em 7 dias', async (count) => {
    const { db, insert, sqlite } = seed(
      Array.from({ length: count }, (_, i) => ({
        id: `r${i + 1}`,
        round: String(i + 1),
        start: KICKOFF,
      })),
    )

    const visited = new Set<number>()
    for (
      let now = KICKOFF + 27 * HOUR;
      now <= KICKOFF + 7 * 24 * HOUR;
      now += LATE_SWEEP_INTERVAL_MS
    ) {
      const busy = new Date(now).getUTCHours() === 0
      if (busy) insert.run('busy', 'c1', 'busy', new Date(now - 2 * HOUR).toISOString(), '99', 0)
      vi.mocked(syncFixtures).mockClear()
      await pollActiveMatches(db, 'key', undefined, now)
      for (const [options] of vi.mocked(syncFixtures).mock.calls) {
        if (options.matchday !== 99) visited.add(options.matchday!)
      }
      if (busy) sqlite.exec("DELETE FROM matches WHERE id = 'busy'")
    }

    expect([...visited].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i + 1))
  })

  it('não consulta jogo encerrado nem jogo de mais de 7 dias fora da janela', async () => {
    const sweep = KICKOFF + 8 * 24 * HOUR
    const { db } = seed([{ id: 'old', round: '3', start: KICKOFF }])

    await pollActiveMatches(db, 'key', undefined, sweep)

    expect(syncFixtures).not.toHaveBeenCalled()
  })
})
