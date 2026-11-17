/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POLLER_AND_DRAIN_CRON } from '../crons'
import worker from '../index'
import template from '../providers/__fixtures__/espn-conmebol-sudamericana-scoreboard.json'
import {
  resetEspnClientForTests,
  setEspnMinIntervalForTests,
  type EspnScoreboardEvent,
} from '../providers/espn'
import { D1_CALLS_PER_INVOCATION, limitD1Calls, type LimitedD1 } from '../testing/d1CallLimit'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { espnWorkItems } from './espnWork'
import { clearFootballDataPause } from './footballDataQuota'
import { setFootballDataRateLimitForTests, setProviderRateLimitForTests } from './providerBudget'
import { enqueueProviderWork } from './providerWork'
import { syncFixtures } from './sync'

/**
 * Os dois drenos (football-data e ESPN) no mesmo tick do `scheduled` real, sob o
 * limite de 50 subrequests por invocação do plano Free (ADR-027, adendos
 * "subrequests do dreno" e do ticket 03). O D1 recusa a chamada 51, cada `fetch`
 * conta na mesma conta, e a limpeza de registros expirados do `scheduled` entra
 * como a 1 chamada de segurança fora do dreno: o ramo gasta no máximo 45, e o tick
 * inteiro no máximo 46. O coordenador reparte os 45 entre os dois drenos, e a ESPN
 * não tem orçamento de invocação próprio.
 */

/** Minutos de dreno do trigger fundido (os minutos 0 e 30 são do poller), em 3 horas. */
const DRAIN_TICKS = [14, 15, 16].flatMap((hour) =>
  [5, 10, 20, 25, 35, 40, 50, 55].map((minute) => Date.UTC(2026, 10, 17, hour, minute, 0)),
)
const FIRST_TICK = DRAIN_TICKS[0]
const FD_ITEMS = 16
const ESPN_ITEMS = 16
/** A limpeza de registros expirados do `scheduled` é 1 chamada, por fora do dreno. */
const CLEANUP_CALLS = 1
/** Saldo do ramo drenador: 45 das 50 chamadas. */
const DRAIN_CALL_BUDGET = 45
/** O coordenador conta o trabalho pronto de cada dreno antes de repartir: 1 chamada do ramo. */
const PROBE_CALLS = 1
const MIN = 60_000

const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.useFakeTimers({ now: FIRST_TICK, toFake: ['Date'] })
  resetEspnClientForTests()
  setEspnMinIntervalForTests(0)
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  clearFootballDataPause()
  resetEspnClientForTests()
  setFootballDataRateLimitForTests(1000)
  setProviderRateLimitForTests('espn', 1000)
})

/** Calendário da football-data: 10 jogos de uma rodada, dois times cada, já encerrados. */
function fdCalendar(matchday: number) {
  const team = (n: number) => ({
    id: matchday * 1000 + n,
    name: `Time ${matchday}-${n}`,
    shortName: `T${matchday}-${n}`,
    tla: 'TIM',
  })
  return {
    competition: { id: 2017, code: 'PPL', name: 'Primeira Liga' },
    matches: Array.from({ length: 10 }, (_, i) => ({
      id: 567_000 + matchday * 100 + i,
      utcDate: '2026-11-08T15:30:00Z',
      status: 'FINISHED',
      matchday,
      stage: 'REGULAR_SEASON',
      group: null,
      homeTeam: team(2 * i),
      awayTeam: team(2 * i + 1),
      score: { duration: 'REGULAR', fullTime: { home: i % 3, away: i % 2 } },
    })),
  }
}

/** Scoreboard da ESPN para uma data: 10 jogos entre 20 times, todos agendados. */
function espnScoreboard(date: string) {
  const events = Array.from({ length: 10 }, (_, i) => {
    const ev = structuredClone(template.events[0]) as EspnScoreboardEvent
    ev.id = `${date}-${i}`
    ev.date = '2026-10-14T22:00Z'
    ev.season = { year: 2026, slug: 'semifinals' }
    const comp = ev.competitions![0]
    comp.status = { type: { state: 'pre', name: 'STATUS_SCHEDULED', completed: false } }
    const [home, away] = comp.competitors!
    for (const [side, n] of [
      [home, 2 * i],
      [away, 2 * i + 1],
    ] as const) {
      const id = String(7000 + n)
      side.id = id
      side.team = { ...side.team, id, displayName: `Time ESPN ${id}`, abbreviation: `E${n}` }
      side.score = undefined
      side.winner = undefined
    }
    return ev
  })
  return { events }
}

/** Quem responde cada provedor: `null` é a resposta normal. */
type Behavior = { fd: null | (() => Response); espn: null | (() => Response) }

