import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent, tryLogEvent } from '../observability/events'
import {
  createProviderHttpObserver,
  type ProviderHttpObserver,
} from '../observability/providerHttp'
import { ESPN_MIN_INTERVAL_MS } from '../providers/espn'
import { callsLeft, countD1Calls, INVOCATION_CALL_LIMIT, type CallBudget } from './callBudget'
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
import { MIN_SCORING_CALLS, scoreUnprocessedMatches } from './scoring'
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
  // O bloco avança um candidato por vez e cada dia desloca a fase em 11. Como são
  // 8 blocos por dia, o índice é (19 × dia + horário) % n; 19 é primo, então abaixo
  // de 19 candidatos nenhum fica preso a um horário. Simulado: até 16 candidatos,
  // com até 3 blocos do dia ocupados, todos são consultados em 7 dias. Acima disso,
  // quem sobrar fica para a descoberta diária, como antes.
  const block = Math.floor(now / LATE_SWEEP_INTERVAL_MS)
  const day = Math.floor(now / DAY_MS)
  return candidates.get(keys[(block + 11 * day) % keys.length])
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

/**
 * Chamadas da invocação que ficam fora do orçamento do poller (ADR-024):
 * - a limpeza de registros expirados, que o handler `scheduled` dispara na mesma
 *   invocação, por fora deste arquivo;
 * - a leitura final dos jogos que seguem sem pontuação (`reportUnscoredMatches`);
 * - folga para o que a contagem não vê.
 */
const CLEANUP_CALLS = 1
const UNSCORED_REPORT_CALLS = 1
const SPARE_CALLS = 3

/**
 * Chamadas que o tick pode fazer: consultas e batches do D1 e `fetch` aos
 * provedores. Planejamento, sync e fallback gastam o que precisam e são só
 * contados; a pontuação recebe o que sobra e para quando acaba.
 */
export const POLLER_CALL_BUDGET =
  INVOCATION_CALL_LIMIT - CLEANUP_CALLS - UNSCORED_REPORT_CALLS - SPARE_CALLS

/** Teto de `match_unscored` por execução: um evento por competição. */
const UNSCORED_EVENTS_PER_RUN = 10

/**
 * Competições com jogo encerrado, com placar e sem `scored_at`, que começou até o
 * instante informado. `INDEXED BY` prende a leitura ao índice parcial
 * `idx_matches_unscored`, quase sempre vazio; sem ele o SQLite varre todos os
 * jogos encerrados por `idx_matches_status`.
 */
export const UNSCORED_REPORT_SQL = `SELECT competition_id, COUNT(*) AS matches, MIN(start_time) AS oldest
   FROM matches INDEXED BY idx_matches_unscored
  WHERE status = 'finished' AND scored_at IS NULL
    AND home_score IS NOT NULL AND away_score IS NOT NULL
    AND start_time <= ?
  GROUP BY competition_id
  ORDER BY matches DESC, competition_id
  LIMIT ?`

/**
 * Registra `match_unscored` para cada competição com jogo encerrado que segue sem
 * `scored_at` depois de mais de um ciclo. O resultado chega no mínimo
 * `EARLIEST_RESULT_MS` depois do início e a pontuação roda no mesmo tick; quem
 * começou há mais que isso somado a um tick já passou por um ciclo inteiro sem
 * ser pontuado. Entra aqui quem ficou para trás por orçamento ou por erro e o
 * jogo decisivo que espera o vencedor dos pênaltis. Só registra: falha aqui fica
 * no log e não derruba o tick.
 */
async function reportUnscoredMatches(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  now: number,
): Promise<void> {
  if (!ae) return // sem o binding não há onde registrar
  const cutoff = new Date(now - EARLIEST_RESULT_MS - POLLER_TICK_MS).toISOString()
  try {
    const { results } = await db
      .prepare(UNSCORED_REPORT_SQL)
      .bind(cutoff, UNSCORED_EVENTS_PER_RUN)
      .all<{ competition_id: string; matches: number; oldest: string }>()
    for (const row of results) {
      const oldestMinutes = Math.round((now - Date.parse(row.oldest)) / 60_000)
      tryLogEvent(ae, 'match_unscored', {
        blobs: [row.competition_id],
        // matches, oldest_minutes (minutos desde o início do jogo mais antigo)
        doubles: [row.matches, Number.isFinite(oldestMinutes) ? Math.max(0, oldestMinutes) : 0],
      })
    }
  } catch (err) {
    console.error('[poller] Falha ao conferir jogos encerrados sem pontuação:', err)
  }
}

/**
 * Competições com jogo encerrado, com placar e sem `scored_at`, do jogo pendente
 * mais antigo para o mais novo. Lê o mesmo índice parcial de
 * `UNSCORED_REPORT_SQL`, sem o corte de horário. O jogo que acabou de encerrar
 * também entra.
 */
export const PENDING_SCORING_SQL = `SELECT competition_id
   FROM matches INDEXED BY idx_matches_unscored
  WHERE status = 'finished' AND scored_at IS NULL
    AND home_score IS NOT NULL AND away_score IS NOT NULL
  GROUP BY competition_id
  ORDER BY MIN(start_time), competition_id`

/**
 * Ordem de pontuação do tick. Primeiro as competições com pontuação pendente no
 * D1, pelo jogo pendente mais antigo, e depois as sincronizadas no tick que não
 * estão entre elas. A competição que parou por falta de chamadas, ou por erro,
 * volta mesmo sem sync no tick, e a que ficou sem a vez num tick tem o jogo
 * pendente mais antigo no seguinte. Se a leitura falha, valem só as
 * sincronizadas, como antes.
 */
