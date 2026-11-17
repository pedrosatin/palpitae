/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetEspnClientForTests, setEspnMinIntervalForTests } from '../providers/espn'
import { limitD1Calls } from '../testing/d1CallLimit'
import { createSqliteD1 } from '../testing/sqliteD1'
import { DrainBudget } from './drainBudget'
import { FALLBACK_COMPETITION_CALLS, scoreWindowFromEspn } from './espnFallback'
import { syncFixtures } from './sync'

/**
 * O fallback da ESPN para as competições da football-data dentro do saldo de
 * subrequests do poller (ADR-027, adendos dos tickets 03 e 09): cada competição
 * reserva o custo completo antes de começar, a consulta, as tentativas e a gravação
 * saem desse saldo, o `fetch` é cobrado pelo porteiro e, sem saldo, a competição
 * espera o tick seguinte sem consultar nada, sem erro nem fila.
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
  // Conta as chamadas ao D1 a partir daqui, sem recusar nenhuma.
  const counted = limitD1Calls(db, null)
  return { sqlite, db: counted.db, d1Calls: counted.calls, id, espn, ae, errors, status }
}

describe('fallback da ESPN com o saldo do poller', () => {
  it('o custo completo de uma competição: a consulta, 3 datas de 3 chamadas e a gravação', () => {
    expect(FALLBACK_COMPETITION_CALLS).toBe(11)
  })

  it('sem o custo completo livre, a competição espera o próximo tick: sem consulta ao D1, sem fetch, sem erro', async () => {
    const h = await setup()
    const budget = new DrainBudget(h.db, FALLBACK_COMPETITION_CALLS - 1, 0)

    const result = await scoreWindowFromEspn(h.db, h.ae, [h.id], {
      now: NOW,
      coordinate: true,
      budget,
    })

    expect(result.get(h.id)).toBe(0)
    expect(h.d1Calls()).toBe(0)
    expect(h.espn).not.toHaveBeenCalled()
    expect(budget.used).toBe(0)
    expect(h.errors()).toEqual([])
    expect(h.status()).toEqual({ status: 'scheduled' })
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Sem saldo de chamadas'))
  })

  it('com saldo, a consulta, as duas datas e a gravação saem do saldo, e cada fetch é cobrado uma vez', async () => {
    const h = await setup()
    const budget = new DrainBudget(h.db, 40, 0)

    const result = await scoreWindowFromEspn(h.db, h.ae, [h.id], {
      now: NOW,
      coordinate: true,
      budget,
    })

    expect(result.get(h.id)).toBe(1)
    // O dia do jogo e o anterior: 2 requests, cobrados pelo porteiro e não por um observador.
    expect(h.espn).toHaveBeenCalledTimes(2)
    // A consulta (1), cada data com a vaga, o `fetch` e o registro (3) e a gravação (1): 8, abaixo
    // das 11 reservadas, e tudo o que saiu passou pelo saldo.
    expect(budget.used).toBe(8)
    expect(h.d1Calls() + h.espn.mock.calls.length).toBe(budget.used)
    expect(h.status()).toEqual({ status: 'finished' })
  })

  it('com saldo para uma competição só, a segunda espera a primeira terminar e, sem as 11 livres, não consulta nada', async () => {
    const h = await setup()
    // 11 para a primeira, que gasta 8 e devolve 3: a segunda, sem jogo, não cabe nas 3 que sobram.
    const budget = new DrainBudget(h.db, FALLBACK_COMPETITION_CALLS, 0)

    const result = await scoreWindowFromEspn(h.db, h.ae, [h.id, 'sem-jogos'], {
      now: NOW,
      coordinate: true,
      budget,
    })

    expect(result).toEqual(
      new Map([
        [h.id, 1],
        ['sem-jogos', 0],
      ]),
    )
    expect(budget.used).toBe(8)
    expect(h.d1Calls() + h.espn.mock.calls.length).toBe(8)
    expect(h.errors()).toEqual([])
  })
})
