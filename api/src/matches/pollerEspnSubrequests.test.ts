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
import { D1_CALLS_PER_INVOCATION, limitD1Calls } from '../testing/d1CallLimit'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { clearFootballDataPause } from './footballDataQuota'
import { espnDate } from './matchPollingWindow'
import { setFootballDataRateLimitForTests, setProviderRateLimitForTests } from './providerBudget'
import { syncEspnFixtures } from './espnSync'
import { syncFixtures } from './sync'

/**
 * O poller com a ESPN sob o limite de 50 subrequests por invocação do plano Free
 * (ADR-027, adendo do ticket 03). O `scheduled` real roda no minuto 30 (poller),
 * sobre o SQLite das migrations, com a limpeza de segurança do `scheduled`
 * (1 chamada) na mesma conta. O D1 recusa a chamada 51, e cada `fetch` conta na
 * mesma conta. O que não cabe no saldo do tick vai para a fila durável por data,
 * sem erro de provedor e sem tentativa gasta, e o dreno e os ticks seguintes
 * terminam com o resultado e a pontuação de um tick sem limite.
 */

const TICK = Date.UTC(2026, 10, 17, 14, 30, 0)
const MIN = 60_000
const HOUR = 60 * MIN
const SLUGS = [
  'conmebol.libertadores',
  'conmebol.sudamericana',
  'bra.copa_do_brazil',
  'bra.2',
] as const
/** Ticks seguintes do cron fundido: o dreno nos minutos 5, 10, 20, 25, 35, 40, 50 e 55 e o poller nos 0 e 30. */
const FOLLOWING_TICKS = [14, 15, 16]
  .flatMap((hour) =>
    [0, 5, 10, 20, 25, 30, 35, 40, 50, 55].map((minute) => Date.UTC(2026, 10, 17, hour, minute, 0)),
  )
  .filter((at) => at > TICK)
/** A limpeza de registros expirados do `scheduled` é 1 chamada. */
const CLEANUP_CALLS = 1

const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers({ now: TICK, toFake: ['Date'] })
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

/** Jogo de uma competição da ESPN: quando começou, em horas antes do tick. */
type EspnGame = { key: string; startedHoursAgo: number }

const TODAY: EspnGame = { key: 'hoje', startedHoursAgo: 130 / 60 }
/** Começou ontem à noite: ainda no resgate de 24 h, e a data do scoreboard é a do dia anterior. */
const YESTERDAY: EspnGame = { key: 'ontem', startedHoursAgo: 16.5 }

function espnEvent(slug: string, game: EspnGame, finished: boolean): EspnScoreboardEvent {
  const ev = structuredClone(template.events[0]) as EspnScoreboardEvent
  ev.id = `ev-${slug}-${game.key}`
  ev.date = new Date(TICK - game.startedHoursAgo * HOUR).toISOString().slice(0, 16) + 'Z'
  ev.season = { year: 2026, slug: 'semifinals' }
  const comp = ev.competitions![0]
  comp.status = {
    type: {
      state: finished ? 'post' : 'pre',
      name: finished ? 'STATUS_FINAL' : 'STATUS_SCHEDULED',
      completed: finished,
    },
  }
  const [home, away] = comp.competitors!
  for (const [side, tag, score] of [
    [home, 'm', '2'],
    [away, 'v', '1'],
  ] as const) {
    const id = `${slug}-${game.key}-${tag}`
    side.id = id
    side.team = { ...side.team, id, displayName: `Time ${id}`, abbreviation: tag.toUpperCase() }
    side.score = finished ? score : undefined
    side.winner = undefined
  }
  return ev
}

/** Calendário da football-data: uma rodada de 10 jogos que começou na janela do tick. */
function fdCalendar(matchday: number, status: 'TIMED' | 'FINISHED') {
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
      utcDate: new Date(TICK - 130 * MIN).toISOString().slice(0, 19) + 'Z',
      status,
      matchday,
      stage: 'REGULAR_SEASON',
      group: null,
      homeTeam: team(2 * i),
      awayTeam: team(2 * i + 1),
      score: {
        duration: 'REGULAR',
        fullTime: status === 'FINISHED' ? { home: i % 3, away: i % 2 } : { home: null, away: null },
      },
    })),
  }
}

type WorldOptions = {
  comps: number
  games: EspnGame[]
  /** Rodadas da football-data com jogo na janela; cada uma é uma tarefa do poller. */
  fdRounds?: number
  /** D1 que recusa a chamada 51 (padrão) ou só conta. */
  limit?: number | null
}

type Behavior = {
  espn: null | ((slug: string, date: string) => Response | null)
  fd: null | (() => Response | null)
}

