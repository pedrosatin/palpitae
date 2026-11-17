/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_DISCOVERY_CRON, POLLER_AND_DRAIN_CRON } from '../crons'
import worker from '../index'
import template from '../providers/__fixtures__/espn-conmebol-sudamericana-scoreboard.json'
import {
  resetEspnClientForTests,
  setEspnMinIntervalForTests,
  type EspnScoreboardEvent,
} from '../providers/espn'
import { D1_CALLS_PER_INVOCATION, limitD1Calls } from '../testing/d1CallLimit'
import { flakyD1 } from '../testing/flakyD1'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { syncEspnFixtures } from './espnSync'
import { discoverFixtures } from './fixtureDiscovery'
import { clearFootballDataPause } from './footballDataQuota'
import { espnDate } from './matchPollingWindow'
import { setFootballDataRateLimitForTests, setProviderRateLimitForTests } from './providerBudget'
import { syncFixtures } from './sync'

/**
 * A descoberta diária (`15 6 * * *`) sob o limite de 50 subrequests por invocação
 * do plano Free (ADR-027, adendo do ticket 03). O `scheduled` real roda sobre o
 * SQLite das migrations, com a limpeza de segurança (1 chamada) na mesma conta, o
 * D1 recusando a chamada 51 e cada `fetch` contado. O que não cabe no saldo da
 * invocação vai para a fila durável como item `discovery`, num batch reservado, e
 * o dreno o conclui nos ticks seguintes, com o estado final de uma descoberta sem
 * limite de chamadas.
 */

const DAY = 24 * 60 * 60_000
const DISCOVERY_AT = Date.UTC(2026, 10, 17, 6, 15, 0)
const TODAY = Date.UTC(2026, 10, 17)
const ESPN_SLUGS = [
  'conmebol.libertadores',
  'conmebol.sudamericana',
  'bra.copa_do_brazil',
  'bra.2',
] as const
const FD_CODES = [
  { code: 'PPL', id: 2017 },
  { code: 'PD', id: 2014 },
  { code: 'SA', id: 2019 },
  { code: 'PL', id: 2021 },
] as const
/** Minutos do dreno no trigger fundido, a partir das 06:20 (os minutos 0 e 30 são do poller). */
const DRAIN_TICKS = [6, 7, 8, 9, 10, 11].flatMap((hour) =>
  [5, 10, 20, 25, 35, 40, 50, 55].map((minute) => Date.UTC(2026, 10, 17, hour, minute, 0)),
)
/** A limpeza de registros expirados do `scheduled` é 1 chamada. */
const CLEANUP_CALLS = 1

const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers({ now: DISCOVERY_AT, toFake: ['Date'] })
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

/** Jogo de uma competição da ESPN: o dia dele em relação a hoje e o estado. */
type EspnGame = { key: string; dayOffset: number; finished?: boolean }

/** O jogo que o banco já tem (amanhã), os novos de ontem, depois de amanhã e daqui a 5 dias. */
const SEEDED: EspnGame = { key: 'semente', dayOffset: 1 }
const NEW_GAMES: EspnGame[] = [
  { key: 'ontem', dayOffset: -1, finished: true },
  { key: 'novo-1', dayOffset: 2 },
  { key: 'novo-2', dayOffset: 5 },
]

