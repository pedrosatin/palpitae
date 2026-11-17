/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POLLER_AND_DRAIN_CRON } from '../crons'
import worker from '../index'
import { D1_CALLS_PER_INVOCATION, limitD1Calls, type LimitedD1 } from '../testing/d1CallLimit'
import { flakyD1, isStateBatch } from '../testing/flakyD1'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { runProviderDrains, type ProviderDrain } from './drainCoordinator'
import { footballDataDrain } from './fdWork'
import { clearFootballDataPause } from './footballDataQuota'
import { setFootballDataRateLimitForTests } from './providerBudget'
import { enqueueProviderWork, WORK_BUSY_RETRY_MS } from './providerWork'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

/**
 * O dreno da football-data sob o limite de 50 subrequests por invocação do
 * plano Free (ADR-027, adendo "subrequests do dreno"). O `scheduled` roda
 * inteiro num minuto de dreno (limpeza de segurança + dreno) sobre o SQLite
 * das migrations. Cada consulta ao D1, cada batch e cada `fetch` à
 * football-data somam na mesma conta, e a chamada 51 é recusada. Reproduz os
 * dois cenários do review: 16 itens com o orçamento do minuto cheio e 16 itens
 * com respostas normais. Antes, o segundo passava de 50 chamadas no primeiro
 * tick e deixava os 16 itens em `running` até o lease de 5 min vencer.
 */

const DRAIN_MINUTE = Date.UTC(2026, 10, 17, 14, 5, 0)
const TICK_MS = 5 * 60_000
const ITEMS = 16
/** A limpeza de registros expirados do `scheduled` é 1 chamada, por fora do dreno. */
const CLEANUP_CALLS = 1
/** Saldo do dreno: 45 das 50 chamadas (as 5 restantes cobrem a limpeza e a folga). */
const DRAIN_CALL_BUDGET = 45

const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.useFakeTimers({ now: DRAIN_MINUTE, toFake: ['Date'] })
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  clearFootballDataPause()
  setFootballDataRateLimitForTests(1000)
})