/**
 * Banco com as competições e os jogos já gravados (agendados, como ficam depois
 * da descoberta) e os provedores simulados, que respondem o resultado final.
 */
async function setupWorld(options: WorldOptions) {
  const { comps, games, fdRounds = 0, limit = D1_CALLS_PER_INVOCATION } = options
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec('DELETE FROM competitions')
  const slugs = SLUGS.slice(0, comps)
  const behavior: Behavior = { espn: null, fd: null }
  const fetches = { espn: 0, fd: 0 }
  const requested: string[] = []
  let chargeFetch: () => void = () => {}
  let live = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      chargeFetch()
      const url = new URL(String(input))
      if (url.hostname === 'api.football-data.org') {
        fetches.fd += 1
        const matchday = Number(url.searchParams.get('matchday') ?? '1')
        return behavior.fd?.() ?? Response.json(fdCalendar(matchday, live ? 'FINISHED' : 'TIMED'))
      }
      fetches.espn += 1
      const slug = url.pathname.split('/').at(-2) ?? ''
      const date = url.searchParams.get('dates') ?? ''
      requested.push(`${slug}:${date}`)
      const custom = behavior.espn?.(slug, date)
      if (custom) return custom
      if (date === 'seed') {
        return Response.json({ events: games.map((game) => espnEvent(slug, game, false)) })
      }
      // A data do scoreboard é a do dia UTC do início do jogo.
      const events = games
        .filter((game) => espnDate(TICK - game.startedHoursAgo * HOUR) === date)
        .map((game) => espnEvent(slug, game, true))
      return Response.json({ events })
    }),
  )
  for (const slug of slugs) {
    await syncEspnFixtures({ db, competitionCode: slug, season: 2026, dates: ['seed'] })
  }
  for (let round = 1; round <= fdRounds; round++) {
    await syncFixtures({
      competitionCode: 'PPL',
      season: 2026,
      matchday: round,
      db,
      apiKey: 'test',
    })
  }
  live = true
  fetches.espn = 0
  fetches.fd = 0
  requested.length = 0

  const limited = limitD1Calls(db, limit)
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
  const events = (type: string) =>
    writeDataPoint.mock.calls
      .map(([point]) => point as { blobs: string[]; doubles: number[] })
      .filter((point) => point.blobs[0] === type)
  return { sqlite, db, behavior, fetches, requested, limited, env, events, slugs }
}

type World = Awaited<ReturnType<typeof setupWorld>>

/** Um tick do cron fundido, no instante dado. Devolve as falhas das rotinas. */
async function runTick(h: Pick<World, 'limited' | 'env'>, at: number): Promise<string[]> {
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

/** Estado final dos jogos, por competição e id no provedor: o que um tick sem limite deixa. */
function snapshot(sqlite: DatabaseSync) {
  return sqlite
    .prepare(
      `SELECT c.provider AS provider, m.external_id AS external_id, m.status AS status,
              m.home_score AS home, m.away_score AS away, m.scored_at IS NOT NULL AS scored
         FROM matches m JOIN competitions c ON c.id = m.competition_id
        ORDER BY c.provider, m.external_id`,
    )
    .all()
}

const workCount = (sqlite: DatabaseSync, where: string): number =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM provider_work WHERE ${where}`).get() as { n: number })
    .n

const finishedMatches = (sqlite: DatabaseSync): number =>
  (
    sqlite.prepare(`SELECT COUNT(*) AS n FROM matches WHERE status = 'finished'`).get() as {
      n: number
    }
  ).n

/** Tudo terminou: jogos encerrados e pontuados, fila vazia de pendências. */
function settled(sqlite: DatabaseSync): boolean {
  const open = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM matches WHERE status != 'finished' OR scored_at IS NULL`)
    .get() as { n: number }
  return open.n === 0 && workCount(sqlite, `status IN ('pending', 'running')`) === 0
}

/** Roda os ticks seguintes até tudo terminar, conferindo o limite em cada um. */
async function drainUntilSettled(h: World) {
  for (const at of FOLLOWING_TICKS) {
    if (settled(h.sqlite)) return
    expect(await runTick(h, at)).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    expect(workCount(h.sqlite, `status = 'running'`)).toBe(0)
    expect(workCount(h.sqlite, `attempts > 0`)).toBe(0)
  }
}

