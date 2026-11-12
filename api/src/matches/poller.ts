import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import { createProviderHttpObserver } from '../observability/providerHttp'
import { ESPN_MIN_INTERVAL_MS } from '../providers/espn'
import { ESPN_MAX_CONCURRENT_COMPETITIONS } from './espnQuota'
import { scoreWindowFromEspn } from './espnFallback'
import { FD_MAX_CONCURRENT_REQUESTS, runWithConcurrency } from './footballDataQuota'
import {
  ACTIVE_RESULT_WINDOW_MS,
  EARLIEST_RESULT_MS,
  LATE_SWEEP_INTERVAL_MS,
  LATE_SWEEP_WINDOW_MS,
  POLLER_TICK_MS,
  RESCUE_WINDOW_MS,
} from './matchPollingWindow'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

type ActiveRound = {
  comp_id: string
  external_id: string
  provider?: string
  season: string
  round: string
  utc_day: string
  /** 1 = candidato da varredura de atrasados, fora da janela ativa e do resgate. */
  late?: number
}

type SyncTask = {
  comp: ActiveRound
  round: string
  dates?: string[]
}

/**
 * Datas do scoreboard ESPN para um dia UTC. A ESPN indexa o dia local, e um jogo
 * após meia-noite UTC pode estar no dia anterior.
 */
function espnDates(utcDay: string): string[] {
  const day = Date.parse(`${utcDay}T00:00:00Z`)
  return [-1, 0].map((offset) =>
    new Date(day + offset * 86_400_000).toISOString().slice(0, 10).replaceAll('-', ''),
  )
}

function buildSyncTasks(rows: ActiveRound[]): {
  compCount: number
  tasks: SyncTask[]
} {
  const byComp = new Map<string, { comp: ActiveRound; rounds: Set<string>; dates: Set<string> }>()
  for (const row of rows) {
    let entry = byComp.get(row.comp_id)
    if (!entry) {
      entry = { comp: row, rounds: new Set(), dates: new Set() }
      byComp.set(row.comp_id, entry)
    }
    entry.rounds.add(row.round)
    if (row.provider === 'espn') {
      for (const date of espnDates(row.utc_day)) entry.dates.add(date)
    }
  }

  const tasks: SyncTask[] = []
  for (const { comp, rounds, dates } of byComp.values()) {
    if (comp.provider === 'espn') {
      const firstRound = rounds.values().next().value ?? ''
      tasks.push({ comp, round: firstRound, dates: Array.from(dates).sort() })
      continue
    }
    for (const round of rounds) {
      tasks.push({ comp, round })
    }
  }

  return { compCount: byComp.size, tasks }
}

/**
 * Escolhe no máximo uma tarefa da varredura de atrasados. Só roda no primeiro tick
 * de cada bloco de `LATE_SWEEP_INTERVAL_MS` e alterna entre os candidatos pelo
 * número do bloco, sem estado gravado: um jogo que o provedor nunca resolve não
 * prende a vez dos outros. O índice soma o número do dia ao do bloco, para que um
 * candidato não fique preso ao mesmo horário todo dia: com 8 candidatos e um bloco
 * sempre ocupado, `bloco % 8` nunca escolheria quem cai nele. Cada candidato é uma
 * rodada (football-data) ou um dia (ESPN, duas datas do scoreboard).
 */
const DAY_MS = 24 * 60 * 60 * 1000

function pickLateTask(rows: ActiveRound[], now: number): SyncTask | undefined {
  if (now % LATE_SWEEP_INTERVAL_MS >= POLLER_TICK_MS) return undefined
  const candidates = new Map<string, SyncTask>()
  for (const row of rows) {
    const espn = row.provider === 'espn'
    const key = `${row.comp_id}|${espn ? row.utc_day : row.round}`
    if (candidates.has(key)) continue
    candidates.set(key, {
      comp: row,
      round: row.round,
      dates: espn ? espnDates(row.utc_day) : undefined,
    })
  }
  if (candidates.size === 0) return undefined
  const keys = Array.from(candidates.keys()).sort()
  // O bloco avança um candidato por vez e cada dia desloca a fase em 3, para que
  // nenhum candidato fique preso a um horário sempre ocupado. Simulado: até 10
  // candidatos, com até 3 blocos do dia ocupados, todos são consultados em 7 dias.
  // Acima disso, quem sobrar fica para a descoberta diária, como antes.
  const block = Math.floor(now / LATE_SWEEP_INTERVAL_MS)
  const day = Math.floor(now / DAY_MS)
  return candidates.get(keys[(block + 3 * day) % keys.length])
}

/**
 * Jogos da janela ativa e do resgate (`late = 0`, consultados em todo tick) e
 * candidatos da varredura de atrasados (`late = 1`), numa consulta só ao D1.
 */