/** Calendário da football-data: `matches` jogos de uma rodada, dois times cada, no mesmo status. */
function calendar(matches: number, matchday: number, status = 'FINISHED') {
  const team = (n: number) => ({
    id: matchday * 1000 + n,
    name: `Time ${matchday}-${n}`,
    shortName: `T${matchday}-${n}`,
    tla: 'TIM',
  })
  return {
    competition: { id: 2017, code: 'PPL', name: 'Primeira Liga' },
    matches: Array.from({ length: matches }, (_, i) => ({
      id: 567_000 + matchday * 100 + i,
      utcDate: '2026-11-08T15:30:00Z',
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

/**
 * Banco de teste e provedor simulado, que responde `respond(url)` a cada request:
 * o corpo de um calendário ou uma `Response` pronta (429, por exemplo).
 */
function createWorld(respond: (url: URL) => unknown) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const state = { fetches: 0, onFetch: undefined as (() => void) | undefined }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      state.onFetch?.()
      const url = new URL(String(input))
      if (url.hostname !== 'api.football-data.org') return Response.json({ events: [] })
      state.fetches += 1
      const answer = respond(url)
      return answer instanceof Response ? answer : Response.json(answer)
    }),
  )
  return { sqlite, db, state }
}

type World = ReturnType<typeof createWorld>

/**
 * Passa a valer o limite da plataforma: as chamadas ao D1 e os `fetch` somam na
 * mesma conta, e o que veio antes (a semente do banco) fica fora dela.
 */
function armLimit({ db, state }: World, wrap: (db: D1Database) => D1Database = (raw) => raw) {
  const limited = limitD1Calls(wrap(db))
  state.onFetch = limited.chargeFetch
  const writeDataPoint = vi.fn()
  const env = {
    DB: limited.db,
    AE: { writeDataPoint },
    FOOTBALL_API_KEY: 'test',
    FRONTEND_URL: 'http://localhost:5173',
    JWT_SECRET: 'jwt-secret',
    BASE_URL: 'https://api.example.test',
  } as unknown as Env
  return { limited, env, writeDataPoint }
}

type SetupOptions = {
  /** Envolve o D1 do Worker (depois da semente) com uma falha simulada. */
  wrap?: (db: D1Database) => D1Database
}

/** Competição criada e 16 itens `result` na fila, um por rodada. */
async function setupResultItems({ wrap }: SetupOptions = {}) {
  // Resposta do provedor, trocável depois da semente: `null` é o calendário normal.
  const provider = { override: null as null | ((url: URL) => unknown) }
  const world = createWorld(
    (url) =>
      provider.override?.(url) ?? calendar(10, Number(url.searchParams.get('matchday') ?? '1')),
  )
  const { sqlite, db } = world
  await syncFixtures({ competitionCode: 'PPL', season: 2026, matchday: 1, db, apiKey: 'test' })
  const { id } = sqlite.prepare(`SELECT id FROM competitions WHERE external_id = '2017'`).get() as {
    id: string
  }
  await enqueueProviderWork(
    db,
    Array.from({ length: ITEMS }, (_, i) => ({
      kind: 'result' as const,
      competitionCode: 'PPL',
      season: '2026',
      round: String(i + 1),
      competitionId: id,
    })),
    DRAIN_MINUTE,
  )
  world.state.fetches = 0
  return { ...world, ...armLimit(world, wrap), provider }
}

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

function count(sqlite: DatabaseSync, where: string): number {
  return (
    sqlite.prepare(`SELECT COUNT(*) AS n FROM provider_work WHERE ${where}`).get() as { n: number }
  ).n
}

/** O tick respeitou os 50 da plataforma e os 45 do dreno, sem contar a limpeza. */
function expectWithinBudget(limited: LimitedD1) {
  expect(limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
  expect(limited.calls() - CLEANUP_CALLS).toBeLessThanOrEqual(DRAIN_CALL_BUDGET)
}

/** Esgota a janela de um minuto do orçamento compartilhado da football-data. */
function fillMinuteWindow(sqlite: DatabaseSync) {
  setFootballDataRateLimitForTests(8)
  sqlite.exec(
    `UPDATE provider_rate_state SET window_started_at = ${Math.floor(DRAIN_MINUTE / 60_000)}, window_calls = 8`,
  )
}

describe('dreno da football-data com 50 subrequests por invocação', () => {
  it('16 itens com o orçamento do minuto cheio: encerra na primeira vaga recusada, sem item preso', async () => {
    const h = await setupResultItems()
    fillMinuteWindow(h.sqlite)

    const failures = await runDrainTick(h, DRAIN_MINUTE)

    expect(failures).toEqual([])
    expectWithinBudget(h.limited)
    // Sem a recusa em cadeia: reclamar, no máximo 4 reservas recusadas (os itens em voo) e
    // gravar o estado, em vez de 1 + 16 × 2 + 1 com a limpeza.
    expect(h.limited.calls() - CLEANUP_CALLS).toBeLessThanOrEqual(1 + 4 + 1)
    expect(h.state.fetches).toBe(0)
    // Nenhum item preso em `running` até o lease vencer, e nenhuma tentativa gasta.
    expect(count(h.sqlite, `status = 'running'`)).toBe(0)
    expect(count(h.sqlite, `status = 'pending' AND attempts = 0`)).toBe(ITEMS)
    // Quem tentou ficou para a janela seguinte; quem nem começou, imediatamente pronto.
    expect(count(h.sqlite, `not_before = ${DRAIN_MINUTE + WORK_BUSY_RETRY_MS}`)).toBeGreaterThan(0)
    expect(count(h.sqlite, `not_before = 0`)).toBeGreaterThan(0)
  })

  it('16 itens com o minuto cheio retomam por inteiro nos ticks seguintes', async () => {
    const h = await setupResultItems()
    fillMinuteWindow(h.sqlite)
    await runDrainTick(h, DRAIN_MINUTE)

    for (let tick = 1; tick <= 8 && count(h.sqlite, `status = 'done'`) < ITEMS; tick++) {
      const failures = await runDrainTick(h, DRAIN_MINUTE + tick * TICK_MS)
      expect(failures).toEqual([])
      expectWithinBudget(h.limited)
      expect(count(h.sqlite, `status = 'running'`)).toBe(0)
      expect(count(h.sqlite, `attempts > 0`)).toBe(0)
    }

    expect(count(h.sqlite, `status = 'done'`)).toBe(ITEMS)
    expect(h.state.fetches).toBe(ITEMS)
  })

  it('16 itens com respostas normais: no máximo 45 chamadas por tick e a fila termina nos ticks seguintes', async () => {
    const h = await setupResultItems()
    setFootballDataRateLimitForTests(1000)

    let ticks = 0
    for (; ticks < 8 && count(h.sqlite, `status = 'done'`) < ITEMS; ticks++) {
      const failures = await runDrainTick(h, DRAIN_MINUTE + ticks * TICK_MS)
      expect(failures).toEqual([])
      expectWithinBudget(h.limited)
      // Nenhum item fica `running` por falta de saldo, e o que sobrou não gastou tentativa.
      expect(count(h.sqlite, `status = 'running'`)).toBe(0)
      expect(count(h.sqlite, `attempts > 0`)).toBe(0)
      if (ticks === 0) {
        // O saldo de um tick não cobre os 16: o resto espera, intacto, o tick seguinte.
        expect(count(h.sqlite, `status = 'done'`)).toBeGreaterThan(0)
        expect(count(h.sqlite, `status = 'pending'`)).toBeGreaterThan(0)
      }
    }

    expect(count(h.sqlite, `status = 'done'`)).toBe(ITEMS)
    // Cada item sai uma vez só: o saldo recusa antes de começar, não no meio.
    expect(h.state.fetches).toBe(ITEMS)
    expect(ticks).toBeLessThanOrEqual(5)
  })

  it('com o orçamento por minuto real (8), cada tick gasta no máximo 8 requests e a fila termina', async () => {
    const h = await setupResultItems()
    setFootballDataRateLimitForTests(8)

    for (let tick = 0; tick < 8 && count(h.sqlite, `status = 'done'`) < ITEMS; tick++) {
      const before = h.state.fetches
      expect(await runDrainTick(h, DRAIN_MINUTE + tick * TICK_MS)).toEqual([])
      expectWithinBudget(h.limited)
      expect(h.state.fetches - before).toBeLessThanOrEqual(8)
      expect(count(h.sqlite, `status = 'running'`)).toBe(0)
    }

    expect(count(h.sqlite, `status = 'done'`)).toBe(ITEMS)
  })

  it('item devolvido por falta de saldo espera só o próximo tick, sem prazo de uma janela', async () => {
    const h = await setupResultItems()
    setFootballDataRateLimitForTests(1000)

    await runDrainTick(h, DRAIN_MINUTE)

    const waiting = h.sqlite
      .prepare(
        `SELECT not_before, lease_until, lease_owner FROM provider_work WHERE status = 'pending'`,
      )
      .all() as { not_before: number; lease_until: number; lease_owner: string | null }[]
    expect(waiting.length).toBeGreaterThan(0)
    for (const row of waiting) {
      expect(row.not_before).toBeLessThan(DRAIN_MINUTE + WORK_BUSY_RETRY_MS)
      expect(row.lease_until).toBe(0)
      expect(row.lease_owner).toBeNull()
    }
  })

  it('registra a execução com os itens devolvidos e as chamadas gastas', async () => {
    const h = await setupResultItems()
    setFootballDataRateLimitForTests(1000)

    await runDrainTick(h, DRAIN_MINUTE)

    const runs = h.writeDataPoint.mock.calls
      .map(([point]) => point as { blobs: string[]; doubles: number[] })
      .filter((point) => point.blobs[0] === 'provider_work_run')
    expect(runs).toHaveLength(1)
    const [claimed, done, requeued, failed, , released, callsUsed] = runs[0].doubles
    expect([requeued, failed]).toEqual([0, 0])
    expect(claimed).toBe(done + released)
    expect(callsUsed).toBeLessThanOrEqual(DRAIN_CALL_BUDGET)
    expect(callsUsed).toBe(h.limited.calls() - CLEANUP_CALLS)
  })

  it('dois drenos no mesmo tick dividem os 45: o da football-data fica com a fatia dele', async () => {
    const h = await setupResultItems()
    setFootballDataRateLimitForTests(1000)
    // Segundo dreno, como o da ESPN será: gasta tudo o que a fatia dele deixa.
    const hungry: ProviderDrain = {
      provider: 'espn',
      run: async (budget) => {
        const item = budget.open(1)!
        try {
          for (;;) await item.db.prepare('SELECT 1').first()
        } catch {
          item.close()
        }
        await budget.db.prepare('SELECT 1').first()
        return { claimed: 0, done: 0, requeued: 0, failed: 0, released: 0, outcomes: [] }
      },
    }
    h.limited.startInvocation()

    const used = await runProviderDrains(h.limited.db, [
      footballDataDrain({ apiKey: 'test' }),
      hungry,
    ])

    expect(used).toBeLessThanOrEqual(DRAIN_CALL_BUDGET)
    expect(h.limited.calls()).toBeLessThanOrEqual(DRAIN_CALL_BUDGET)
    expect(count(h.sqlite, `status = 'running'`)).toBe(0)
    expect(count(h.sqlite, `attempts > 0`)).toBe(0)
    // A fatia de 23 (22 de trabalho) comporta 2 itens de 8; os outros 14 seguem pendentes.
    expect(count(h.sqlite, `status = 'done'`)).toBe(2)
    expect(count(h.sqlite, `status = 'pending'`)).toBe(ITEMS - 2)
  })
})

describe('falha do D1 na gravação do estado, dentro do saldo de 50', () => {
  it('falha transitória só no batch de estado: a nova tentativa cabe na reserva e nenhum item fica running', async () => {
    let failures = 1
    const h = await setupResultItems({
      wrap: (db) => flakyD1(db, { failBatch: (sqls) => isStateBatch(sqls) && failures-- > 0 }),
    })

    expect(await runDrainTick(h, DRAIN_MINUTE)).toEqual([])

    expectWithinBudget(h.limited)
    expect(count(h.sqlite, `status = 'running'`)).toBe(0)
    expect(count(h.sqlite, `status = 'done'`)).toBe(5)
    expect(count(h.sqlite, `attempts > 0`)).toBe(0)
    // Os 38 do tick normal mais a nova tentativa do batch.
    expect(h.limited.calls()).toBe(39)
  })

  it('batch de estado que falha sempre: os itens voltam a pending sem tentativa e o tick seguinte os refaz', async () => {
    let broken = true
    const h = await setupResultItems({
      wrap: (db) => flakyD1(db, { failBatch: (sqls) => broken && isStateBatch(sqls) }),
    })

    expect(await runDrainTick(h, DRAIN_MINUTE)).toEqual([])

    expectWithinBudget(h.limited)
    // Tentativa, nova tentativa e liberação cabem na reserva: 38 + 1 + 1.
    expect(h.limited.calls()).toBe(40)
    expect(count(h.sqlite, `status = 'running'`)).toBe(0)
    expect(count(h.sqlite, `status = 'pending' AND attempts = 0`)).toBe(ITEMS)
    const runs = h.writeDataPoint.mock.calls
      .map(([point]) => point as { blobs: string[] })
      .filter((point) => point.blobs[0] === 'provider_work_run')
    expect(runs.at(-1)?.blobs[1]).toBe('error')

    // O D1 volta, e a fila termina nos ticks seguintes.
    broken = false
    for (let tick = 1; tick <= 6 && count(h.sqlite, `status = 'done'`) < ITEMS; tick++) {
      expect(await runDrainTick(h, DRAIN_MINUTE + tick * TICK_MS)).toEqual([])
      expectWithinBudget(h.limited)
    }
    expect(count(h.sqlite, `status = 'done'`)).toBe(ITEMS)
    expect(count(h.sqlite, `attempts > 0`)).toBe(0)
  })
})

describe('429 da football-data dentro do dreno', () => {
  const limited = (resetSeconds: number) =>
    Response.json(
      { message: 'limite' },
      { status: 429, headers: { 'X-RequestCounter-Reset': String(resetSeconds) } },
    )

  /** A espera do 429 roda no relógio simulado, que avança junto com os timers. */
  function useClockWithTimers() {
    vi.useRealTimers()
    vi.useFakeTimers({ now: DRAIN_MINUTE, toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  }

  it('429 com reset curto: a espera, o novo request e o bloqueio cabem no saldo e valem para os demais', async () => {
    useClockWithTimers()
    const h = await setupResultItems()
    let first = true
    h.provider.override = (url) => {
      if (!first) return null
      first = false
      void url
      return limited(2)
    }

    const tick = runDrainTick(h, DRAIN_MINUTE)
    await vi.advanceTimersByTimeAsync(7_000)

    expect(await tick).toEqual([])
    expectWithinBudget(h.limited)
    // O bloqueio gravado pelo 429 vale para o item que ainda não tinha reservado vaga.
    expect(
      (
        h.sqlite.prepare(`SELECT blocked_until FROM provider_rate_state`).get() as {
          blocked_until: number
        }
      ).blocked_until,
    ).toBeGreaterThan(DRAIN_MINUTE)
    expect(count(h.sqlite, `status = 'running'`)).toBe(0)
    expect(count(h.sqlite, `attempts > 0`)).toBe(0)
    // O item do 429 refez o request depois da pausa e concluiu: 1 fetch a mais que os concluídos.
    const doneItems = count(h.sqlite, `status = 'done'`)
    expect(doneItems).toBeGreaterThanOrEqual(3)
    expect(h.state.fetches).toBe(doneItems + 1)
  })

  it('429 com reset longo: o item volta sem tentativa e o dreno encerra, sem gastar o saldo à toa', async () => {
    useClockWithTimers()
    const h = await setupResultItems()
    let first = true
    h.provider.override = () => {
      if (!first) return null
      first = false
      return limited(3600)
    }

    expect(await runDrainTick(h, DRAIN_MINUTE)).toEqual([])
    expectWithinBudget(h.limited)
    expect(count(h.sqlite, `status = 'running'`)).toBe(0)
    expect(count(h.sqlite, `attempts > 0`)).toBe(0)
    // O item do 429 espera o reset (1 h); os demais ficam prontos para o tick seguinte.
    expect(count(h.sqlite, `not_before >= ${DRAIN_MINUTE + 3_000_000}`)).toBe(1)

    // Outro isolate, 5 min depois: o bloqueio no D1 recusa a primeira vaga e o dreno encerra.
    clearFootballDataPause()
    const fetchesBefore = h.state.fetches
    expect(await runDrainTick(h, DRAIN_MINUTE + TICK_MS)).toEqual([])
    expectWithinBudget(h.limited)
    expect(h.state.fetches).toBe(fetchesBefore)
    expect(h.limited.calls() - CLEANUP_CALLS).toBeLessThanOrEqual(1 + 4 + 1)

    // Passado o reset, a fila termina por inteiro, sem tentativa gasta.
    clearFootballDataPause()
    const after = DRAIN_MINUTE + 61 * 60_000
    for (let tick = 0; tick < 8 && count(h.sqlite, `status = 'done'`) < ITEMS; tick++) {
      expect(await runDrainTick(h, after + tick * TICK_MS)).toEqual([])
      expectWithinBudget(h.limited)
    }
    expect(count(h.sqlite, `status = 'done'`)).toBe(ITEMS)
    expect(count(h.sqlite, `attempts > 0`)).toBe(0)
  })
})

/** Competição de 40 jogos encerrados, com 25 grupos de 5 pessoas palpitando em todos. */
async function seedScoring(sqlite: DatabaseSync, db: D1Database) {
  const synced = await syncFixtures({ competitionCode: 'PPL', season: 2026, db, apiKey: 'test' })
  const compId = synced.competitionId
  sqlite.exec(`
    CREATE TEMP TABLE seed_g AS
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 25) SELECT i FROM n;
    CREATE TEMP TABLE seed_u AS
      WITH RECURSIVE n(j) AS (SELECT 1 UNION ALL SELECT j + 1 FROM n WHERE j < 5) SELECT j FROM n;
    INSERT INTO users (id, email, provider, provider_id)
      SELECT 'u-' || i || '-' || j, 'u-' || i || '-' || j || '@example.test', 'google', 'g-' || i || '-' || j
        FROM seed_g, seed_u;
    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code, points_exact, points_winner)
      SELECT 'g-' || i, 'Bolão ' || i, '${compId}', 'u-' || i || '-1', 'INV-' || i, 3, 1 FROM seed_g;
    INSERT INTO group_members (id, group_id, user_id)
      SELECT 'gm-' || i || '-' || j, 'g-' || i, 'u-' || i || '-' || j FROM seed_g, seed_u;
    INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score)
      SELECT 'p-' || m.external_id || '-' || i || '-' || j, 'u-' || i || '-' || j, 'g-' || i, m.id,
             (i + j + CAST(m.external_id AS INTEGER)) % 3, (i * j + CAST(m.external_id AS INTEGER)) % 2
        FROM matches m, seed_g, seed_u WHERE m.competition_id = '${compId}';
    DROP TABLE seed_g;
    DROP TABLE seed_u;
    UPDATE matches SET scored_at = NULL;
  `)
  return compId
}

function readScores(sqlite: DatabaseSync) {
  return {
    predictions: sqlite
      .prepare(
        `SELECT id, points_awarded, penalty_points, classified_points FROM predictions ORDER BY id`,
      )
      .all(),
    ranking: sqlite
      .prepare(
        `SELECT group_id, user_id, total_points, exact_hits FROM leaderboard ORDER BY group_id, user_id`,
      )
      .all(),
  }
}

describe('pontuação do pós-sync dentro do saldo do dreno', () => {
  it('descoberta com 5 mil palpites pontua em ticks sucessivos, sem tentativa gasta, e avança o status no fim', async () => {
    const world = createWorld(() => calendar(40, 10))
    const { sqlite, db } = world
    const compId = await seedScoring(sqlite, db)
    await enqueueProviderWork(
      db,
      [
        {
          kind: 'discovery',
          competitionCode: 'PPL',
          season: '2026',
          round: '',
          competitionId: compId,
        },
      ],
      DRAIN_MINUTE,
    )
    const h = armLimit(world)
    const unscored = () =>
      (
        sqlite.prepare(`SELECT COUNT(*) AS n FROM matches WHERE scored_at IS NULL`).get() as {
          n: number
        }
      ).n
    const status = () => sqlite.prepare(`SELECT status FROM competitions WHERE id = ?`).get(compId)

    const pending: number[] = []
    for (let tick = 0; tick < 8 && count(sqlite, `status = 'done'`) < 1; tick++) {
      expect(await runDrainTick(h, DRAIN_MINUTE + tick * TICK_MS)).toEqual([])
      expectWithinBudget(h.limited)
      expect(count(sqlite, `status = 'running'`)).toBe(0)
      expect(count(sqlite, `attempts > 0`)).toBe(0)
      pending.push(unscored())
      if (count(sqlite, `status = 'done'`) === 0) {
        // Incompleto por saldo: o item volta à fila sem tentativa, e o status ainda não avançou.
        expect(count(sqlite, `status = 'pending'`)).toBe(1)
        expect(status()).not.toEqual({ status: 'finished' })
      }
    }

    // O primeiro tick pontua parte dos jogos; os seguintes terminam o resto, e só então o item conclui.
    expect(pending[0]).toBeGreaterThan(0)
    expect(pending[0]).toBeLessThan(40)
    expect(pending.at(-1)).toBe(0)
    expect(pending.length).toBeGreaterThan(1)
    expect(count(sqlite, `status = 'done'`)).toBe(1)
    expect(status()).toEqual({ status: 'finished' })

    // O resultado é o de uma pontuação sem limite de chamadas.
    const control = createSqliteD1()
    handles.push(control.sqlite)
    const controlComp = await seedScoring(control.sqlite, control.db)
    await scoreUnprocessedMatches(controlComp, control.db)
    expect(readScores(sqlite)).toEqual(readScores(control.sqlite))
  })
})
