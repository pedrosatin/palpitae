import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import { createProviderHttpObserver } from '../observability/providerHttp'
import { ESPN_MIN_INTERVAL_MS } from '../providers/espn'
import { CallBudgetExhaustedError } from './callBudget'
import { DRAIN_CALL_BUDGET, DrainBudget, type ItemBudget } from './drainBudget'
import { ESPN_MAX_CONCURRENT_COMPETITIONS } from './espnQuota'
import { isEspnRefusal } from './espnAccess'
import { espnDeferralItems, espnDiscoveryCost, type EspnWorkBase } from './espnWork'
import {
  MISSING_EVENTS_PER_DISCOVERY,
  RECONCILE_CALLS,
  advanceCompetitionStatus,
  footballDataItemCost,
  scoreWithinBudget,
} from './fdWork'
import { espnDatesAround } from './matchPollingWindow'
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
 * custo completo antes de começar, a football-data (barata) primeiro. A que não
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
      `SELECT id, external_id, season, provider
         FROM competitions
        WHERE status != 'finished'
          AND provider IN ('football-data', 'espn')
          AND external_id IS NOT NULL`,
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
  const espnDates = espnDatesAround(utcDay, -1, 9)
  // Requests primárias planejadas, excluindo retries do provedor.
  let plannedApiRequests = 0
  let fixturesUpdated = 0
  const missingEvents = { remaining: MISSING_EVENTS_PER_DISCOVERY }
  let eventsDiscarded = 0
  let matchesMissing = 0
  let hadError = false

  for (const comp of rows.results) {
    plannedApiRequests += comp.provider === 'espn' ? espnDates.length : 1
  }

  const workBase = (comp: ActiveCompetition): EspnWorkBase => ({
    kind: 'discovery',
    competitionCode: comp.external_id,
    season: comp.season,
    competitionId: comp.id,
  })

  /** Itens `discovery` da fila para o que a competição não entregou, com o prazo que o erro informa. */
  const deferrals: NewWorkItem[] = []
  const deferralItems = (
    comp: ActiveCompetition,
    dates: string[] | undefined,
    error: unknown,
  ): NewWorkItem[] =>
    comp.provider === 'espn'
      ? espnDeferralItems(workBase(comp), dates ?? espnDates, error)
      : [
          {
            kind: 'discovery',
            competitionCode: comp.external_id,
            season: comp.season,
            round: '',
            competitionId: comp.id,
            ...deferralOf(error, Date.now()),
          },
        ]

  const syncCompetition = async (comp: ActiveCompetition, span: ItemBudget): Promise<void> => {
    let tbdDiscarded = 0
    let pending: SyncResult['pending']
    try {
      const result = await syncFixtures({
        competitionCode: comp.external_id,
        season: Number(comp.season),
        dates: comp.provider === 'espn' ? espnDates : undefined,
        apiKey,
        // O D1 e o `fetch` da competição saem do saldo que ela reservou: o que invadiria a
        // reserva do enfileiramento é recusado antes de chamar.
        db: span.db,
        callGate: span,
        // Toda tentativa reserva vaga no orçamento compartilhado do provedor
        // (ADR-027); a ESPN ainda tem o teto e o pacing por isolate.
        coordinate: true,
        onHttpAttempt: createProviderHttpObserver(ae, {
          context: 'discovery',
          competitionId: comp.id,
        }),
        ae,
        missingEvents,
      })
      fixturesUpdated += result?.matches ?? 0
      eventsDiscarded += result?.discarded ?? 0
      matchesMissing += result?.missing ?? 0
      // Pontua jogos que ficaram 'finished' sem scored_at (ex: re-score após
      // correção de placar que o upsert do sync zerou), com o saldo que sobra à
      // competição. O que não coube segue sem `scored_at` e o poller pontua pelo
      // índice dos jogos pendentes.
      const scoring = await scoreWithinBudget(comp.id, span, RECONCILE_CALLS)
      if (scoring?.error) throw new Error(scoring.error)
      tbdDiscarded = result?.discardedTbd ?? 0
      pending = result?.pending
    } catch (err) {
      // Qualquer falha vira trabalho pendente: o dreno retoma no mesmo dia, e
      // o progresso da descoberta não espera a de amanhã. Sem vaga ou com cota
      // bloqueada, o prazo segue o reset; nas demais falhas, a espera
      // conservadora. Falta de saldo de subrequests não é falha do provedor.
      deferrals.push(...deferralItems(comp, undefined, err))
      if (err instanceof CallBudgetExhaustedError) {
        console.info(`[discovery] Sem saldo de chamadas comp=${comp.id}: a fila retoma.`)
        return
      }
      hadError = true
      logError(ae, 'football_api_error', `[discovery] Sync falhou comp=${comp.id}:`, err, {
        blobs: ['fixture_discovery', comp.id],
      })
      return
    }
    if (pending) {
      // ESPN: o que chegou foi gravado; as datas que faltaram voltam pelo
      // dreno, e o status só avança com a descoberta completa.
      deferrals.push(...deferralItems(comp, pending.dates, pending.error))
      if (!isEspnRefusal(pending.error) && !(pending.error instanceof CallBudgetExhaustedError)) {
        hadError = true
        logError(
          ae,
          'football_api_error',
          `[discovery] Sync parcial comp=${comp.id}:`,
          pending.error,
          {
            blobs: ['fixture_discovery', comp.id],
          },
        )
      }
      return
    }
    // Só depois de um sync bem-sucedido: o status avança com o calendário atualizado.
    try {
      if (!(await advanceCompetitionStatus(span.db, ae, comp.id, now, tbdDiscarded))) {
        hadError = true
      }
    } catch (err) {
      // Sem saldo para o avanço (reservado na estimativa, não deveria faltar): a descoberta
      // seguinte o avança, e o calendário já foi gravado.
      if (!(err instanceof CallBudgetExhaustedError)) throw err
      console.info(`[discovery] Sem saldo para avançar o status comp=${comp.id}.`)
    }
  }

  // Admissão pelo custo completo, a football-data (1 request) antes da ESPN (9 datas): a
  // reserva é feita antes de qualquer tarefa, na ordem, e o que não cabe nem começa.
  const costOf = (comp: ActiveCompetition): number =>
    opts.callBudget === undefined
      ? 0
      : comp.provider === 'espn'
        ? espnDiscoveryCost(espnDates.length)
        : footballDataItemCost({
            kind: 'discovery',
            competitionCode: comp.external_id,
            season: comp.season,
            round: '',
            competitionId: comp.id,
            attempts: 0,
            leaseOwner: '',
          })
  const ordered = [...rows.results].sort(
    (a, b) => Number(a.provider === 'espn') - Number(b.provider === 'espn'),
  )
  const plan = ordered.map((comp) => ({ comp, span: budget.open(costOf(comp)) }))
  for (const { comp, span } of plan) {
    if (!span) deferrals.push(...deferralItems(comp, undefined, new CallBudgetExhaustedError()))
  }
  const admitted = plan.flatMap(({ comp, span }) => (span ? [{ comp, span }] : []))

  await runSyncTasks(
    admitted,
    ({ comp }) => comp.provider,
    async ({ comp, span }) => {
      try {
        await syncCompetition(comp, span)
      } finally {
        span.close()
      }
    },
  )

  // O enfileiramento (1 chamada, reservada): se falha, a competição que ficou de fora é
  // replanejada pela descoberta seguinte, e a perda não é silenciosa.
  if (deferrals.length > 0) {
    try {
      await enqueueProviderWork(budget.db, deferrals, Date.now())
    } catch (err) {
      hadError = true
      for (const competitionId of new Set(deferrals.map((item) => item.competitionId))) {
        logError(
          ae,
          'competition_status_error',
          `[discovery] Descoberta não enfileirada comp=${competitionId}:`,
          err,
          { blobs: [competitionId ?? ''] },
        )
      }
    }
  }

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