function espnEvent(slug: string, game: EspnGame, finished: boolean): EspnScoreboardEvent {
  const ev = structuredClone(template.events[0]) as EspnScoreboardEvent
  ev.id = `ev-${slug}-${game.key}`
  ev.date = new Date(TODAY + game.dayOffset * DAY + 20 * 3_600_000).toISOString().slice(0, 16) + 'Z'
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

/** Calendário da football-data: o jogo que o banco já tem e os 2 novos, todos agendados. */
function fdCalendar(code: string, id: number, withNew: boolean) {
  const team = (n: number) => ({
    id: id * 100 + n,
    name: `Time ${code}-${n}`,
    shortName: `${code}${n}`,
    tla: 'TIM',
  })
  const game = (n: number, dayOffset: number) => ({
    id: id * 1000 + n,
    utcDate: new Date(TODAY + dayOffset * DAY + 20 * 3_600_000).toISOString().slice(0, 19) + 'Z',
    status: 'TIMED',
    matchday: n,
    stage: 'REGULAR_SEASON',
    group: null,
    homeTeam: team(2 * n),
    awayTeam: team(2 * n + 1),
    score: { duration: 'REGULAR', fullTime: { home: null, away: null } },
  })
  return {
    competition: { id, code, name: code },
    matches: [game(1, 1), ...(withNew ? [game(2, 3), game(3, 6)] : [])],
  }
}

type WorldOptions = {
  /** Competições da ESPN com jogos a descobrir (9 datas cada). */
  espn: number
  /** Competições da football-data com jogos a descobrir (1 request cada). */
  fd?: number
  /** D1 que recusa a chamada 51 (padrão) ou só conta. */
  limit?: number | null
  /** Envolve o D1 do Worker (depois da semente) com uma falha simulada. */
  wrap?: (db: D1Database) => D1Database
}

type Behavior = { espn: null | ((slug: string, date: string) => Response | null) }

async function setupWorld(options: WorldOptions) {
  const { espn, fd = 0, limit = D1_CALLS_PER_INVOCATION, wrap = (raw) => raw } = options
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec('DELETE FROM competitions')
  const behavior: Behavior = { espn: null }
  const fetches = { espn: 0, fd: 0 }
  let chargeFetch: () => void = () => {}
  let discovering = false
  const slugs = ESPN_SLUGS.slice(0, espn)
  const fdComps = FD_CODES.slice(0, fd)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      chargeFetch()
      const url = new URL(String(input))
      if (url.hostname === 'api.football-data.org') {
        fetches.fd += 1
        // A descoberta consulta pelo id numérico da competição; a semente, pelo código.
        const segment = url.pathname.split('/').at(-2) ?? ''
        const comp = fdComps.find((c) => c.code === segment || String(c.id) === segment)!
        return Response.json(fdCalendar(comp.code, comp.id, discovering))
      }
      fetches.espn += 1
      const slug = url.pathname.split('/').at(-2) ?? ''
      const date = url.searchParams.get('dates') ?? ''
      const custom = behavior.espn?.(slug, date)
      if (custom) return custom
      // A data do scoreboard é a do dia UTC do início do jogo; a semente só existe até a descoberta.
      const games = date === 'seed' ? [SEEDED] : discovering ? [SEEDED, ...NEW_GAMES] : [SEEDED]
      const events = games
        .filter(
          (game) =>
            date === 'seed' || espnDate(TODAY + game.dayOffset * DAY + 20 * 3_600_000) === date,
        )
        .map((game) => espnEvent(slug, game, Boolean(game.finished && date !== 'seed')))
      return Response.json({ events })
    }),
  )
  for (const slug of slugs) {
    await syncEspnFixtures({ db, competitionCode: slug, season: 2026, dates: ['seed'] })
  }
  for (const comp of fdComps) {
    await syncFixtures({ competitionCode: comp.code, season: 2026, db, apiKey: 'test' })
  }
  discovering = true
  fetches.espn = 0
  fetches.fd = 0

  const limited = limitD1Calls(wrap(db), limit)
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
  return { sqlite, db, behavior, fetches, limited, env, events, ae: env.AE, slugs, fdComps }
}

type World = Awaited<ReturnType<typeof setupWorld>>

/** Um tick do `scheduled` no cron e instante dados. Devolve as falhas das rotinas. */
async function runCron(
  h: Pick<World, 'limited' | 'env'>,
  cron: string,
  at: number,
): Promise<string[]> {
  vi.setSystemTime(at)
  h.limited.startInvocation()
  const pending: Promise<unknown>[] = []
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as ExecutionContext
  await worker.scheduled!({ cron, scheduledTime: at } as ScheduledController, h.env, ctx)
  const settled = await Promise.allSettled(pending)
  return settled.flatMap((r) =>
    r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : [],
  )
}

const runDiscovery = (h: Pick<World, 'limited' | 'env'>, at = DISCOVERY_AT) =>
  runCron(h, FIXTURE_DISCOVERY_CRON, at)

/** Estado final: jogos e status das competições, o que a descoberta sem limite deixa. */
function snapshot(sqlite: DatabaseSync) {
  return {
    matches: sqlite
      .prepare(
        `SELECT c.provider AS provider, m.external_id AS external_id, m.start_time AS start_time,
                m.status AS status, m.home_score AS home, m.away_score AS away,
                m.scored_at IS NOT NULL AS scored
           FROM matches m JOIN competitions c ON c.id = m.competition_id
          ORDER BY c.provider, m.external_id`,
      )
      .all(),
    competitions: sqlite
      .prepare(
        `SELECT external_id, provider, status FROM competitions ORDER BY provider, external_id`,
      )
      .all(),
  }
}

const workCount = (sqlite: DatabaseSync, where: string): number =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM provider_work WHERE ${where}`).get() as { n: number })
    .n

const matchCount = (sqlite: DatabaseSync): number =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM matches`).get() as { n: number }).n

