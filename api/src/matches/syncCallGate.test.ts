/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { CallBudgetExhaustedError, type CallGate } from './callBudget'
import { clearFootballDataPause } from './footballDataQuota'
import { FootballDataSlotBusyError, setFootballDataRateLimitForTests } from './providerBudget'
import { syncFixtures, syncWriteCalls } from './sync'

/**
 * Porteiro de subrequests no sync da football-data (ADR-027, adendo): cada
 * `fetch`, retry incluído, é cobrado antes de sair, e o calendário só começa a
 * ser gravado se o saldo cobre a gravação inteira.
 */

const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-11-17T14:05:00Z') })
  clearFootballDataPause()
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  clearFootballDataPause()
  setFootballDataRateLimitForTests(1000)
})

function calendar(count = 10) {
  const team = (n: number) => ({ id: 100 + n, name: `Time ${n}`, shortName: `T${n}`, tla: 'TIM' })
  return {
    competition: { id: 2017, code: 'PPL', name: 'Primeira Liga' },
    matches: Array.from({ length: count }, (_, i) => ({
      id: 900 + i,
      utcDate: '2026-11-08T15:30:00Z',
      status: 'TIMED',
      matchday: 10,
      stage: 'REGULAR_SEASON',
      group: null,
      homeTeam: team(2 * i),
      awayTeam: team(2 * i + 1),
      score: { duration: 'REGULAR', fullTime: { home: null, away: null } },
    })),
  }
}

/** Porteiro que registra a ordem em que cobra, deixa cobrar `allowed` vezes e informa o saldo. */
function makeGate(log: string[], opts: { allowed?: number; left?: number } = {}) {
  let charged = 0
  const gate: CallGate = {
    chargeFetch: () => {
      if (charged >= (opts.allowed ?? Infinity)) throw new CallBudgetExhaustedError()
      charged += 1
      log.push('charge')
    },
    callsLeft: () => opts.left ?? Infinity,
  }
  return gate
}

function setup(responses: Response[]) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const log: string[] = []
  const queue = [...responses]
  const fetchMock = vi.fn(async () => {
    log.push('fetch')
    return queue.shift() ?? Response.json(calendar())
  })
  vi.stubGlobal('fetch', fetchMock)
  // O que o sync grava de uma vez: a competição do provedor, os times e os jogos dela.
  const written = {
    competitions: `SELECT COUNT(*) AS n FROM competitions WHERE external_id = '2017'`,
    teams: `SELECT COUNT(*) AS n FROM teams WHERE provider = 'football-data'`,
    matches: `SELECT COUNT(*) AS n FROM matches WHERE provider = 'football-data'`,
  }
  const count = (what: keyof typeof written) =>
    (sqlite.prepare(written[what]).get() as { n: number }).n
  return { sqlite, db, log, fetchMock, count }
}

const sync = (db: D1Database, gate: CallGate, coordinate = false) =>
  syncFixtures({
    competitionCode: 'PPL',
    season: 2026,
    matchday: 10,
    apiKey: 'k',
    db,
    coordinate,
    callGate: gate,
  })

const limited = () =>
  Response.json({ message: 'limite' }, { status: 429, headers: { 'X-RequestCounter-Reset': '2' } })

describe('syncFixtures com porteiro de subrequests', () => {
  it('cobra cada fetch antes de iniciá-lo, inclusive o retry depois do 429', async () => {
    const { db, log, fetchMock } = setup([limited(), Response.json(calendar())])

    const promise = sync(db, makeGate(log))
    await vi.advanceTimersByTimeAsync(7_000)

    await expect(promise).resolves.toMatchObject({ matches: 10 })
    expect(log).toEqual(['charge', 'fetch', 'charge', 'fetch'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('porteiro que recusa o retry do 429: lança saldo esgotado e só o primeiro fetch saiu', async () => {
    const { db, log, fetchMock, count } = setup([limited()])

    const promise = sync(db, makeGate(log, { allowed: 1 }))
    const assertion = expect(promise).rejects.toBeInstanceOf(CallBudgetExhaustedError)
    await vi.advanceTimersByTimeAsync(7_000)

    await assertion
    expect(log).toEqual(['charge', 'fetch'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(count('matches')).toBe(0)
  })

  it('sem vaga no orçamento do provedor, nenhum fetch é cobrado', async () => {
    const { db, sqlite, log, fetchMock } = setup([])
    setFootballDataRateLimitForTests(1)
    sqlite.exec(
      `UPDATE provider_rate_state SET window_started_at = ${Math.floor(Date.now() / 60_000)}, window_calls = 1`,
    )

    await expect(sync(db, makeGate(log), true)).rejects.toBeInstanceOf(FootballDataSlotBusyError)

    expect(log).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sem chamadas para a reserva e o fetch juntos, não gasta a vaga do provedor', async () => {
    const { db, sqlite, log, fetchMock } = setup([])

    await expect(sync(db, makeGate(log, { left: 1 }), true)).rejects.toBeInstanceOf(
      CallBudgetExhaustedError,
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sqlite.prepare(`SELECT window_calls FROM provider_rate_state`).get()).toEqual({
      window_calls: 0,
    })
  })

  it('saldo que não cobre a gravação do calendário falha antes de gravar qualquer coisa', async () => {
    const { db, log, count } = setup([])
    const before = [count('competitions'), count('teams'), count('matches')]

    // 10 jogos entre 20 times custam 6 chamadas de gravação; sobram 5.
    await expect(sync(db, makeGate(log, { left: 5 }))).rejects.toBeInstanceOf(
      CallBudgetExhaustedError,
    )

    expect(log).toEqual(['charge', 'fetch'])
    expect([count('competitions'), count('teams'), count('matches')]).toEqual(before)
    expect(count('matches')).toBe(0)
  })

  it('saldo que cobre a gravação do calendário grava tudo', async () => {
    const { db, log, count } = setup([])

    await expect(sync(db, makeGate(log, { left: 6 }))).resolves.toMatchObject({ matches: 10 })

    expect(count('matches')).toBe(10)
    expect(count('teams')).toBe(20)
  })

  it('sem porteiro o sync não muda: nenhuma cobrança nem checagem de saldo', async () => {
    const { db, count } = setup([])

    await expect(
      syncFixtures({
        competitionCode: 'PPL',
        season: 2026,
        matchday: 10,
        apiKey: 'k',
        db,
      }),
    ).resolves.toMatchObject({ matches: 10 })

    expect(count('matches')).toBe(10)
  })
})

describe('syncWriteCalls', () => {
  it.each([
    // [jogos, times, descoberta, chamadas]
    [10, 20, false, 6],
    [380, 20, false, 9],
    [380, 20, true, 10],
    [100, 100, false, 6],
    [101, 101, false, 8],
  ])(
    '%i jogos entre %i times (descoberta: %s) gravam em %i chamadas',
    (matches, teams, missing, calls) => {
      expect(syncWriteCalls(matches, teams, missing)).toBe(calls)
    },
  )
})