/**
 * Banco de teste e os dois provedores simulados. O `fetch` conta na mesma conta do
 * D1 (`armLimit`), e a limpeza de segurança e o dreno rodam pelo `scheduled`.
 */
async function setupWorld() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const behavior: Behavior = { fd: null, espn: null }
  const fetches = { fd: 0, espn: 0 }
  let chargeFetch: () => void = () => {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      chargeFetch()
      const url = new URL(String(input))
      if (url.hostname === 'api.football-data.org') {
        fetches.fd += 1
        return (
          behavior.fd?.() ??
          Response.json(fdCalendar(Number(url.searchParams.get('matchday') ?? '1')))
        )
      }
      fetches.espn += 1
      return behavior.espn?.() ?? Response.json(espnScoreboard(url.searchParams.get('dates') ?? ''))
    }),
  )
  // Semente: a competição da football-data e as 16 rodadas dela na fila; as 16 datas da ESPN.
  await syncFixtures({ competitionCode: 'PPL', season: 2026, matchday: 1, db, apiKey: 'test' })
  const { id } = sqlite.prepare(`SELECT id FROM competitions WHERE external_id = '2017'`).get() as {
    id: string
  }
  await enqueueProviderWork(
    db,
    Array.from({ length: FD_ITEMS }, (_, i) => ({
      kind: 'result' as const,
      competitionCode: 'PPL',
      season: '2026',
      round: String(i + 1),
      competitionId: id,
    })),
    FIRST_TICK,
  )
  await enqueueProviderWork(
    db,
    espnWorkItems(
      {
        kind: 'result',
        competitionCode: 'conmebol.sudamericana',
        season: '2026',
        competitionId: '',
      },
      Array.from({ length: ESPN_ITEMS }, (_, i) => String(20261001 + i)),
    ),
    FIRST_TICK,
  )
  fetches.fd = 0
  fetches.espn = 0

  const limited = limitD1Calls(db)
  chargeFetch = limited.chargeFetch
  const writeDataPoint = vi.fn()
  const env = {
    DB: limited.db,
    AE: { writeDataPoint },
    FOOTBALL_API_KEY: 'test',
    FRONTEND_URL: 'http://localhost:5173',
    JWT_SECRET: 'jwt-secret',
    BASE_URL: 'https://api.example.test',
  } as unknown as Env
  return { sqlite, db, behavior, fetches, limited, env, writeDataPoint }
}

type World = Awaited<ReturnType<typeof setupWorld>>

/** Um tick de dreno do cron fundido, no minuto dado. Devolve as falhas das rotinas. */
async function runDrainTick(h: { limited: LimitedD1; env: Env }, at: number): Promise<string[]> {
  vi.setSystemTime(at)
  h.limited.startInvocation()
  const pending: Promise<unknown>[] = []
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as ExecutionContext
  const controller = { cron: POLLER_AND_DRAIN_CRON, scheduledTime: at } as ScheduledController
  await worker.scheduled!(controller, h.env, ctx)
  const settled = await Promise.allSettled(pending)
  return settled.flatMap((r) =>
    r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : [],
  )
}