/** Um tick sem limite de chamadas, na mesma semente: o resultado que a fila deve reproduzir. */
async function controlSnapshot(options: WorldOptions) {
  // A pausa por cota da football-data é do isolate: o mundo de controle começa sem ela.
  clearFootballDataPause()
  const control = await setupWorld({ ...options, limit: null })
  expect(await runTick(control, TICK)).toEqual([])
  for (const at of FOLLOWING_TICKS) {
    if (settled(control.sqlite)) break
    await runTick(control, at)
  }
  expect(settled(control.sqlite)).toBe(true)
  return snapshot(control.sqlite)
}

function expectNoProviderError(h: World) {
  expect(h.events('football_api_error')).toEqual([])
  expect(h.events('match_results_fallback').filter((e) => e.blobs.length > 2)).toEqual([])
}

describe('poller com a ESPN no limite de 50 subrequests', () => {
  it('4 competições, 1 jogo cada, 2 datas: o tick fica em 50, não rejeita e o que não coube vai para a fila por data', async () => {
    const options = { comps: 4, games: [TODAY] }
    const h = await setupWorld(options)

    const failures = await runTick(h, TICK)

    // Antes: 52 chamadas tentadas, a 51 e a 52 recusadas, 4 jogos encerrados e sem pontuação.
    expect(failures).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    expect(h.limited.calls() - CLEANUP_CALLS).toBeLessThanOrEqual(45)
    expectNoProviderError(h)
    // Resultados da janela ativa primeiro: 3 competições cabem (3 tarefas de 12), e a 4ª, que não
    // cabe, espera na fila. Os 6 requests são os das 3 admitidas, e o tick gasta 45 com a limpeza.
    expect(h.limited.calls()).toBe(45)
    expect(h.fetches.espn).toBe(6)
    const synced = finishedMatches(h.sqlite)
    expect(synced).toBe(3)
    const deferred = 4 - synced
    expect(workCount(h.sqlite, `provider = 'espn' AND status = 'pending' AND attempts = 0`)).toBe(
      deferred * 2,
    )
    expect(workCount(h.sqlite, `status IN ('failed', 'running')`)).toBe(0)
    // Sem erro de provedor falso: o adiamento por saldo não é falha e vale já para o próximo dreno.
    expect(workCount(h.sqlite, `last_error LIKE '%saldo%' AND not_before <= ${TICK}`)).toBe(
      deferred * 2,
    )

    // O dreno e os ticks seguintes terminam, com o resultado e a pontuação de um tick sem limite.
    await drainUntilSettled(h)
    expect(settled(h.sqlite)).toBe(true)
    expect(snapshot(h.sqlite)).toEqual(await controlSnapshot(options))
  })

  it('4 competições com jogos de hoje e do dia anterior (3 datas cada): o tick fica dentro do limite e nada se perde', async () => {
    const options = { comps: 4, games: [TODAY, YESTERDAY] }
    const h = await setupWorld(options)

    const failures = await runTick(h, TICK)

    // Antes: 55 chamadas tentadas e o tick rejeitado com D1_ERROR, sem nenhuma pendência gravada.
    expect(failures).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    expect(h.limited.calls() - CLEANUP_CALLS).toBeLessThanOrEqual(45)
    expectNoProviderError(h)
    // 2 competições cabem (2 tarefas de 16, 3 datas cada); as outras 2 estão na fila, uma linha por
    // data, sem tentativa gasta, e o tick gasta 43 com a limpeza.
    expect(h.limited.calls()).toBe(43)
    expect(h.fetches.espn).toBe(6)
    expect(workCount(h.sqlite, `provider = 'espn' AND status = 'pending'`)).toBe(6)
    expect(workCount(h.sqlite, `attempts > 0 OR status IN ('failed', 'running')`)).toBe(0)

    await drainUntilSettled(h)
    expect(settled(h.sqlite)).toBe(true)
    expect(snapshot(h.sqlite)).toEqual(await controlSnapshot(options))
  })

  it('football-data e ESPN no mesmo tick: o orçamento de 45 do poller vale para o conjunto', async () => {
    const options = { comps: 3, games: [TODAY], fdRounds: 2 }
    const h = await setupWorld(options)

    const failures = await runTick(h, TICK)

    expect(failures).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    expect(h.limited.calls() - CLEANUP_CALLS).toBeLessThanOrEqual(45)
    // A football-data segue como estava: as duas rodadas foram sincronizadas no tick.
    expect(h.fetches.fd).toBe(2)
    expect(workCount(h.sqlite, `provider = 'football-data'`)).toBe(0)
    expectNoProviderError(h)
    // 39 com a limpeza: as 2 rodadas e 1 competição ESPN (2 datas) no tick; as outras 2
    // competições ficam na fila, uma linha por data, sem tentativa gasta.
    expect(h.limited.calls()).toBe(39)
    expect(h.fetches.espn).toBe(2)
    expect(workCount(h.sqlite, `provider = 'espn' AND status = 'pending' AND attempts = 0`)).toBe(4)

    await drainUntilSettled(h)
    expect(snapshot(h.sqlite)).toEqual(await controlSnapshot(options))
  })

  it('football-data com 429 e retry no mesmo tick da ESPN: o retry cabe e o total continua dentro do limite', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ now: TICK, toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const options = { comps: 4, games: [TODAY], fdRounds: 2 }
    const h = await setupWorld(options)
    let first = true
    h.behavior.fd = () => {
      if (!first) return null
      first = false
      return Response.json(
        { message: 'limite' },
        { status: 429, headers: { 'X-RequestCounter-Reset': '2' } },
      )
    }

    const tick = runTick(h, TICK)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await tick).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    expectNoProviderError(h)
    // 2 rodadas e o retry do 429: 3 requests à football-data, nenhum perdido.
    expect(h.fetches.fd).toBe(3)
    expect(workCount(h.sqlite, `attempts > 0 OR status IN ('failed', 'running')`)).toBe(0)

    await drainUntilSettled(h)
    expect(snapshot(h.sqlite)).toEqual(await controlSnapshot(options))
  })

  it('ESPN em 429 com Retry-After no meio do tick: um só request, o resto adiado para o prazo, dentro do limite', async () => {
    const options = { comps: 4, games: [TODAY] }
    const h = await setupWorld(options)
    h.behavior.espn = () =>
      new Response('{"message":"limite"}', { status: 429, headers: { 'Retry-After': '120' } })

    const failures = await runTick(h, TICK)

    expect(failures).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    // O 429 vale para o provedor inteiro: nenhuma competição tenta de novo no tick.
    expect(h.fetches.espn).toBe(1)
    expect(finishedMatches(h.sqlite)).toBe(0)
    expect(workCount(h.sqlite, `provider = 'espn' AND status = 'pending' AND attempts = 0`)).toBe(8)
    // O prazo é o do Retry-After, sem encurtar.
    expect(workCount(h.sqlite, `not_before = ${TICK + 120_000}`)).toBe(8)

    // Passado o prazo, o dreno e os ticks seguintes terminam com o resultado de um tick sem limite.
    h.behavior.espn = null
    await drainUntilSettled(h)
    expect(snapshot(h.sqlite)).toEqual(await controlSnapshot(options))
  })

  it('o caso comum, 1 competição da ESPN: nada é adiado e o tick faz as mesmas 20 chamadas de antes', async () => {
    const options = { comps: 1, games: [TODAY] }
    const h = await setupWorld(options)

    expect(await runTick(h, TICK)).toEqual([])

    // O mesmo número que o poller gastava antes da admissão por custo: a leitura dos jogos, as 2
    // datas (vaga, fetch e registro cada), a gravação, a leitura das pendências de pontuação, a
    // pontuação, o relatório e a limpeza do `scheduled`.
    expect(h.limited.calls()).toBe(20)
    expect(h.fetches.espn).toBe(2)
    expect(workCount(h.sqlite, `1 = 1`)).toBe(0)
    expect(settled(h.sqlite)).toBe(true)
    expectNoProviderError(h)
    expect(snapshot(h.sqlite)).toEqual(await controlSnapshot(options))
  })
})