async function loadPollerRows(db: D1Database, now: number): Promise<ActiveRound[]> {
  // start_time is stored as ISO 8601 with `T`/`Z` (e.g. "2026-06-16T22:00:00Z").
  // Compute the bounds the same way so the TEXT comparison stays lexicographic.
  // SQLite's datetime('now', ...) would produce "2026-06-16 23:21:20" (space, no Z)
  // and string-compare wrong against the stored format.
  const earliestOver = new Date(now - EARLIEST_RESULT_MS).toISOString() // started ≥ 115 min ago
  const stillRelevant = new Date(now - ACTIVE_RESULT_WINDOW_MS).toISOString() // started ≤ 200 min ago
  const rescueFloor = new Date(now - RESCUE_WINDOW_MS).toISOString() // started ≤ 24 h ago
  const lateFloor = new Date(now - LATE_SWEEP_WINDOW_MS).toISOString() // started ≤ 7 days ago
  const today = new Date(now).toISOString().slice(0, 10)

  // `late = 0`: janela ativa e resgate, consultados em todo tick. `late = 1`:
  // candidatos da varredura. O adiado da ESPN usa o dia corrente como `utc_day`.
  const rows = await db
    .prepare(
      `SELECT DISTINCT comp_id, external_id, provider, season, round,
              CASE WHEN late = 1 AND postponed = 1 THEN ?5
                   ELSE substr(start_time, 1, 10) END AS utc_day,
              late
         FROM (
           SELECT c.id          AS comp_id,
                  c.external_id AS external_id,
                  c.provider    AS provider,
                  c.season      AS season,
                  m.round       AS round,
                  m.start_time  AS start_time,
                  m.postponed   AS postponed,
                  CASE WHEN m.start_time >= ?2
                             AND (m.status = 'finished' OR m.postponed = 0 OR m.start_time >= ?3)
                       THEN 0 ELSE 1 END AS late
             FROM matches m
             JOIN competitions c ON c.id = m.competition_id
            WHERE m.start_time <= ?1
              AND m.start_time >= ?4
              AND c.provider IN ('football-data', 'espn')
              AND (
                m.status != 'finished'
                OR (m.start_time >= ?2 AND m.scored_at IS NULL
                    AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL)
              )
         )`,
    )
    .bind(earliestOver, rescueFloor, stillRelevant, lateFloor, today)
    .all<ActiveRound>()

  return rows.results
}

type PollerPlan = {
  lateTask: SyncTask | undefined
  tasks: SyncTask[]
  compCount: number
  roundDays: number
}

/** Tarefas do tick: as da janela ativa e do resgate, ou, em tick ocioso, a da varredura. */
function planTasks(rows: ActiveRound[], now: number): PollerPlan {
  const activeRows = rows.filter((row) => row.late !== 1)
  // Só em tick ocioso: a varredura não soma subrequests a um tick com jogo na janela.
  const lateRows = rows.filter((row) => row.late === 1)
  const lateTask = activeRows.length === 0 ? pickLateTask(lateRows, now) : undefined
  const { compCount, tasks } = buildSyncTasks(activeRows)
  if (lateTask) tasks.push(lateTask)
  return {
    lateTask,
    tasks,
    compCount: compCount + (lateTask ? 1 : 0),
    roundDays: activeRows.length + (lateTask ? 1 : 0),
  }
}

/**
 * Polls football-data.org and ESPN for results of matches currently inside
 * their active window, then scores them. Designed to run on a Cron Trigger
 * (every 30 min).
 *
 * Active window per match (see ADR-007):
 *   start_time + 115min  ≤ now ≤  start_time + 200min
 *
 * 115 min = 45 + 5 (stoppage) + 15 (interval) + 45 + 5 (stoppage) — the earliest
 * a match can realistically be over. 200 min upper bound covers knockout extra
 * time + penalties, and stops polling matches that never resolve (abnormal cases).
 *
 * Resgate (até 24 h após o início): jogos que saíram da janela ativa sem status
 * final (resultado atrasado no provedor, falha nos dois ticks) e jogos finalizados
 * ainda sem pontuação continuam entrando na consulta. Jogos adiados
 * (`postponed = 1`) ficam de fora do resgate, para não gastar quota da
 * football-data com partidas que não terminam. O resgate da ESPN cobre a mesma
 * janela e consulta apenas jogos ainda sem resultado, inclusive após sync HTTP 200.
 *
 * Varredura de atrasados (até 7 dias após o último horário conhecido): jogos sem
 * resultado depois das 24 h, e adiados depois dos 200 min, voltam a ser
 * consultados a cada 3 h, uma rodada ou um dia por vez (`pickLateTask`). A
 * descoberta diária não alcança o jogo ESPN de antes de ontem, e o adiado
 * remarcado e disputado antes da próxima descoberta ficaria aberto para palpite
 * até ela. Para o adiado da ESPN a varredura consulta o dia corrente, onde um jogo
 * remarcado para hoje aparece. A varredura só entra em tick sem jogo na janela
 * ativa ou no resgate, então o pico de subrequests por execução não muda. Ela
 * usa só o provedor primário: o fallback da ESPN segue na janela de 24 h.
 */