const count = (sqlite: DatabaseSync, where: string): number =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM provider_work WHERE ${where}`).get() as { n: number })
    .n

const done = (sqlite: DatabaseSync, provider: string) =>
  count(sqlite, `provider = '${provider}' AND status = 'done'`)

/** O tick respeitou os 50 da plataforma e os 45 do dreno, sem a limpeza (46 com ela). */
function expectWithinBudget(limited: LimitedD1) {
  expect(limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
  expect(limited.calls()).toBeLessThanOrEqual(DRAIN_CALL_BUDGET + CLEANUP_CALLS)
}

/** Nenhum item preso e nenhuma tentativa gasta pelo que o saldo devolveu. */
function expectNothingStuck(h: World) {
  expect(count(h.sqlite, `status = 'running'`)).toBe(0)
  expect(count(h.sqlite, `attempts > 0`)).toBe(0)
}

describe('dois drenos no mesmo tick sob 50 subrequests', () => {
  it('32 itens (16 de cada): no primeiro tick os dois avançam, o tick fica dentro de 46 e nada fica preso', async () => {
    const h = await setupWorld()

    expect(await runDrainTick(h, FIRST_TICK)).toEqual([])

    expectWithinBudget(h.limited)
    expectNothingStuck(h)
    // Cada dreno recebeu a fatia dele (22 e 22): 2 itens de cada, nenhum ficou sem vez.
    expect(done(h.sqlite, 'football-data')).toBe(2)
    expect(done(h.sqlite, 'espn')).toBe(2)
    // A limpeza (1), a sondagem (1), a football-data (reclamar, 2 itens de 7 e o estado: 16)
    // e a ESPN (reclamar, 2 itens de 9 e o estado: 20).
    expect(h.limited.calls()).toBe(CLEANUP_CALLS + PROBE_CALLS + 16 + 20)
    // O saldo não comporta os 32: o resto espera, intacto, o tick seguinte.
    expect(count(h.sqlite, `status = 'pending'`)).toBeGreaterThan(0)
    expect(h.fetches.fd).toBe(done(h.sqlite, 'football-data'))
    expect(h.fetches.espn).toBe(done(h.sqlite, 'espn'))
  })

  it('a fila dos dois provedores retoma nos ticks seguintes até o fim, sem item repetido nem tentativa gasta', async () => {
    const h = await setupWorld()
    const perTick: { calls: number; fd: number; espn: number }[] = []

    for (const at of DRAIN_TICKS) {
      if (count(h.sqlite, `status = 'done'`) === FD_ITEMS + ESPN_ITEMS) break
      const before = { ...h.fetches }
      expect(await runDrainTick(h, at)).toEqual([])
      expectWithinBudget(h.limited)
      expectNothingStuck(h)
      perTick.push({
        calls: h.limited.calls(),
        fd: h.fetches.fd - before.fd,
        espn: h.fetches.espn - before.espn,
      })
    }

    expect(done(h.sqlite, 'football-data')).toBe(FD_ITEMS)
    expect(done(h.sqlite, 'espn')).toBe(ESPN_ITEMS)
    // Cada item sai uma vez só: o saldo recusa antes de começar, não no meio.
    expect(h.fetches.fd).toBe(FD_ITEMS)
    expect(h.fetches.espn).toBe(ESPN_ITEMS)
    expect(perTick.length).toBeLessThanOrEqual(DRAIN_TICKS.length)
    // O calendário da ESPN foi gravado por inteiro: 16 datas de 10 jogos.
    expect(
      (
        h.sqlite.prepare(`SELECT COUNT(*) AS n FROM matches WHERE provider = 'espn'`).get() as {
          n: number
        }
      ).n,
    ).toBe(ESPN_ITEMS * 10)
  })

  it('só a ESPN com trabalho: a football-data ociosa nem roda e a ESPN fica com os 44', async () => {
    const h = await setupWorld()
    h.sqlite.exec(`DELETE FROM provider_work WHERE provider = 'football-data'`)

    expect(await runDrainTick(h, FIRST_TICK)).toEqual([])

    expectWithinBudget(h.limited)
    expectNothingStuck(h)
    // Sem a sondagem seriam 2 itens (a fatia de 22); com ela, os 4 que os 44 comportam.
    expect(done(h.sqlite, 'espn')).toBe(4)
    // A limpeza (1), a sondagem (1) e a ESPN: reclamar, 4 itens de 9 e o estado (38).
    expect(h.limited.calls()).toBe(CLEANUP_CALLS + PROBE_CALLS + 38)
  })

  it('só a football-data com trabalho: a ESPN ociosa nem roda e a football-data volta aos 5 itens por tick da #771', async () => {
    const h = await setupWorld()
    h.sqlite.exec(`DELETE FROM provider_work WHERE provider = 'espn'`)

    expect(await runDrainTick(h, FIRST_TICK)).toEqual([])

    expectWithinBudget(h.limited)
    expectNothingStuck(h)
    expect(done(h.sqlite, 'football-data')).toBe(5)
    expect(h.fetches).toEqual({ fd: 5, espn: 0 })
    // Os 38 da #771 (a limpeza, reclamar, 5 itens de 7 e o estado) e a sondagem.
    expect(h.limited.calls()).toBe(38 + PROBE_CALLS)
  })

  it('orçamento do minuto cheio nos dois provedores: encerra na primeira vaga recusada de cada um, sem item preso', async () => {
    const h = await setupWorld()
    setFootballDataRateLimitForTests(8)
    setProviderRateLimitForTests('espn', 40)
    const window = Math.floor(FIRST_TICK / MIN)
    h.sqlite.exec(
      `UPDATE provider_rate_state SET window_started_at = ${window},
         window_calls = CASE provider WHEN 'espn' THEN 40 ELSE 8 END`,
    )

    expect(await runDrainTick(h, FIRST_TICK)).toEqual([])

    expectWithinBudget(h.limited)
    expectNothingStuck(h)
    // Nenhum fetch saiu: a vaga recusada encerra o dreno do provedor, que não tenta os demais itens.
    expect(h.fetches).toEqual({ fd: 0, espn: 0 })
    expect(count(h.sqlite, `status = 'pending' AND attempts = 0`)).toBe(FD_ITEMS + ESPN_ITEMS)
    // O que não coube na janela deste minuto espera a seguinte, os outros ficam prontos para o tick.
    expect(count(h.sqlite, `not_before = ${(window + 1) * MIN}`)).toBeGreaterThan(0)

    // Com a janela livre, a fila dos dois termina nos ticks seguintes.
    setFootballDataRateLimitForTests(1000)
    setProviderRateLimitForTests('espn', 1000)
    for (const at of DRAIN_TICKS.slice(1)) {
      if (count(h.sqlite, `status = 'done'`) === FD_ITEMS + ESPN_ITEMS) break
      expect(await runDrainTick(h, at)).toEqual([])
      expectWithinBudget(h.limited)
      expectNothingStuck(h)
    }
    expect(count(h.sqlite, `status = 'done'`)).toBe(FD_ITEMS + ESPN_ITEMS)
  })

  it('403 da ESPN no meio do tick: o dreno dela encerra, a football-data segue e o total fica dentro dos 45', async () => {
    const h = await setupWorld()
    h.behavior.espn = () => new Response('{"message":"proibido"}', { status: 403 })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await runDrainTick(h, FIRST_TICK)).toEqual([])

    expectWithinBudget(h.limited)
    expectNothingStuck(h)
    // Um só fetch à ESPN: o 403 vale para o provedor inteiro. A football-data não foi afetada.
    expect(h.fetches.espn).toBe(1)
    expect(done(h.sqlite, 'football-data')).toBeGreaterThan(0)
    expect(done(h.sqlite, 'espn')).toBe(0)
    expect(
      h.sqlite
        .prepare(
          `SELECT forbidden_streak, blocked_until FROM provider_rate_state WHERE provider = 'espn'`,
        )
        .get(),
    ).toEqual({ forbidden_streak: 1, blocked_until: FIRST_TICK + 15 * MIN })

    // Nos ticks dentro do bloqueio a ESPN gasta só a leitura do estado e a football-data usa o resto.
    const fetchesBefore = h.fetches.espn
    expect(await runDrainTick(h, DRAIN_TICKS[1])).toEqual([])
    expectWithinBudget(h.limited)
    expect(h.fetches.espn).toBe(fetchesBefore)

    // Passado o bloqueio, com a ESPN de volta, o resto da fila termina sem tentativa gasta.
    h.behavior.espn = null
    for (const at of DRAIN_TICKS.slice(2)) {
      if (count(h.sqlite, `status = 'done'`) === FD_ITEMS + ESPN_ITEMS) break
      expect(await runDrainTick(h, at)).toEqual([])
      expectWithinBudget(h.limited)
      expectNothingStuck(h)
    }
    expect(count(h.sqlite, `status = 'done'`)).toBe(FD_ITEMS + ESPN_ITEMS)
  })

  it('ESPN suspensa: a ESPN gasta 1 chamada por tick, nenhum item dela é reclamado e a football-data usa o resto', async () => {
    const h = await setupWorld()
    h.sqlite.exec(
      `UPDATE provider_rate_state SET suspended_at = ${FIRST_TICK}, suspended_reason = 'http_401' WHERE provider = 'espn'`,
    )

    expect(await runDrainTick(h, FIRST_TICK)).toEqual([])

    expectWithinBudget(h.limited)
    expectNothingStuck(h)
    expect(h.fetches.espn).toBe(0)
    expect(done(h.sqlite, 'espn')).toBe(0)
    expect(count(h.sqlite, `provider = 'espn' AND status = 'pending' AND not_before = 0`)).toBe(
      ESPN_ITEMS,
    )
    // O sinal para o operador: a execução saiu sem reclamar nada porque o acesso está suspenso.
    const runs = h.writeDataPoint.mock.calls
      .map(([point]) => point as { blobs: string[]; doubles: number[] })
      .filter((point) => point.blobs[0] === 'provider_work_run')
      .map((point) => point.blobs.slice(1, 3).join())
    expect(runs).toContain('suspended,espn')
  })

  it('registra, por provedor, as chamadas gastas, e a soma não passa dos 45 do ramo', async () => {
    const h = await setupWorld()

    await runDrainTick(h, FIRST_TICK)

    const runs = h.writeDataPoint.mock.calls
      .map(([point]) => point as { blobs: string[]; doubles: number[] })
      .filter((point) => point.blobs[0] === 'provider_work_run')
    const spent = (provider: string) =>
      runs
        .filter((point) => point.blobs[2] === provider)
        .reduce((sum, point) => sum + point.doubles[6], 0)
    expect(spent('football-data')).toBeGreaterThan(0)
    expect(spent('espn')).toBeGreaterThan(0)
    expect(spent('football-data') + spent('espn')).toBeLessThanOrEqual(DRAIN_CALL_BUDGET)
    expect(spent('football-data') + spent('espn')).toBe(
      h.limited.calls() - CLEANUP_CALLS - PROBE_CALLS,
    )
  })
})
