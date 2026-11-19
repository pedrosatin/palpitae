import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent, tryLogEvent } from '../observability/events'
import { createProviderHttpObserver } from '../observability/providerHttp'
import { ESPN_MIN_INTERVAL_MS } from '../providers/espn'
import {
  callsLeft,
  CallBudgetExhaustedError,
  countD1Calls,
  INVOCATION_CALL_LIMIT,
  type CallBudget,
} from './callBudget'
import { DrainBudget, type ItemBudget } from './drainBudget'
import { ESPN_MAX_CONCURRENT_COMPETITIONS } from './espnQuota'
import { scoreWindowFromEspn } from './espnFallback'
import { isEspnRefusal } from './espnAccess'
import { espnDeferralItems, espnSyncCost, type EspnWorkBase } from './espnWork'
import { footballDataSyncCost } from './fdWork'
import { FD_MAX_CONCURRENT_REQUESTS, runWithConcurrency } from './footballDataQuota'
import {
  DAY_MS,
  EARLIEST_RESULT_MS,
  espnDatesAround,
  LATE_SWEEP_INTERVAL_MS,
  POLLER_TICK_MS,
  resultWindowBounds,
} from './matchPollingWindow'
import { MIN_SCORING_CALLS, scoreUnprocessedMatches } from './scoring'
import { deferralOf, enqueueProviderWork, type NewWorkItem } from './providerWork'
import {
  checkAndSendResultOverdueAlert,
  type ResultOverdueAlertEnv,
} from './resultOverdueAlert'
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

