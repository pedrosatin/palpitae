/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { clearFootballDataPause, FD_MAX_CONCURRENT_REQUESTS } from './footballDataQuota'
import { pollActiveMatches } from './poller'
import { syncFixtures } from './sync'

const KICKOFF = '2026-11-08T15:30:00Z'
/** Dentro da janela ativa do poller (115 a 200 min após o início). */
const NOW = Date.parse(KICKOFF) + 120 * 60_000
/** Seis rodadas com jogo na janela: mais tarefas football-data que o teto de paralelas. */
const MATCHDAYS = [10, 11, 12, 13, 14, 15]

function fdMatches(status: string, score: number | null) {
  return Response.json({
    competition: { id: 2017, code: 'PPL', name: 'Primeira Liga' },
    matches: MATCHDAYS.map((matchday) => ({
      id: 567_000 + matchday,
      utcDate: KICKOFF,
      status,
      matchday,
      stage: 'REGULAR_SEASON',
      group: null,
      homeTeam: {
        id: matchday * 2,
        name: `Casa ${matchday}`,
        shortName: `C${matchday}`,
        tla: 'CAS',
      },
      awayTeam: {
        id: matchday * 2 + 1,
        name: `Fora ${matchday}`,
        shortName: `F${matchday}`,
        tla: 'FOR',
      },
      score: { duration: 'REGULAR', fullTime: { home: score, away: score } },
    })),
  })
}

/** 429 no formato da football-data: reset em segundos, sem Retry-After. */
function quotaExhausted(resetSeconds: number) {
  return Response.json(
    { message: `You reached your request limit. Wait ${resetSeconds} seconds.`, errorCode: 429 },
    {
      status: 429,
      headers: {
        'X-RequestCounter-Reset': String(resetSeconds),
        'x-requests-available-minute': '0',
      },
    },
  )
}

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  clearFootballDataPause()
})

/**
 * Rodadas agendadas da football-data no D1. A ESPN (fallback) não traz nada, para
 * o resultado depender só da football-data.
 */
async function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const football = { respond: () => fdMatches('TIMED', null) }
  const fdCalls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname !== 'api.football-data.org') return Response.json({ events: [] })
      fdCalls.push(url.searchParams.get('matchday') ?? '')
      return football.respond()
    }),
  )
  await syncFixtures({ competitionCode: 'PPL', season: 2026, db, apiKey: 'test' })
  fdCalls.length = 0
  return { sqlite, db, football, fdCalls }
}

function fakeAe() {
  const writeDataPoint = vi.fn()
  const blobs = () =>
    writeDataPoint.mock.calls.map(([point]) => (point as { blobs: string[] }).blobs)
  return {
    ae: { writeDataPoint } as unknown as AnalyticsEngineDataset,
    pollerRuns: () =>
      blobs()
        .filter((b) => b[0] === 'poller_run')
        .map((b) => b[1]),
    apiErrors: () => blobs().filter((b) => b[0] === 'football_api_error'),
  }
}

describe('poller: cota esgotada da football-data', () => {
  it('429 com reset longo: nada repete na hora e as rodadas na fila não chamam a API', async () => {
    const { sqlite, db, football, fdCalls } = await setup()
    const { ae, pollerRuns, apiErrors } = fakeAe()
    football.respond = () => quotaExhausted(600)

    await pollActiveMatches(db, 'test', ae, NOW)

    // Só as requests que já estavam em voo quando o 429 chegou. Nenhuma repete, e
    // as rodadas que esperavam vaga falham sem request.
    expect(fdCalls).toHaveLength(FD_MAX_CONCURRENT_REQUESTS)
    expect(FD_MAX_CONCURRENT_REQUESTS).toBeLessThan(MATCHDAYS.length)
    expect(pollerRuns()).toEqual(['error'])
    const errors = apiErrors()
    expect(errors).toHaveLength(MATCHDAYS.length)
    expect(errors.filter((b) => b[3].includes('cota esgotada'))).toHaveLength(MATCHDAYS.length)
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM matches WHERE status = 'finished'`).get(),
    ).toEqual({ n: 0 })
  })

  it('o tick seguinte, depois do reset, volta a consultar e grava os resultados', async () => {
    const { sqlite, db, football, fdCalls } = await setup()
    const { ae, pollerRuns } = fakeAe()
    football.respond = () => quotaExhausted(600)
    await pollActiveMatches(db, 'test', ae, NOW)

    football.respond = () => fdMatches('FINISHED', 1)
    vi.useFakeTimers({ now: Date.now() + 600_000, toFake: ['Date'] })
    try {
      await pollActiveMatches(db, 'test', ae, NOW + 10 * 60_000)
    } finally {
      vi.useRealTimers()
    }

    expect(fdCalls).toHaveLength(FD_MAX_CONCURRENT_REQUESTS + MATCHDAYS.length)
    expect(pollerRuns()).toEqual(['error', 'ok'])
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM matches WHERE status = 'finished'`).get(),
    ).toEqual({ n: MATCHDAYS.length })
  })
})
