/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { isMatchLocked, lockedSql } from './locking'
import { syncFixtures } from './sync'

// Sync real contra SQLite: o upsert de produção decide o locked_at a partir da
// linha anterior, então só dá para testar executando o SQL de verdade.

const KICKOFF = '2026-08-01T19:00:00Z'
const BEFORE = '2026-08-01T18:00:00Z'
const DURING = '2026-08-01T20:10:00Z'
const LATER = '2026-08-02T12:00:00Z'
const PLACEHOLDER = '2026-08-01T00:00:00Z'
const NEW_DATE = '2026-08-20T19:00:00Z'

function providerMatch(status: string, utcDate = KICKOFF) {
  const partial = status === 'SUSPENDED' || status === 'IN_PLAY'
  return {
    id: 777001,
    utcDate,
    status,
    matchday: 21,
    stage: 'REGULAR_SEASON',
    group: null,
    homeTeam: { id: 1, name: 'Home FC', shortName: 'Home', tla: 'HOM', crest: 'https://x/1.png' },
    awayTeam: { id: 2, name: 'Away FC', shortName: 'Away', tla: 'AWY', crest: 'https://x/2.png' },
    score: {
      winner: null,
      duration: 'REGULAR',
      fullTime: { home: partial ? 2 : null, away: partial ? 0 : null },
      halfTime: { home: null, away: null },
    },
  }
}

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const sync = async (status: string, now: string, utcDate = KICKOFF) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            competition: { id: 2013, name: 'Campeonato Brasileiro Série A', code: 'BSA' },
            matches: [providerMatch(status, utcDate)],
          }
        },
        async text() {
          return ''
        },
      })),
    )
    await syncFixtures({ competitionCode: 'BSA', season: 2026, apiKey: 'k', db, now })
  }
  const row = () =>
    sqlite.prepare('SELECT start_time, status, postponed, locked_at FROM matches').get() as {
      start_time: string
      status: string
      postponed: number
      locked_at: string | null
    }
  const lockedInSql = (now: string) =>
    (
      sqlite.prepare(`SELECT ${lockedSql()} AS locked FROM matches m`).get(now) as {
        locked: number
      }
    ).locked === 1
  return { sync, row, lockedInSql }
}

describe('locked_at: trava permanente quando o sync vê o jogo iniciado', () => {
  it('jogo suspenso depois do início fica travado para sempre, mesmo com postponed=1', async () => {
    const { sync, row, lockedInSql } = setup()
    await sync('TIMED', BEFORE)
    expect(row().locked_at).toBeNull()
    expect(lockedInSql(BEFORE)).toBe(false)

    // O poller roda depois do kickoff e o provider já marcou SUSPENDED.
    await sync('SUSPENDED', DURING, PLACEHOLDER)
    const suspended = row()
    expect(suspended).toMatchObject({ status: 'scheduled', postponed: 1, start_time: KICKOFF })
    expect(suspended.locked_at).toBe(DURING)
    expect(isMatchLocked(suspended, DURING)).toBe(true)
    expect(lockedInSql(DURING)).toBe(true)

    // Retomada remarcada para depois: nada destrava.
    await sync('TIMED', LATER, NEW_DATE)
    expect(row().locked_at).toBe(DURING)
    expect(lockedInSql(LATER)).toBe(true)
  })

  it('jogo visto em andamento e depois adiado continua travado', async () => {
    const { sync, row, lockedInSql } = setup()
    await sync('IN_PLAY', DURING)
    expect(row().locked_at).toBe(DURING)
    await sync('POSTPONED', LATER, PLACEHOLDER)
    expect(row()).toMatchObject({ postponed: 1, locked_at: DURING })
    expect(lockedInSql(LATER)).toBe(true)
  })

  it('adiamento visto depois do horário original, sem o jogo ter começado, reabre o palpite', async () => {
    const { sync, row, lockedInSql } = setup()
    await sync('TIMED', BEFORE)
    // Até o sync ver o adiamento, a trava por horário vale normalmente.
    expect(lockedInSql(DURING)).toBe(true)
    await sync('POSTPONED', DURING, PLACEHOLDER)
    expect(row()).toMatchObject({ postponed: 1, locked_at: null })
    expect(lockedInSql(DURING)).toBe(false)
    // Nova data: segue aberto até o novo kickoff.
    await sync('TIMED', LATER, NEW_DATE)
    expect(row()).toMatchObject({ postponed: 0, locked_at: null, start_time: NEW_DATE })
    expect(lockedInSql(LATER)).toBe(false)
    expect(lockedInSql(NEW_DATE)).toBe(true)
  })

  it('remarcação antes do início reabre pelo novo horário', async () => {
    const { sync, row, lockedInSql } = setup()
    await sync('TIMED', BEFORE)
    await sync('POSTPONED', BEFORE, PLACEHOLDER)
    expect(row()).toMatchObject({ postponed: 1, locked_at: null })
    await sync('TIMED', BEFORE, NEW_DATE)
    expect(row()).toMatchObject({ postponed: 0, locked_at: null, start_time: NEW_DATE })
    expect(lockedInSql(LATER)).toBe(false)
  })

  it('jogo encerrado localmente grava locked_at mesmo se o provider regredir o status', async () => {
    const { sync, row, lockedInSql } = setup()
    await sync('TIMED', BEFORE)
    expect(row().locked_at).toBeNull()
    await sync('FINISHED', LATER)
    expect(row()).toMatchObject({ status: 'finished', locked_at: LATER })
    await sync('POSTPONED', '2026-08-03T00:00:00Z', PLACEHOLDER)
    expect(row().locked_at).toBe(LATER)
    expect(lockedInSql('2026-08-03T00:00:00Z')).toBe(true)
  })
})