/** Datas do scoreboard ESPN de um dia UTC: o dia anterior e o próprio dia. */
function espnDates(utcDay: string): string[] {
  return espnDatesAround(Date.parse(`${utcDay}T00:00:00Z`), -1, 2)
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
  const { earliestOver, stillRelevant, rescueFloor, lateFloor } = resultWindowBounds(now)
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

/**
 * Fim do tick reservado à pontuação: a leitura das competições com pontuação
 * pendente e o mínimo para pontuar uma competição (planejar e gravar uma vez). O
 * saldo das sincronizações e o do fallback nunca invadem essa reserva; a
 * pontuação ainda recebe o que sobrar além dela.
 */
const SCORING_RESERVE_CALLS = 1 + MIN_SCORING_CALLS

/**
 * O enfileiramento do que não coube no saldo ou não veio, das rodadas da
 * football-data e das datas da ESPN: 1 `db.batch()` no fim das sincronizações,
 * reservado do saldo delas antes de qualquer tarefa começar, como o dreno
 * reserva o batch de estado.
 */
const SYNC_DEFER_CALLS = 1

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

/**
 * Custo estimado de uma tarefa da football-data do poller: o sync do item do dreno,
 * sem a pontuação, que o tick faz no fim com a reserva própria.
 */
function footballDataTaskCost(task: SyncTask): number {
  return footballDataSyncCost({
    kind: 'result',
    competitionCode: task.comp.external_id,
    season: task.comp.season,
    round: task.round,
    competitionId: task.comp.comp_id,
    attempts: 0,
    leaseOwner: '',
  })
}

/**
 * Saldo de uma fase do tick, fixado antes de ela começar: o que sobra de
 * `POLLER_CALL_BUDGET` depois do que já foi gasto e da reserva da pontuação. As
 * sincronizações (football-data e ESPN juntas) recebem o que a leitura dos jogos
 * deixa; o fallback, o que as sincronizações deixam.
 */
function syncAllowance(budget: CallBudget): number {
  return Math.max(0, callsLeft(budget) - SCORING_RESERVE_CALLS)
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

type SyncOutcome =
  | {
      success: true
      comp: ActiveRound
      round: string
      matches: number
      discarded: number
      /** ESPN: por que parte das datas ficou pendente; o que veio foi gravado. */
      pendingError?: unknown
    }
  | { success: false; comp: ActiveRound; round: string; err: unknown }

/** Totais das sincronizações do tick e as competições que seguem para fallback e pontuação. */
type SyncTally = {
  fixturesUpdated: number
  eventsDiscarded: number
  hadError: boolean
  syncedComps: Set<string>
  fallbackCompIds: Set<string>
}

/**
 * Soma os resultados das sincronizações e registra `football_api_error` para cada
 * falha, na ordem dos resultados. O fallback da ESPN cobre as competições
 * football-data, menos na varredura de atrasados, que só roda sem jogo nas 24 h
 * do fallback.
 */
function tallySyncOutcomes(
  results: SyncOutcome[],
  ae: AnalyticsEngineDataset | undefined,
  lateTask: SyncTask | undefined,
): SyncTally {
  const tally: SyncTally = {
    fixturesUpdated: 0,
    eventsDiscarded: 0,
    hadError: false,
    syncedComps: new Set(),
    fallbackCompIds: new Set(),
  }
  const reportFailure = (comp: ActiveRound, round: string, err: unknown) => {
    // Recusa do orçamento, bloqueio ou suspensão da ESPN não é falha do sync:
    // o trabalho ficou pendente na fila e o alerta de acesso já saiu quando o
    // provedor respondeu.
    if (isEspnRefusal(err)) {
      console.info(`[poller] ESPN indisponível comp=${comp.comp_id} round=${round}: ${err.message}`)
      return
    }
    // Sem saldo no tick o trabalho foi para a fila e fica elegível para o próximo dreno: não
    // é falha do provedor.
    if (err instanceof CallBudgetExhaustedError) {
      console.info(`[poller] Sem saldo de chamadas comp=${comp.comp_id} round=${round}: adiado.`)
      return
    }
    tally.hadError = true
    logError(
      ae,
      'football_api_error',
      `[poller] Sync falhou comp=${comp.comp_id} round=${round}:`,
      err,
      {
        blobs: [comp.comp_id, round],
      },
    )
  }
  for (const res of results) {
    if (res.comp.provider !== 'espn' && !lateTask) tally.fallbackCompIds.add(res.comp.comp_id)
    if (res.success) {
      tally.fixturesUpdated += res.matches
      tally.eventsDiscarded += res.discarded
      tally.syncedComps.add(res.comp.comp_id)
      if (res.pendingError !== undefined) reportFailure(res.comp, res.round, res.pendingError)
    } else {
      reportFailure(res.comp, res.round, res.err)
    }
  }
  return tally
}

/** Tarefa da football-data e o saldo reservado para ela; `null` quando não coube. */
type FdAdmission = { task: SyncTask; span: ItemBudget | null }

/** O que as sincronizações do tick deixam: os resultados, o gasto e o que foi para a fila. */
type SyncPhase = {
  results: SyncOutcome[]
  /** Chamadas gastas pelas sincronizações (D1 e `fetch`), para somar na conta do tick. */
  used: number
  /** Saldo fixado para as sincronizações. */
  limit: number
  /** Rodadas da football-data enfileiradas no tick, por falta de saldo ou falha. */
  deferredRounds: number
  /** Datas da ESPN enfileiradas no tick, por falta de saldo ou falha. */
  deferredDates: number
  /** O enfileiramento falhou: as pendências não chegaram à fila. */
  queueFailed: boolean
}

/**
 * Sincroniza as tarefas do tick dentro do saldo delas (ADR-027, adendos do ticket 03
 * e do ticket 09). Cada tarefa é admitida pelo custo completo antes de começar, contra
 * um saldo fixado antes de qualquer sincronização, pela mesma fatia do dreno
 * (`DrainBudget`). A football-data é admitida primeiro, na ordem das tarefas, pelo
 * custo do sync do item do dreno (`footballDataSyncCost`: vaga, `fetch` e gravação da rodada);
 * a ESPN fica com o que resta (vaga, `fetch` e registro de cada data, mais a
 * gravação). A tarefa que não cabe nem começa: vira pendência na fila durável e fica
 * elegível para o próximo dreno. O enfileiramento (1 chamada) está reservado do saldo, e os `fetch`
 * são cobrados pelo porteiro, não pelo observador (sem contar duas vezes).
 */
async function syncProviderTasks(opts: {
  rawDb: D1Database
  budget: CallBudget
  fdTasks: SyncTask[]
  espnTasks: SyncTask[]
  lateTask: SyncTask | undefined
  apiKey: string
  ae: AnalyticsEngineDataset | undefined
}): Promise<SyncPhase> {
  const { rawDb, budget, fdTasks, espnTasks, lateTask, apiKey, ae } = opts
  const syncBudget = new DrainBudget(rawDb, syncAllowance(budget), SYNC_DEFER_CALLS)
  const fdDeferrals: NewWorkItem[] = []
  const espnDeferrals: NewWorkItem[] = []

  // A football-data reserva o custo de todas as tarefas antes de qualquer sync, na
  // ordem delas, de modo que a tarefa que espera a vez no teto de paralelismo já tem o
  // saldo garantido, e a ESPN, que admite as dela ao começar cada uma, só enxerga o que
  // sobrou.
  const fdAdmitted = fdTasks.map((task) => ({
    task,
    span: syncBudget.open(footballDataTaskCost(task)),
  }))

  const runFdTask = async ({ task, span }: FdAdmission): Promise<SyncOutcome> => {
    const { comp, round } = task
    const defer = (err: unknown) => {
      fdDeferrals.push({
        kind: task === lateTask ? 'late' : 'result',
        competitionCode: comp.external_id,
        season: comp.season,
        round,
        competitionId: comp.comp_id,
        ...deferralOf(err, Date.now(), 'a rodada'),
      })
      return { success: false as const, comp, round, err }
    }
    // Não coube no saldo do tick: a rodada espera o dreno, sem erro do provedor nem tentativa.
    if (!span) return defer(new CallBudgetExhaustedError())
    const matchday = parseInt(round, 10)
    try {
      const result = await syncFixtures({
        competitionCode: comp.external_id,
        season: Number(comp.season),
        matchday: Number.isNaN(matchday) ? undefined : matchday,
        apiKey,
        db: span.db,
        coordinate: true,
        callGate: span,
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
      // Qualquer falha vira trabalho pendente: o dreno retoma entre os ticks, inclusive
      // além das 24 h do resgate. Sem vaga ou com cota bloqueada, o prazo segue o reset;
      // sem saldo no tick (a requisição ou a gravação não coube), o próximo dreno; nas
      // demais falhas, a espera conservadora.
      return defer(err)
    } finally {
      span.close()
    }
  }

  const runEspnTask = async (task: SyncTask): Promise<SyncOutcome> => {
    const { comp, round, dates } = task
    const base: EspnWorkBase = {
      kind: task === lateTask ? 'late' : 'result',
      competitionCode: comp.external_id,
      season: comp.season,
      competitionId: comp.comp_id,
    }
    const span = syncBudget.open(espnSyncCost(dates?.length ?? 1))
    if (!span) {
      // Não coube no saldo do tick: a data espera o dreno, sem erro do provedor nem tentativa.
      const err = new CallBudgetExhaustedError()
      espnDeferrals.push(...espnDeferralItems(base, dates, err))
      return { success: false as const, comp, round, err }
    }
    try {
      const result = await syncFixtures({
        competitionCode: comp.external_id,
        season: Number(comp.season),
        dates,
        apiKey,
        db: span.db,
        coordinate: true,
        callGate: span,
        onHttpAttempt: createProviderHttpObserver(ae, {
          context: 'poller',
          competitionId: comp.comp_id,
        }),
        ae,
      })
      // O que a ESPN não entregou (orçamento, bloqueio, timeout, resposta
      // incompleta, falta de saldo) vira uma pendência por data; o que chegou já foi gravado.
      if (result.pending) {
        espnDeferrals.push(...espnDeferralItems(base, result.pending.dates, result.pending.error))
      }
      return {
        success: true as const,
        comp,
        round,
        matches: result.matches,
        discarded: result.discarded,
        ...(result.pending ? { pendingError: result.pending.error } : {}),
      }
    } catch (err) {
      // Falha depois do fetch (gravação, ou saldo que acabou antes de gravar): nada foi
      // aproveitado, todas as datas voltam.
      espnDeferrals.push(...espnDeferralItems(base, dates, err))
      return { success: false as const, comp, round, err }
    } finally {
      span.close()
    }
  }

  /**
   * Grava de uma vez o que não veio, com o saldo reservado para isso. Se a gravação
   * falha, o log tem o erro e o tick sai como erro (o poller replaneja pelo D1 no tick
   * seguinte, e a descoberta e o dreno cobrem o resto).
   */
  const flush = async (): Promise<boolean> => {
    const deferrals = [...fdDeferrals, ...espnDeferrals]
    if (deferrals.length === 0) return true
    try {
      await enqueueProviderWork(syncBudget.db, deferrals, Date.now())
      return true
    } catch (err) {
      logError(ae, 'football_api_error', '[poller] Falha ao enfileirar as pendências:', err, {
        blobs: ['poller_defer', String(deferrals.length)],
      })
      return false
    }
  }

  const [fdResults, espnResults] = await Promise.all([
    runWithConcurrency(FD_MAX_CONCURRENT_REQUESTS, fdAdmitted, runFdTask),
    runWithConcurrency(ESPN_MAX_CONCURRENT_COMPETITIONS, espnTasks, runEspnTask),
  ])
  const queued = await flush()
  return {
    results: [...fdResults, ...espnResults],
    used: syncBudget.used,
    limit: syncBudget.limit,
    deferredRounds: fdDeferrals.length,
    deferredDates: espnDeferrals.length,
    queueFailed: !queued,
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
 *
 * Pontuação (ADR-024): uma competição por vez, dentro do que sobra de
 * `POLLER_CALL_BUDGET`. Entram as sincronizadas no tick e as que têm jogo
 * encerrado sem pontuação no D1, com ou sem jogo na janela. A que não termina
 * continua no tick seguinte de onde parou, e o erro de uma não impede as outras.
 *
 * Fila durável (ADR-027): toda tentativa football-data reserva vaga no
 * orçamento compartilhado por minuto. O que o orçamento ou a cota recusarem
 * vira item pendente em `provider_work`, e o cron drenador retoma entre os
 * ticks, inclusive além das 24 h do resgate. A ESPN segue o mesmo caminho com
 * o orçamento e o controle de acesso dela: a data do scoreboard que falhar vira
 * item pendente, e o que chegou das outras datas é gravado.
 *
 * Subrequests (ADR-027, adendos dos tickets 03 e 09): o `POLLER_CALL_BUDGET` vale para
 * a football-data e a ESPN juntas. Cada tarefa é admitida pelo custo completo contra um
 * saldo fixado antes das sincronizações, com o enfileiramento reservado: a rodada da
 * football-data primeiro (vaga, `fetch` e gravação), a ESPN com o que sobra (3 chamadas
 * por data e a gravação). A que não cabe vira pendência na fila e fica elegível para o
 * próximo dreno, sem erro de provedor nem tentativa gasta. O fallback só gasta o que
 * sobra além da reserva da pontuação, e cada competição dele reserva o custo completo
 * (consulta, datas e gravação) antes de começar.
 */
export async function pollActiveMatches(
  rawDb: D1Database,
  apiKey: string,
  ae?: AnalyticsEngineDataset,
  now = Date.now(),
  /** Quando presente, avalia o alerta de resultado atrasado no fim do tick. */
  alertEnv?: ResultOverdueAlertEnv,
): Promise<void> {
  const startedAt = Date.now()
  const budget: CallBudget = { limit: POLLER_CALL_BUDGET, used: 0 }
  const db = countD1Calls(rawDb, budget)

  const runOverdueAlert = async () => {
    if (!alertEnv) return
    // Limpeza do cron (1) + este alerta (até RESULT_OVERDUE_ALERT_CALLS) precisam
    // caber nos 50 da invocação. Sem saldo, a função só registra skipped_budget.
    const left = INVOCATION_CALL_LIMIT - budget.used - CLEANUP_CALLS
    await checkAndSendResultOverdueAlert(rawDb, alertEnv, ae, now, left)
  }

  const { lateTask, tasks, compCount, roundDays } = planTasks(await loadPollerRows(db, now), now)

  // Orçamento compartilhado (ADR-027): cada tentativa, football-data ou ESPN,
  // reserva vaga na janela de um minuto do provedor. O que o orçamento, a cota,
  // o bloqueio ou o saldo de subrequests do tick recusarem vira item durável na
  // fila, para o cron drenador retomar — inclusive além das 24 h do resgate. Na
  // ESPN o item é uma data do scoreboard.
  const espnTasks = tasks.filter((task) => task.comp.provider === 'espn')
  const fdTasks = tasks.filter((task) => task.comp.provider !== 'espn')

  const sync = await syncProviderTasks({ rawDb, budget, fdTasks, espnTasks, lateTask, apiKey, ae })
  // O que as sincronizações gastaram entra na conta do tick: o fallback e a pontuação
  // enxergam o que sobra.
  budget.used += sync.used
  const syncResults = sync.results

  // Requests primárias planejadas, sem retries nem chamadas do fallback.
  const plannedApiRequests = tasks.reduce((count, task) => count + (task.dates?.length ?? 1), 0)
  const tally = tallySyncOutcomes(syncResults, ae, lateTask)
  const { fixturesUpdated, eventsDiscarded, syncedComps, fallbackCompIds } = tally
  const hadError = tally.hadError || sync.queueFailed

  // HTTP 200 pode trazer status atrasado: o fallback consulta o D1 após os upserts
  // e só chama a ESPN quando ainda há partidas elegíveis sem resultado final.
  if (fallbackCompIds.size > 0) {
    // O fallback é complementar (o D1 o replaneja a cada tick) e só gasta o que sobra além da
    // reserva da pontuação. Cada competição reserva o custo completo (consulta, datas e
    // gravação) antes de começar, e o D1 e o porteiro dela recusam sem chamar o que passaria
    // do saldo: sem saldo ela espera o tick seguinte, sem fila nem erro. O porteiro cobra os
    // `fetch`, e o observador não os conta de novo.
    const fallbackBudget = new DrainBudget(rawDb, syncAllowance(budget), 0)
    try {
      const updatedByComp = await scoreWindowFromEspn(db, ae, Array.from(fallbackCompIds), {
        now,
        coordinate: true,
        budget: fallbackBudget,
      })
      for (const [compId, updated] of updatedByComp) {
        if (updated > 0) syncedComps.add(compId)
      }
    } catch (err) {
      // blob2 vazio: a falha é do fallback inteiro, sem competição (a mensagem fica em blob3).
      logError(ae, 'match_results_fallback', '[poller] Fallback ESPN falhou:', err, {
        blobs: [''],
      })
    } finally {
      budget.used += fallbackBudget.used
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
    await runOverdueAlert()
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

  await runOverdueAlert()

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
      sync_budget: sync.limit,
      fd_deferred_rounds: sync.deferredRounds,
      espn_deferred_dates: sync.deferredDates,
      calls_used: budget.used,
      calls_budget: budget.limit,
      scoring_competitions: toScore.length,
      matches_scored: matchesScored,
      scoring_unfinished: unfinished,
      total_ms: Date.now() - startedAt,
    }),
  )
}