export async function pollActiveMatches(
  db: D1Database,
  apiKey: string,
  ae?: AnalyticsEngineDataset,
  now = Date.now(),
): Promise<void> {
  const startedAt = Date.now()

  const { lateTask, tasks, compCount, roundDays } = planTasks(await loadPollerRows(db, now), now)

  if (tasks.length === 0) {
    console.info('[poller] Nenhum jogo na janela ativa.')
    logEvent(ae, 'poller_run', {
      blobs: ['ok'],
      // matches_checked, fixtures_updated, api_calls, duration_ms, events_discarded
      doubles: [0, 0, 0, Date.now() - startedAt, 0],
    })
    return
  }

  type SyncOutcome =
    | { success: true; comp: ActiveRound; round: string; matches: number; discarded: number }
    | { success: false; comp: ActiveRound; round: string; err: unknown }

  const runSyncTask = async ({ comp, round, dates }: SyncTask): Promise<SyncOutcome> => {
    const matchday = parseInt(round, 10)
    const matchdayParam = comp.provider === 'espn' || Number.isNaN(matchday) ? undefined : matchday

    try {
      const result = await syncFixtures({
        competitionCode: comp.external_id,
        season: Number(comp.season),
        matchday: matchdayParam,
        dates,
        apiKey,
        db,
        onHttpAttempt: createProviderHttpObserver(ae, {
          context: 'poller',
          competitionId: comp.comp_id,
        }),
        ae,
      })
      return {
        success: true as const,
        comp,
        round,
        matches: result?.matches ?? 0,
        discarded: result?.discarded ?? 0,
      }
    } catch (err) {
      return { success: false as const, comp, round, err }
    }
  }

  // football-data compartilha 10 req/min; ESPN tem teto próprio + pacing HTTP.
  const fdTasks = tasks.filter((task) => task.comp.provider === 'football-data')
  const espnTasks = tasks.filter((task) => task.comp.provider === 'espn')
  const [fdResults, espnResults] = await Promise.all([
    runWithConcurrency(FD_MAX_CONCURRENT_REQUESTS, fdTasks, runSyncTask),
    runWithConcurrency(ESPN_MAX_CONCURRENT_COMPETITIONS, espnTasks, runSyncTask),
  ])
  const syncResults = [...fdResults, ...espnResults]

  // Requests primárias planejadas, sem retries nem chamadas do fallback.
  const plannedApiRequests = tasks.reduce((count, task) => count + (task.dates?.length ?? 1), 0)
  let fixturesUpdated = 0
  let eventsDiscarded = 0
  let hadError = false
  const syncedComps = new Set<string>()
  const fallbackCompIds = new Set<string>()

  for (const res of syncResults) {
    // A varredura não chama o fallback: ela só roda sem jogo nas 24 h do fallback.
    if (res.comp.provider !== 'espn' && !lateTask) fallbackCompIds.add(res.comp.comp_id)
    if (res.success) {
      fixturesUpdated += res.matches
      eventsDiscarded += res.discarded
      syncedComps.add(res.comp.comp_id)
    } else {
      hadError = true
      logError(
        ae,
        'football_api_error',
        `[poller] Sync falhou comp=${res.comp.comp_id} round=${res.round}:`,
        res.err,
        {
          blobs: [res.comp.comp_id, res.round],
        },
      )
    }
  }

  // HTTP 200 pode trazer status atrasado: o fallback consulta o D1 após os upserts
  // e só chama a ESPN quando ainda há partidas elegíveis sem resultado final.
  if (fallbackCompIds.size > 0) {
    try {
      const updatedByComp = await scoreWindowFromEspn(db, ae, Array.from(fallbackCompIds), { now })
      for (const [compId, updated] of updatedByComp) {
        if (updated > 0) syncedComps.add(compId)
      }
    } catch (err) {
      // blob2 vazio: a falha é do fallback inteiro, sem competição (a mensagem fica em blob3).
      logError(ae, 'match_results_fallback', '[poller] Fallback ESPN falhou:', err, {
        blobs: [''],
      })
    }
  }

  const scoreResults = await Promise.all(
    Array.from(syncedComps).map(async (compId) => {
      try {
        await scoreUnprocessedMatches(compId, db)
        return { success: true as const, compId }
      } catch (err) {
        return { success: false as const, compId, err }
      }
    }),
  )

  // Falha de D1 na pontuação: o tick fica registrado como erro antes de relançar.
  const scoringFailure = scoreResults.find((res) => !res.success)

  logEvent(ae, 'poller_run', {
    blobs: [hadError || scoringFailure ? 'error' : 'ok'],
    doubles: [
      roundDays,
      fixturesUpdated,
      plannedApiRequests,
      Date.now() - startedAt,
      eventsDiscarded,
    ],
  })

  if (scoringFailure) throw scoringFailure.err

  console.info(
    '[perf]',
    JSON.stringify({
      route: 'cron pollActiveMatches',
      competitions: compCount,
      round_days: roundDays,
      sync_tasks: tasks.length,
      late_sweep_tasks: lateTask ? 1 : 0,
      api_requests_planned: plannedApiRequests,
      espn_max_concurrent: ESPN_MAX_CONCURRENT_COMPETITIONS,
      espn_min_interval_ms: ESPN_MIN_INTERVAL_MS,
      total_ms: Date.now() - startedAt,
    }),
  )
}