async function competitionsToScore(db: D1Database, synced: Set<string>): Promise<string[]> {
  let pending: string[] = []
  try {
    const { results } = await db.prepare(PENDING_SCORING_SQL).all<{ competition_id: string }>()
    pending = results.map((row) => row.competition_id)
  } catch (err) {
    console.error('[poller] Falha ao ler as competições com pontuação pendente:', err)
  }
  return Array.from(new Set([...pending, ...synced]))
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

/** Resultado da pontuação de um tick, somando todas as competições. */
type ScoringRun = { failures: unknown[]; matchesScored: number; unfinished: number }

/**
 * A pontuação do tick processa uma competição por vez. O erro de uma fica
 * registrado e as outras seguem. Cada competição recebe uma parte igual do que
 * resta, para que uma com muitos palpites não gaste a vez das outras. A parte
 * nunca fica abaixo do mínimo para planejar e gravar uma vez enquanto houver esse
 * mínimo, senão a primeira da lista seria pulada em todo tick. O que sobrar vai,
 * numa segunda passada, para as que pararam por falta de chamadas.
 */
async function scoreCompetitions(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  budget: CallBudget,
  toScore: string[],
): Promise<ScoringRun> {
  const run: ScoringRun = { failures: [], matchesScored: 0, unfinished: 0 }
  /** Devolve `false` quando a competição parou por falta de chamadas. */
  const scoreCompetition = async (compId: string, maxCalls: number): Promise<boolean> => {
    try {
      const outcome = await scoreUnprocessedMatches(compId, db, maxCalls)
      run.matchesScored += outcome.scored
      return outcome.complete
    } catch (err) {
      run.failures.push(err)
      // `tryLogEvent`, porque uma falha ao registrar não pode tirar a vez das outras competições.
      console.error(`[poller] Pontuação falhou comp=${compId}:`, err)
      tryLogEvent(ae, 'match_scoring_error', {
        blobs: [compId, err instanceof Error ? err.message : String(err)],
      })
      return true
    }
  }

  const stopped: string[] = []
  for (const [i, compId] of toScore.entries()) {
    const left = callsLeft(budget)
    const share = Math.floor(left / (toScore.length - i))
    if (!(await scoreCompetition(compId, Math.min(left, Math.max(MIN_SCORING_CALLS, share))))) {
      stopped.push(compId)
    }
  }
  for (const compId of stopped) {
    if (!(await scoreCompetition(compId, callsLeft(budget)))) run.unfinished += 1
  }
  return run
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
 *
 * Pontuação (ADR-024): uma competição por vez, dentro do que sobra de
 * `POLLER_CALL_BUDGET`. Entram as sincronizadas no tick e as que têm jogo
 * encerrado sem pontuação no D1, com ou sem jogo na janela. A que não termina
 * continua no tick seguinte de onde parou, e o erro de uma não impede as outras.
 */
export async function pollActiveMatches(
  rawDb: D1Database,
  apiKey: string,
  ae?: AnalyticsEngineDataset,
  now = Date.now(),
): Promise<void> {
  const startedAt = Date.now()
  const budget: CallBudget = { limit: POLLER_CALL_BUDGET, used: 0 }
  const db = countD1Calls(rawDb, budget)
  /** Cada tentativa HTTP a um provedor entra no orçamento, com ou sem telemetria. */
  const countHttp =
    (telemetry?: ProviderHttpObserver): ProviderHttpObserver =>
    (attempt) => {
      budget.used += 1
      telemetry?.(attempt)
    }

  const { lateTask, tasks, compCount, roundDays } = planTasks(await loadPollerRows(db, now), now)

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
        onHttpAttempt: countHttp(
          createProviderHttpObserver(ae, { context: 'poller', competitionId: comp.comp_id }),
        ),
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
      const updatedByComp = await scoreWindowFromEspn(db, ae, Array.from(fallbackCompIds), {
        now,
        onHttpAttempt: countHttp(),
      })
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

  // Lida depois do sync e do fallback, para incluir os resultados que acabaram de chegar.
  const toScore = await competitionsToScore(db, syncedComps)

  if (tasks.length === 0 && toScore.length === 0) {
    console.info('[poller] Nenhum jogo na janela ativa.')
    await reportUnscoredMatches(db, ae, now)
    logEvent(ae, 'poller_run', {
      blobs: ['ok'],
      // matches_checked, fixtures_updated, api_calls, duration_ms, events_discarded
      doubles: [0, 0, 0, Date.now() - startedAt, 0],
    })
    return
  }

  const {
    failures: scoringFailures,
    matchesScored,
    unfinished,
  } = await scoreCompetitions(db, ae, budget, toScore)

  await reportUnscoredMatches(db, ae, now)

  logEvent(ae, 'poller_run', {
    blobs: [hadError || scoringFailures.length > 0 ? 'error' : 'ok'],
    doubles: [
      roundDays,
      fixturesUpdated,
      plannedApiRequests,
      Date.now() - startedAt,
      eventsDiscarded,
    ],
  })

  // Falha de D1 na pontuação. Depois de todas as competições terem a vez e do tick
  // registrado como erro, a primeira falha é relançada e a invocação sai como exceção.
  if (scoringFailures.length > 0) throw scoringFailures[0]

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
      calls_used: budget.used,
      calls_budget: budget.limit,
      scoring_competitions: toScore.length,
      matches_scored: matchesScored,
      scoring_unfinished: unfinished,
      total_ms: Date.now() - startedAt,
    }),
  )
}
