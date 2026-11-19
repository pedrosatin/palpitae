import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import { createProviderHttpObserver } from '../observability/providerHttp'
import { ESPN_MIN_INTERVAL_MS } from '../providers/espn'
import { CallBudgetExhaustedError } from './callBudget'
import { DRAIN_CALL_BUDGET, DrainBudget, type ItemBudget } from './drainBudget'
import { ESPN_MAX_CONCURRENT_COMPETITIONS } from './espnQuota'
import { isEspnRefusal, readEspnAccessPause } from './espnAccess'
import { espnDeferralItems, espnDiscoveryCost, type EspnWorkBase } from './espnWork'
import {
  MISSING_EVENTS_PER_DISCOVERY,
  RECONCILE_CALLS,
  advanceCompetitionStatus,
  footballDataItemCost,
  scoreWithinBudget,
} from './fdWork'
import { ESPN_DISCOVERY_DATE_COUNT, espnDatesAround } from './matchPollingWindow'
import { deferralOf, enqueueProviderWork, type NewWorkItem } from './providerWork'
import type { SyncResult } from './matchUpsert'
import { syncFixtures } from './sync'
import { runSyncTasks } from './syncTasks'

export { MISSING_EVENTS_PER_DISCOVERY }

/**
 * Saldo de subrequests da descoberta: o ramo de 45 chamadas da invocação (a limpeza
 * de registros expirados do `scheduled` e a folga ficam por fora, como no dreno e no
 * poller). Vale para a football-data e a ESPN juntas.
 */
export const DISCOVERY_CALL_BUDGET = DRAIN_CALL_BUDGET

/** O enfileiramento do que não coube: 1 `db.batch()` no fim, reservado do saldo antes de qualquer tarefa. */
const DISCOVERY_DEFER_CALLS = 1

type ActiveCompetition = {
  id: string
  external_id: string
  season: string
  provider: string
}

/** O estado de uma execução da descoberta, que as funções por competição atualizam. */
type DiscoveryRun = {
  apiKey: string
  ae: AnalyticsEngineDataset | undefined
  now: number
  espnDates: string[]
  missingEvents: { remaining: number }
  /** Itens `discovery` da fila para o que as competições não entregaram. */
  deferrals: NewWorkItem[]
  fixturesUpdated: number
  eventsDiscarded: number
  matchesMissing: number
  hadError: boolean
}

/** Custo estimado da descoberta de uma competição, em chamadas (D1 e `fetch`). */
function discoveryCost(comp: ActiveCompetition, espnDates: number): number {
  if (comp.provider === 'espn') return espnDiscoveryCost(espnDates)
  return footballDataItemCost({
    kind: 'discovery',
    competitionCode: comp.external_id,
    season: comp.season,
    round: '',
    competitionId: comp.id,
    attempts: 0,
    leaseOwner: '',
  })
}

/**
 * Itens `discovery` da fila para o que a competição não entregou, com o prazo que o
 * erro informa: um por data na ESPN (as `dates` dadas, ou as nove), um por
 * competição na football-data.
 */
function deferralItems(
  run: DiscoveryRun,
  comp: ActiveCompetition,
  dates: string[] | undefined,
  error: unknown,
): NewWorkItem[] {
  if (comp.provider === 'espn') {
    const base: EspnWorkBase = {
      kind: 'discovery',
      competitionCode: comp.external_id,
      season: comp.season,
      competitionId: comp.id,
    }
    return espnDeferralItems(base, dates ?? run.espnDates, error, run.now)
  }
  return [
    {
      kind: 'discovery',
      competitionCode: comp.external_id,
      season: comp.season,
      round: '',
      competitionId: comp.id,
      ...deferralOf(error, run.now, 'a competição'),
    },
  ]
}

