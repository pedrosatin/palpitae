import type { D1Database } from '@cloudflare/workers-types'
import { logError, tryLogError, tryLogEvent } from '../observability/events'
import { createProviderHttpObserver, type ProviderHttpContext } from '../observability/providerHttp'
import { CallBudgetExhaustedError } from './callBudget'
import { isEspnRefusal } from './espnAccess'
import { reconcileCompetitionStatus, type DiscoveryQueueGuard } from './competitionLifecycle'
import type { ProviderDrain } from './drainCoordinator'
import { CYCLE_FIXED_CALLS, type DrainBudget, type ItemBudget } from './drainBudget'
import { FootballDataQuotaError } from './footballDataQuota'
import { FootballDataSlotBusyError } from './providerBudget'
import { MIN_SCORING_CALLS, scoreUnprocessedMatches } from './scoring'
import { syncFixtures, syncWriteCalls, type SyncOptions } from './sync'
import {
  drainProviderWork,
  WORK_BUSY_RETRY_MS,
  type DrainRun,
  type ProviderWorkItem,
  type ProviderWorkKind,
  type SyncedHandler,
  type WorkOutcome,
} from './providerWork'

/**
 * Teto de `match_missing_from_feed` por execução, somando os itens (cada
 * competição tem o próprio teto em `MISSING_EVENTS_PER_COMPETITION`).
 */
export const MISSING_EVENTS_PER_DISCOVERY = 30

/**
 * Liga a fila durável de trabalho à sync da football-data (ADR-027): executa
 * itens reclamados com o orçamento compartilhado ligado, faz o pós-sync da
 * descoberta e do sync administrativo e expõe o dreno que o coordenador chama a
 * cada tick (`footballDataDrain`), que retoma o que ficou pendente por
 * orçamento, falha ou reinício, dentro da fatia de subrequests da invocação.
 */

/** Quem disparou a tentativa, na telemetria por item. */
export function httpContextOf(kind: ProviderWorkKind): ProviderHttpContext {
  return kind === 'discovery' ? 'discovery' : kind === 'manual' ? 'sync' : 'poller'
}

/**
 * Rodada numérica vira `matchday`; fase de mata-mata ou rodada vazia buscam a
 * temporada inteira, como no poller.
 */
function matchdayOf(round: string): number | undefined {
  if (round === '') return undefined
  const matchday = Number.parseInt(round, 10)
  return Number.isNaN(matchday) ? undefined : matchday
}

/**
 * Custo estimado de um item da football-data, em chamadas (D1 e `fetch`), que o
 * dreno confere contra o saldo antes de começar o item. As estimativas são
 * conservadoras e são o piso: o maior custo real visto numa classe do dreno
 * (`DrainOptions.costClass`) só as sobe nos itens seguintes. `fdWork.test.ts`
 * mede cada classe e falha se o custo real passar da estimativa.
 *
 * - requisição: reserva de vaga + `fetch` (2); um 429 com retry soma 3 (gravar o
 *   bloqueio, reservar de novo e novo `fetch`) e fica fora: se o saldo não
 *   cobrir, o item volta à fila sem tentativa;
 * - gravação do calendário: `syncWriteCalls`. Rodada numérica, cerca de 10
 *   jogos entre 20 times (6); calendário da temporada, até 380 jogos (9);
 * - pontuação de todo item (resultado, varredura, manual e descoberta): o mínimo
 *   para planejar e gravar uma vez (`MIN_SCORING_CALLS`). A pontuação usa o que
 *   estiver livre no saldo; se não terminar, o item volta à fila sem tentativa e
 *   o próximo dreno retoma de onde parou;
 * - descoberta: mais a conferência de jogos ausentes (na gravação) e o avanço do
 *   status da competição (1).
 */
const REQUEST_CALLS = 2
const ROUND_MATCHES = 10
const SEASON_MATCHES = 380
const TEAMS = 20
export const RECONCILE_CALLS = 1

/**
 * Custo estimado só do sync do item (requisição e gravação de uma rodada ou do
 * calendário da temporada), sem o pós-sync. O poller admite a rodada por ele: a
 * pontuação do tick tem a reserva própria no fim (`SCORING_RESERVE_CALLS`).
 */
export function footballDataSyncCost(item: ProviderWorkItem): number {
  const season = matchdayOf(item.round) === undefined
  const matches = season ? SEASON_MATCHES : ROUND_MATCHES
  return REQUEST_CALLS + syncWriteCalls(matches, TEAMS, item.kind === 'discovery')
}

/** Custo estimado do item no dreno: o sync e o pós-sync (pontuação e, na descoberta, o status). */
export function footballDataItemCost(item: ProviderWorkItem): number {
  const sync = footballDataSyncCost(item) + MIN_SCORING_CALLS
  return item.kind === 'discovery' ? sync + RECONCILE_CALLS : sync
}

/** Itens com o mesmo tipo e o mesmo alcance (rodada ou temporada) custam o mesmo. */
function footballDataCostClass(item: ProviderWorkItem): string {
  return `${item.kind}:${matchdayOf(item.round) === undefined ? 'season' : 'round'}`
}

