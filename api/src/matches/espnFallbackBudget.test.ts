/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetEspnClientForTests, setEspnMinIntervalForTests } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { CallGate } from './callBudget'
import { scoreWindowFromEspn } from './espnFallback'
import { syncFixtures } from './sync'

/**
 * O fallback da ESPN para as competições da football-data dentro do saldo de
 * subrequests do poller (ADR-027, adendo do ticket 03): só tenta o que cabe, cobra
 * o `fetch` pelo porteiro e, sem saldo, espera o tick seguinte sem erro nem fila.
 */

const NOW = Date.parse('2026-11-17T14:30:00Z')
const KICKOFF = '2026-11-17T12:20:00Z'
const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  resetEspnClientForTests()
  setEspnMinIntervalForTests(0)
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  resetEspnClientForTests()
})

/** Uma rodada da Primeira Liga que a football-data ainda mostra como não iniciada. */
async function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const team = (n: number) => ({ id: 100 + n, name: `Time ${n}`, shortName: `T${n}`, tla: 'TIM' })
  const calendar = {
    competition: { id: 2017, code: 'PPL', name: 'Primeira Liga' },
    matches: [
      {
        id: 9001,
        utcDate: KICKOFF,
        status: 'TIMED',
        matchday: 1,
        stage: 'REGULAR_SEASON',
        group: null,
        homeTeam: team(1),
        awayTeam: team(2),
        score: { duration: 'REGULAR', fullTime: { home: null, away: null } },
      },
    ],
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(calendar)),
  )
  await syncFixtures({ competitionCode: 'PPL', season: 2026, matchday: 1, db, apiKey: 'test' })
  const { id } = sqlite.prepare(`SELECT id FROM competitions WHERE external_id = '2017'`).get() as {
    id: string
  }
  // A ESPN só lista o jogo no scoreboard do dia dele; o do dia anterior vem vazio.
  const espn = vi.fn(async (input: string | URL | Request) =>
    Response.json({
      events:
        new URL(String(input)).searchParams.get('dates') !== '20261117'
          ? []
          : [
              {
                date: '2026-11-17T12:20Z',
                status: { type: { state: 'post', completed: true } },
                competitions: [
                  {
                    competitors: [
                      { homeAway: 'home', team: { displayName: 'Time 1' }, score: '2' },
                      { homeAway: 'away', team: { displayName: 'Time 2' }, score: '1' },
                    ],
                  },
                ],
              },
            ],
    }),
  )
  vi.stubGlobal('fetch', espn)
  const writeDataPoint = vi.fn()
  const ae = { writeDataPoint } as unknown as AnalyticsEngineDataset
  const errors = () =>
    writeDataPoint.mock.calls
      .map(([point]) => point as { blobs: string[] })
      .filter((point) => point.blobs[0] === 'match_results_fallback' && point.blobs.length > 2)
  const status = () => sqlite.prepare(`SELECT status FROM matches`).get()
  return { sqlite, db, id, espn, ae, errors, status }
}

const gateOf = (callsLeft: number): CallGate & { charged: number } => {
  const gate = {
    charged: 0,
    callsLeft: () => callsLeft,
    chargeFetch: () => {
      gate.charged += 1
    },
  }
  return gate
}

describe('fallback da ESPN com o saldo do poller', () => {
  it('sem saldo para a tentativa (vaga, fetch e registro), a competição espera o próximo tick: sem fetch, sem erro', async () => {
    const h = await setup()
    const gate = gateOf(2)

    const result = await scoreWindowFromEspn(h.db, h.ae, [h.id], {
      now: NOW,
      coordinate: true,
      callGate: gate,
    })

    expect(result.get(h.id)).toBe(0)
    expect(h.espn).not.toHaveBeenCalled()
    expect(gate.charged).toBe(0)
    expect(h.errors()).toEqual([])
    expect(h.status()).toEqual({ status: 'scheduled' })
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Sem saldo de chamadas'))
  })

  it('com saldo, cada fetch é cobrado uma vez pelo porteiro (as duas datas) e o resultado é gravado', async () => {
    const h = await setup()
    const gate = gateOf(40)

    const result = await scoreWindowFromEspn(h.db, h.ae, [h.id], {
      now: NOW,
      coordinate: true,
      callGate: gate,
    })

    expect(result.get(h.id)).toBe(1)
    // O dia do jogo e o anterior: 2 requests, cobrados pelo porteiro e não por um observador.
    expect(h.espn).toHaveBeenCalledTimes(2)
    expect(gate.charged).toBe(2)
    expect(h.status()).toEqual({ status: 'finished' })
  })
})