/** Sincroniza a competição e pontua o que o sync deixou sem `scored_at`, com o saldo dela. */
async function syncAndScore(
  run: DiscoveryRun,
  comp: ActiveCompetition,
  span: ItemBudget,
): Promise<SyncResult | undefined> {
  const result = await syncFixtures({
    competitionCode: comp.external_id,
    season: Number(comp.season),
    dates: comp.provider === 'espn' ? run.espnDates : undefined,
    apiKey: run.apiKey,
    // O D1 e o `fetch` da competição saem do saldo que ela reservou: o que invadiria a
    // reserva do enfileiramento é recusado antes de chamar.
    db: span.db,
    callGate: span,
    // Toda tentativa reserva vaga no orçamento compartilhado do provedor
    // (ADR-027); a ESPN ainda tem o teto e o pacing por isolate.
    coordinate: true,
    onHttpAttempt: createProviderHttpObserver(run.ae, {
      context: 'discovery',
      competitionId: comp.id,
    }),
    ae: run.ae,
    missingEvents: run.missingEvents,
  })
  run.fixturesUpdated += result?.matches ?? 0
  run.eventsDiscarded += result?.discarded ?? 0
  run.matchesMissing += result?.missing ?? 0
  // Pontua jogos que ficaram 'finished' sem scored_at (ex: re-score após correção de placar
  // que o upsert do sync zerou), com o saldo que sobra à competição. O que não coube segue sem
  // `scored_at` e o poller pontua pelo índice dos jogos pendentes.
  const scoring = await scoreWithinBudget(comp.id, span, RECONCILE_CALLS)
  if (scoring?.error) throw new Error(scoring.error)
  if (scoring?.incomplete) throw new CallBudgetExhaustedError()
  return result
}

/** A falha do sync: vira item da fila, e só a que não é falta de saldo conta como erro do provedor. */
function deferFailedSync(run: DiscoveryRun, comp: ActiveCompetition, err: unknown): void {
  // Qualquer falha vira trabalho pendente: o dreno retoma no mesmo dia, e o progresso da
  // descoberta não espera a de amanhã. Sem vaga ou com cota bloqueada, o prazo segue o reset;
  // nas demais falhas, a espera conservadora. Falta de saldo de subrequests não é falha do
  // provedor.
  run.deferrals.push(...deferralItems(run, comp, undefined, err))
  if (err instanceof CallBudgetExhaustedError) {
    console.info(`[discovery] Sem saldo de chamadas comp=${comp.id}: a fila retoma.`)
    return
  }
  run.hadError = true
  logError(run.ae, 'football_api_error', `[discovery] Sync falhou comp=${comp.id}:`, err, {
    blobs: ['fixture_discovery', comp.id],
  })
}

/** O sync parcial da ESPN: o que chegou foi gravado, as datas que faltaram voltam pelo dreno. */
function deferPartialSync(
  run: DiscoveryRun,
  comp: ActiveCompetition,
  pending: NonNullable<SyncResult['pending']>,
): void {
  run.deferrals.push(...deferralItems(run, comp, run.espnDates, pending.error))
  if (isEspnRefusal(pending.error) || pending.error instanceof CallBudgetExhaustedError) return
  run.hadError = true
  logError(
    run.ae,
    'football_api_error',
    `[discovery] Sync parcial comp=${comp.id}:`,
    pending.error,
    { blobs: ['fixture_discovery', comp.id] },
  )
}

/** Sincroniza uma competição dentro do saldo que ela reservou e avança o status se o calendário veio inteiro. */
async function syncCompetition(
  run: DiscoveryRun,
  comp: ActiveCompetition,
  span: ItemBudget,
): Promise<void> {
  let result: SyncResult | undefined
  try {
    result = await syncAndScore(run, comp, span)
  } catch (err) {
    if (isEspnRefusal(err)) {
      run.deferrals.push(...deferralItems(run, comp, undefined, err))
      return
    }
    deferFailedSync(run, comp, err)
    return
  }
  if (result?.pending) {
    // O status só avança com a descoberta completa.
    deferPartialSync(run, comp, result.pending)
    return
  }
  // Só depois de um sync bem-sucedido: o status avança com o calendário atualizado.
  try {
    const advanced = await advanceCompetitionStatus(
      span.db,
      run.ae,
      comp.id,
      run.now,
      result?.discardedTbd ?? 0,
      comp.provider === 'espn'
        ? { provider: 'espn', competitionCode: comp.external_id, season: comp.season }
        : undefined,
    )
    if (!advanced) run.hadError = true
  } catch (err) {
    // Sem saldo para o avanço (reservado na estimativa, não deveria faltar): a descoberta
    // seguinte o avança, e o calendário já foi gravado.
    if (!(err instanceof CallBudgetExhaustedError)) throw err
    console.info(`[discovery] Sem saldo para avançar o status comp=${comp.id}.`)
  }
}