const openWork = (sqlite: DatabaseSync): number =>
  workCount(sqlite, `status IN ('pending', 'running')`)

/** Roda os ticks do dreno, depois de `after`, até a fila esvaziar, conferindo o limite em cada um. */
async function drainUntilSettled(h: World, after = DISCOVERY_AT) {
  for (const at of DRAIN_TICKS.filter((tick) => tick > after)) {
    if (openWork(h.sqlite) === 0) return
    expect(await runCron(h, POLLER_AND_DRAIN_CRON, at)).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    expect(workCount(h.sqlite, `status = 'running'`)).toBe(0)
    expect(workCount(h.sqlite, `attempts > 0`)).toBe(0)
  }
}

/** A descoberta sem limite de chamadas, na mesma semente: o estado que a fila deve reproduzir. */
async function controlSnapshot(options: WorldOptions) {
  clearFootballDataPause()
  const control = await setupWorld({ ...options, limit: null })
  await discoverFixtures(control.db, 'test', control.ae, DISCOVERY_AT)
  expect(openWork(control.sqlite)).toBe(0)
  return snapshot(control.sqlite)
}

/** Jogos novos que a descoberta de cada competição traz: ontem, depois de amanhã e daqui a 5 dias. */
const NEW_PER_COMPETITION = NEW_GAMES.length

describe('descoberta da ESPN no limite de 50 subrequests', () => {
  it('2 competições × 9 datas: a descoberta não rejeita, grava o que cabe e enfileira o resto por data', async () => {
    const options = { espn: 2 }
    const h = await setupWorld(options)
    const before = matchCount(h.sqlite)

    const failures = await runDiscovery(h)

    // Antes: 56 chamadas tentadas, a descoberta rejeitada e nenhum jogo novo gravado.
    expect(failures).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    expect(h.limited.calls() - CLEANUP_CALLS).toBeLessThanOrEqual(45)
    // A 1ª competição cabe inteira (9 datas de 3 chamadas, a gravação, a pontuação, o status e a
    // leitura), e a limpeza soma 1: 41 chamadas, contra as 78 que as duas pedem sem limite.
    expect(h.limited.calls()).toBe(41)
    expect(h.fetches.espn).toBe(9)
    expect(matchCount(h.sqlite)).toBeGreaterThan(before)
    // A competição que não coube vai inteira para a fila: uma linha por data, pronta para o
    // próximo dreno, sem tentativa gasta e sem erro de provedor.
    expect(workCount(h.sqlite, `kind = 'discovery' AND status = 'pending' AND attempts = 0`)).toBe(
      9,
    )
    expect(workCount(h.sqlite, `status IN ('failed', 'running') OR attempts > 0`)).toBe(0)
    expect(workCount(h.sqlite, `not_before <= ${DISCOVERY_AT}`)).toBe(9)
    expect(h.events('football_api_error')).toEqual([])
    expect(h.events('fixture_discovery_run')[0].blobs[1]).toBe('ok')

    await drainUntilSettled(h)
    expect(openWork(h.sqlite)).toBe(0)
    expect(matchCount(h.sqlite)).toBe(before + 2 * NEW_PER_COMPETITION)
    expect(snapshot(h.sqlite)).toEqual(await controlSnapshot(options))
  })

  it('4 competições × 9 datas: nenhum jogo novo se perde, e o dreno termina com o estado de uma descoberta sem limite', async () => {
    const options = { espn: 4 }
    const h = await setupWorld(options)
    const before = matchCount(h.sqlite)

    const failures = await runDiscovery(h)

    expect(failures).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    expect(h.limited.calls() - CLEANUP_CALLS).toBeLessThanOrEqual(45)
    // 1 competição inteira coube; as outras 3 (27 datas) estão na fila.
    expect(workCount(h.sqlite, `kind = 'discovery' AND status = 'pending' AND attempts = 0`)).toBe(
      27,
    )
    expect(h.limited.calls()).toBe(41)
    expect(h.events('football_api_error')).toEqual([])
    // O status só avança com a descoberta completa: a competição da fila segue `upcoming` até o
    // último item dela terminar.
    expect(
      h.sqlite.prepare(`SELECT COUNT(*) AS n FROM competitions WHERE status = 'ongoing'`).get(),
    ).toEqual({ n: 1 })

    await drainUntilSettled(h)
    expect(openWork(h.sqlite)).toBe(0)
    expect(matchCount(h.sqlite)).toBe(before + 4 * NEW_PER_COMPETITION)
    expect(snapshot(h.sqlite)).toEqual(await controlSnapshot(options))
    // O status que a descoberta avança (um jogo encerrado põe a competição em andamento) chega a
    // todas, as da fila também.
    expect(
      h.sqlite.prepare(`SELECT COUNT(*) AS n FROM competitions WHERE status = 'ongoing'`).get(),
    ).toEqual({ n: 4 })
  })

  it('o caso comum, 1 competição da ESPN: nada é adiado e o estado final é o mesmo', async () => {
    const options = { espn: 1 }
    const h = await setupWorld(options)

    expect(await runDiscovery(h)).toEqual([])

    // 9 datas × 3 chamadas, a gravação, a pontuação, o status, a leitura da competição e a limpeza:
    // as mesmas 40 chamadas de antes da admissão por custo.
    expect(h.limited.calls()).toBe(40)
    expect(h.fetches.espn).toBe(9)
    expect(workCount(h.sqlite, `1 = 1`)).toBe(0)
    expect(h.events('football_api_error')).toEqual([])
    expect(snapshot(h.sqlite)).toEqual(await controlSnapshot(options))
  })

  it('football-data e ESPN na mesma invocação dividem o saldo de 45, e o que não cabe vai para a fila de cada dreno', async () => {
    const options = { espn: 2, fd: 4 }
    const h = await setupWorld(options)
    const before = matchCount(h.sqlite)

    const failures = await runDiscovery(h)

    expect(failures).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    expect(h.limited.calls() - CLEANUP_CALLS).toBeLessThanOrEqual(45)
    // A football-data (17 cada) entra primeiro: 2 competições cabem, e a ESPN (42) não cabe depois
    // delas. A fila fica com 2 itens da football-data (`round` vazio) e as 18 datas da ESPN.
    expect(h.fetches).toEqual({ espn: 0, fd: 2 })
    expect(workCount(h.sqlite, `provider = 'football-data' AND round = ''`)).toBe(2)
    expect(workCount(h.sqlite, `provider = 'espn'`)).toBe(18)
    expect(h.events('football_api_error')).toEqual([])

    await drainUntilSettled(h)
    expect(openWork(h.sqlite)).toBe(0)
    expect(matchCount(h.sqlite)).toBe(before + 2 * NEW_PER_COMPETITION + 4 * 2)
    expect(snapshot(h.sqlite)).toEqual(await controlSnapshot(options))
  })

  it('403 da ESPN no meio da descoberta: o resto vai para a fila no prazo do bloqueio, sem tentativa gasta', async () => {
    const h = await setupWorld({ espn: 2 })
    h.behavior.espn = () => new Response('{"message":"proibido"}', { status: 403 })

    expect(await runDiscovery(h)).toEqual([])

    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    // O 403 vale para o provedor inteiro: um só request, e as 9 datas da competição admitida e as 9
    // da que não coube ficam na fila, prontas só depois dos 15 min de bloqueio.
    expect(h.fetches.espn).toBe(1)
    expect(workCount(h.sqlite, `kind = 'discovery' AND status = 'pending' AND attempts = 0`)).toBe(
      18,
    )
    expect(workCount(h.sqlite, `not_before >= ${DISCOVERY_AT + 15 * 60_000}`)).toBeGreaterThan(0)
  })
})