describe('poller com a ESPN: varredura de atrasados', () => {
  it('sem jogo na janela, a tarefa da varredura é admitida pelo mesmo custo e adiada como as demais', async () => {
    // O poller só varre atrasados no primeiro tick de cada bloco de 3 h, em tick ocioso.
    const sweepTick = Date.UTC(2026, 10, 17, 15, 0, 0)
    const h = await setupWorld({ comps: 1, games: [{ key: 'antigo', startedHoursAgo: 72 }] })

    expect(await runTick(h, sweepTick)).toEqual([])

    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    expect(h.fetches.espn).toBe(2)
    expect(workCount(h.sqlite, `1 = 1`)).toBe(0)
    expectNoProviderError(h)
  })
})

describe('poller com a ESPN: números por tick', () => {
  it.each([
    [1, 20],
    [2, 36],
    [3, 44],
  ])(
    '%i competições da ESPN com 1 jogo na janela cabem inteiras: %i chamadas com a limpeza',
    async (comps, calls) => {
      const h = await setupWorld({ comps, games: [TODAY] })

      expect(await runTick(h, TICK)).toEqual([])

      expect(h.limited.calls()).toBe(calls)
      expect(finishedMatches(h.sqlite)).toBe(comps)
      expect(workCount(h.sqlite, `1 = 1`)).toBe(0)
    },
  )
})