/**
 * O enfileiramento (1 chamada, reservada): se falha, a competição que ficou de fora é
 * replanejada pela descoberta seguinte, e a perda não é silenciosa.
 */
async function enqueueDeferrals(run: DiscoveryRun, budget: DrainBudget): Promise<void> {
  if (run.deferrals.length === 0) return
  try {
    const competitions = new Set(
      run.deferrals.filter((item) => item.provider === 'espn').map((item) => item.competitionId!),
    )
    const evidence = [...competitions].flatMap((id) =>
      run.espnDates.map((date) =>
        budget.db
          .prepare(`INSERT OR IGNORE INTO discovery_dates
        (competition_id, window_start, date) VALUES (?, ?, ?)`)
          .bind(id, run.espnDates[0], date),
      ),
    )
    await enqueueProviderWork(budget.db, run.deferrals, run.now, evidence)
  } catch (err) {
    run.hadError = true
    for (const competitionId of new Set(run.deferrals.map((item) => item.competitionId))) {
      logError(
        run.ae,
        'competition_status_error',
        `[discovery] Descoberta não enfileirada comp=${competitionId}:`,
        err,
        { blobs: [competitionId ?? ''] },
      )
    }
  }
}

/**
 * Descobre jogos novos das competições ativas. Roda 1x/dia de madrugada via Cron
 * Trigger (ver wrangler.toml), num horário sem jogos pra não competir com o poller.
 *
 * football-data consulta o calendário inteiro, sem matchday. ESPN consulta nove
 * datas individuais, de ontem UTC até hoje UTC + 7 dias, mesmo sem jogos no banco.
 * O upsert atualiza confrontos e horários sem remover jogos fora desse horizonte.
 *
 * Orçamento compartilhado (ADR-027): toda tentativa football-data reserva vaga
 * na janela de um minuto; o que o orçamento ou a cota recusarem vira item
 * pendente na fila durável, e o cron drenador retoma no mesmo dia — uma
 * competição que falhou não espera a descoberta de amanhã. A ESPN faz o mesmo
 * com o orçamento e o controle de acesso dela: cada data do scoreboard que não
 * chegar vira um item pendente, e o status da competição só avança quando a
 * descoberta consultou todas as datas.
 *
 * Custo sem retries: 1 request por competição football-data e 9 por competição
 * ESPN. Dez competições ESPN-primárias planejam 90 requests por execução, com
 * teto de syncs paralelas (`ESPN_MAX_CONCURRENT_COMPETITIONS`) e pacing HTTP
 * no cliente (~1,3s entre inícios).
 *
 * Subrequests (ADR-027, adendo do ticket 03): a invocação faz no máximo 50, e cada
 * request da ESPN custa 3 (vaga, `fetch` e registro da resposta), então uma
 * competição da ESPN de 9 datas custa cerca de 40 sozinha. A descoberta tem um
 * saldo de invocação (`DISCOVERY_CALL_BUDGET`, 45) e admite cada competição pelo
 * custo completo antes de começar, em ordem de visibilidade pública, quantidade
 * de grupos e slug. A que não
 * cabe nem começa e vira item `discovery` da fila (um por competição na
 * football-data, um por data na ESPN), pronto para o próximo dreno, sem tentativa
 * gasta e sem erro de provedor; o dreno conclui, grava os jogos novos, pontua e
 * avança o status. Todos os itens saem num único batch no fim, reservado do saldo
 * antes de qualquer tarefa: se ele falha, a execução sai como erro, cada competição
 * afetada registra `competition_status_error`, e a descoberta seguinte a replaneja.
 *
 * `opts.callBudget` é o saldo de subrequests da invocação. Só o `scheduled` roda no
 * plano Free e o passa (`DISCOVERY_CALL_BUDGET`); sem ele a descoberta não limita as
 * chamadas, como nos testes que exercitam o calendário de muitas competições.
 */