/** O item mais barato da football-data: um `result` de rodada numérica, com a pontuação. */
export function footballDataMinItemCalls(): number {
  return REQUEST_CALLS + syncWriteCalls(ROUND_MATCHES, TEAMS, false) + MIN_SCORING_CALLS
}

export type FdWorkDeps = {
  apiKey: string
  ae?: AnalyticsEngineDataset
  /**
   * Opções extras do sync por item; a descoberta passa o saldo compartilhado
   * de `match_missing_from_feed` da execução.
   */
  extraSyncOptions?: (item: ProviderWorkItem) => Partial<SyncOptions> | undefined
  now?: number
}

/**
 * Executa um item reclamado da fila: um syncFixtures com o orçamento
 * compartilhado ligado. Sem vaga (`FootballDataSlotBusyError`) ou com pausa de
 * cota vigente (`FootballDataQuotaError`), o item volta à fila sem contar
 * tentativa — o provedor não foi chamado. Falha de verdade (rede, 5xx, 429 sem
 * recuperação, falha de gravação) conta tentativa, até o teto da fila. Falta de
 * saldo de subrequests (`CallBudgetExhaustedError`) não é falha: propaga, e o
 * dreno devolve o item sem tentativa.
 */
export function runFootballDataWorkItem(
  deps: FdWorkDeps,
): (item: ProviderWorkItem, budget: ItemBudget) => Promise<WorkOutcome> {
  return async (item, budget) => {
    const observer = createProviderHttpObserver(deps.ae, {
      context: httpContextOf(item.kind),
      competitionId: item.competitionId,
    })
    const matchday = matchdayOf(item.round)
    try {
      const result = await syncFixtures({
        competitionCode: item.competitionCode,
        season: Number(item.season),
        ...(matchday !== undefined ? { matchday } : {}),
        apiKey: deps.apiKey,
        db: budget.db,
        coordinate: true,
        callGate: budget,
        onHttpAttempt: observer,
        ae: deps.ae,
        ...deps.extraSyncOptions?.(item),
      })
      return { item, status: 'done', result }
    } catch (err) {
      // Falta de saldo não é falha do provedor: o dreno devolve o item sem tentativa.
      if (err instanceof CallBudgetExhaustedError) throw err
      // Sem vaga ou em pausa, o provedor inteiro recusa: o dreno não tenta os demais.
      if (err instanceof FootballDataSlotBusyError) {
        return {
          item,
          status: 'requeued',
          notBefore: (deps.now ?? Date.now()) + WORK_BUSY_RETRY_MS,
          error: err.message,
          providerBlocked: true,
        }
      }
      if (err instanceof FootballDataQuotaError) {
        return {
          item,
          status: 'requeued',
          notBefore: err.retryAt,
          error: err.message,
          providerBlocked: true,
        }
      }
      // Item de competição da ESPN (a retomada de uma descoberta que falhou): o acesso pausado
      // devolve o item no prazo do bloqueio, sem tentativa. O dreno da football-data segue.
      if (isEspnRefusal(err)) {
        return { item, status: 'requeued', notBefore: err.retryAt, error: err.message }
      }
      return {
        item,
        status: 'retry',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}

/**
 * Avança o status da competição depois de um sync bem-sucedido da descoberta.
 * Falha do D1 aqui vira `competition_status_error`, separada dos erros de
 * provedor; o status fica como estava e a próxima descoberta tenta de novo.
 * Falta de saldo de subrequests (`CallBudgetExhaustedError`) não vira evento:
 * sobe, e o dreno devolve o item sem tentativa para retomar.
 */
export async function advanceCompetitionStatus(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  competitionId: string,
  now: number,
  tbdDiscarded: number,
  queue?: DiscoveryQueueGuard,
): Promise<boolean> {
  try {
    const status = await reconcileCompetitionStatus(db, competitionId, now, tbdDiscarded, queue)
    if (status === 'finished') {
      console.info(`[discovery] Competição ${competitionId} encerrada; sai da descoberta diária.`)
    }
    return true
  } catch (err) {
    // Falta de saldo não é falha do status: o item volta à fila sem tentativa e retoma.
    if (err instanceof CallBudgetExhaustedError) throw err
    logError(
      ae,
      'competition_status_error',
      `[discovery] Status da competição não avançou comp=${competitionId}:`,
      err,
      { blobs: [competitionId] },
    )
    return false
  }
}

/**
 * Pós-sync: todo item pontua os jogos que o sync deixou encerrados sem
 * `scored_at`, e a descoberta ainda avança o status da competição. A rodada que
 * o poller adiou por saldo (`result`, `late`) ganha placar, pontos e ranking no
 * mesmo dreno, sem esperar o próximo tick do poller (ADR-027, adendo do ticket
 * 09). Falha ao pontuar vira erro do sync no resultado do item, e o poller
 * repontua pelo D1 (`PENDING_SCORING_SQL`); falha ao avançar o status fica no
 * evento próprio e só marca a execução com erro. Nada disso repete o sync: o
 * item termina, e o reprocesso é idempotente (upsert sem mudança não grava;
 * `scored_at` não volta; os pontos e o ranking são regravados, não somados).
 *
 * A pontuação gasta só o que está livre no saldo (e, na descoberta, deixa 1
 * para o avanço do status). Se não termina, o jogo que falta segue sem
 * `scored_at` e o item volta à fila sem tentativa nova (`incomplete`): o próximo
 * dreno repete o sync, barato e idempotente, e retoma a pontuação de onde parou.
 */
export function footballDataSyncedHandler(deps: {
  ae?: AnalyticsEngineDataset
  now?: number
}): SyncedHandler {
  return async (item, result, budget) => {
    const competitionId = result?.competitionId || item.competitionId
    if (competitionId) {
      const scoring = await scoreWithinBudget(
        competitionId,
        budget,
        item.kind === 'discovery' ? RECONCILE_CALLS : 0,
      )
      if (scoring) return scoring
    }
    if (item.kind === 'discovery') {
      const advanced = await advanceCompetitionStatus(
        budget.db,
        deps.ae,
        competitionId,
        deps.now ?? Date.now(),
        result?.discardedTbd ?? 0,
      )
      if (!advanced) return { error: 'status não avançou', silent: true }
    }
  }
}

/**
 * Pontua a competição com o saldo do item, menos `reserved` chamadas que o
 * pós-sync ainda vai gastar. Devolve o que o pós-sync deve registrar quando a
 * pontuação não terminou ou falhou, e `undefined` quando terminou. Compartilhada
 * com o dreno da ESPN.
 */
export async function scoreWithinBudget(
  competitionId: string,
  budget: ItemBudget,
  reserved = 0,
): Promise<{ error?: string; incomplete?: boolean } | undefined> {
  try {
    const outcome = await scoreUnprocessedMatches(
      competitionId,
      budget.db,
      Math.max(0, budget.callsLeft() - reserved),
    )
    return outcome.complete ? undefined : { incomplete: true }
  } catch (err) {
    if (err instanceof CallBudgetExhaustedError) return { incomplete: true }
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Registra o pós-sync que falhou. Falha do pós-sync não repete o item, mas não
 * pode sumir. `provider` entra na mensagem (o dreno da ESPN o informa).
 */
export function logPostSyncFailures(
  ae: AnalyticsEngineDataset | undefined,
  run: DrainRun,
  provider = '',
): number {
  const failures = run.outcomes.filter((outcome) => outcome.status === 'done' && outcome.postError)
  for (const outcome of failures) {
    if (outcome.status !== 'done' || outcome.postSilent) continue
    // A telemetria que falha não derruba o dreno depois do trabalho feito.
    tryLogError(
      ae,
      'football_api_error',
      `[drain] Pós-sync${provider ? ` da ${provider}` : ''} falhou item=${outcome.item.kind}/${outcome.item.competitionCode}:`,
      outcome.postError,
      { blobs: ['drain_post_sync'] },
    )
  }
  return failures.length
}

/**
 * Dreno da football-data para o coordenador (`runProviderDrains`): retoma o
 * trabalho pendente entre os ticks, na ordem de prioridade (resultado,
 * varredura e manual, depois descoberta), dentro da fatia de subrequests que o
 * coordenador entrega. Cada passada registra `provider_work_run`.
 */
export function footballDataDrain(deps: {
  apiKey: string
  ae?: AnalyticsEngineDataset
  now?: number
}): ProviderDrain {
  return {
    provider: 'football-data',
    minCalls: CYCLE_FIXED_CALLS + footballDataMinItemCalls(),
    queue: {},
    run: (budget) => drainFootballDataWork(budget, deps),
  }
}

async function drainFootballDataWork(
  budget: DrainBudget,
  deps: { apiKey: string; ae?: AnalyticsEngineDataset; now?: number },
): Promise<DrainRun> {
  const { ae } = deps
  const now = deps.now ?? Date.now()
  const startedAt = Date.now()
  // Um saldo de `match_missing_from_feed` por execução do dreno, dividido entre
  // as descobertas; os demais itens não registram (só a descoberta registra).
  const missingEvents = { remaining: MISSING_EVENTS_PER_DISCOVERY }
  const run = await drainProviderWork(budget, {
    provider: 'football-data',
    now,
    runItem: runFootballDataWorkItem({
      apiKey: deps.apiKey,
      ae,
      now,
      extraSyncOptions: (item) => (item.kind === 'discovery' ? { missingEvents } : undefined),
    }),
    onSynced: footballDataSyncedHandler({ ae, now }),
    itemCost: footballDataItemCost,
    costClass: footballDataCostClass,
    minItemCost: footballDataMinItemCalls(),
  })
  const postFailures = logPostSyncFailures(ae, run)
  // A gravação do estado que falhou (`settleError`) também marca a execução com erro.
  const failed = run.failed > 0 || postFailures > 0 || run.settleError !== undefined
  tryLogEvent(ae, 'provider_work_run', {
    blobs: [failed ? 'error' : 'ok', 'football-data'],
    doubles: [
      run.claimed,
      run.done,
      run.requeued,
      run.failed,
      Date.now() - startedAt,
      run.released,
      budget.used,
    ],
  })
  return run
}