describe('descoberta: falha ao enfileirar o que não coube', () => {
  it('a falha do batch não rejeita a descoberta, fica registrada por competição e a descoberta seguinte recupera', async () => {
    const broken = { on: true }
    const options = {
      espn: 2,
      wrap: (db: D1Database) =>
        flakyD1(db, {
          failBatch: (sqls) =>
            broken.on && sqls.some((sql) => sql.includes('INSERT INTO provider_work')),
        }),
    }
    const h = await setupWorld(options)

    const failures = await runDiscovery(h)

    expect(failures).toEqual([])
    expect(h.limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    // Nada foi para a fila e a competição que não coube ficou sem descoberta: o erro sai por
    // competição, e a execução é marcada como erro, em vez de a perda ser silenciosa.
    expect(workCount(h.sqlite, `1 = 1`)).toBe(0)
    expect(h.events('competition_status_error')).toHaveLength(1)
    expect(h.events('fixture_discovery_run')[0].blobs[1]).toBe('error')

    // A descoberta seguinte replaneja a competição que ficou de fora, com a fila de volta.
    broken.on = false
    const retry = DISCOVERY_AT + 3 * 3_600_000
    expect(await runDiscovery(h, retry)).toEqual([])
    await drainUntilSettled(h, retry)
    expect(openWork(h.sqlite)).toBe(0)
    expect(snapshot(h.sqlite)).toEqual(await controlSnapshot({ espn: 2 }))
  })
})