export async function discoverFixtures(
  db: D1Database,
  apiKey: string,
  ae?: AnalyticsEngineDataset,
  now = Date.now(),
  opts: { callBudget?: number } = {},
): Promise<void> {
  const startedAt = Date.now()
  const budget = new DrainBudget(
    db,
    opts.callBudget ?? Number.POSITIVE_INFINITY,
    DISCOVERY_DEFER_CALLS,
  )

  // Competições não-terminais com provider sincronizável. 'finished' fica de fora:
  // torneio acabado não ganha jogos novos, não vale gastar chamada da API. A
  // coluna só vira 'finished' dias depois do último jogo (`reconcileCompetitionStatus`),
  // e esses dias são a janela de correção do calendário.
  const rows = await budget.db
    .prepare(
      `SELECT c.id, c.external_id, c.season, c.provider
         FROM competitions c
        WHERE status != 'finished'
          AND provider IN ('football-data', 'espn')
          AND external_id IS NOT NULL
        ORDER BY CASE WHEN visibility = 'public' THEN 0 ELSE 1 END,
          (SELECT COUNT(*) FROM groups g WHERE g.competition_id = c.id) DESC,
          c.slug ASC`,
    )
    .all<ActiveCompetition>()

  if (rows.results.length === 0) {
    console.info('[discovery] Nenhuma competição ativa.')
    logEvent(ae, 'fixture_discovery_run', {
      blobs: ['ok'],
      // competitions, fixtures_updated, api_calls, duration_ms, events_discarded, matches_missing
      doubles: [0, 0, 0, Date.now() - startedAt, 0, 0],
    })
    return
  }

  const utcDay = new Date(now).setUTCHours(0, 0, 0, 0)
  const run: DiscoveryRun = {
    apiKey,
    ae,
    now,
    espnDates: espnDatesAround(utcDay, -1, ESPN_DISCOVERY_DATE_COUNT),
    missingEvents: { remaining: MISSING_EVENTS_PER_DISCOVERY },
    deferrals: [],
    fixturesUpdated: 0,
    eventsDiscarded: 0,
    matchesMissing: 0,
    hadError: false,
  }
  // Requests primárias planejadas, excluindo retries do provedor.
  const plannedApiRequests = rows.results.reduce(
    (count, comp) => count + (comp.provider === 'espn' ? run.espnDates.length : 1),
    0,
  )

  const espnPause = rows.results.some((comp) => comp.provider === 'espn')
    ? await readEspnAccessPause(budget.db, now)
    : null

  // A consulta prioriza visibilidade pública, uso por grupos e slug, sem preferência
  // por provedor. A reserva pelo custo completo segue essa ordem; o que não cabe
  // vai para a fila antes de qualquer tarefa começar.
  const costOf = (comp: ActiveCompetition) =>
    opts.callBudget === undefined ? 0 : discoveryCost(comp, run.espnDates.length)
  const admitted: { comp: ActiveCompetition; span: ItemBudget }[] = []
  for (const comp of rows.results) {
    if (comp.provider === 'espn' && espnPause) continue
    const span = budget.open(costOf(comp))
    if (span) admitted.push({ comp, span })
    else run.deferrals.push(...deferralItems(run, comp, undefined, new CallBudgetExhaustedError()))
  }

  await runSyncTasks(
    admitted,
    ({ comp }) => comp.provider,
    async ({ comp, span }) => {
      try {
        await syncCompetition(run, comp, span)
      } finally {
        span.close()
      }
    },
  )

  await enqueueDeferrals(run, budget)
  const { fixturesUpdated, eventsDiscarded, matchesMissing, hadError, deferrals, espnDates } = run

  logEvent(ae, 'fixture_discovery_run', {
    blobs: [hadError ? 'error' : 'ok'],
    doubles: [
      rows.results.length,
      fixturesUpdated,
      plannedApiRequests,
      Date.now() - startedAt,
      eventsDiscarded,
      matchesMissing,
    ],
  })

  console.info(
    '[perf]',
    JSON.stringify({
      route: 'cron discoverFixtures',
      competitions: rows.results.length,
      fixtures_updated: fixturesUpdated,
      sync_tasks: rows.results.length,
      deferred_items: deferrals.length,
      calls_used: budget.used,
      calls_budget: budget.limit,
      api_requests_planned: plannedApiRequests,
      espn_dates: espnDates,
      espn_max_concurrent: ESPN_MAX_CONCURRENT_COMPETITIONS,
      espn_min_interval_ms: ESPN_MIN_INTERVAL_MS,
      total_ms: Date.now() - startedAt,
    }),
  )
}
