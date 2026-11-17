import type { D1Database } from '@cloudflare/workers-types'
import { tryLogEvent } from '../observability/events'
import { createProviderHttpObserver } from '../observability/providerHttp'
import { CallBudgetExhaustedError } from './callBudget'
import { CYCLE_FIXED_CALLS, type DrainBudget, type ItemBudget } from './drainBudget'
import type { ProviderDrain } from './drainCoordinator'
import { ESPN_REQUEST_CALLS, isEspnRefusal } from './espnAccess'
import { ESPN_MAX_CONCURRENT_COMPETITIONS } from './espnQuota'
import { espnWriteCalls } from './espnSync'
import { httpContextOf, logPostSyncFailures, scoreWithinBudget } from './fdWork'
import { readProviderState } from './providerBudget'
import {
  deferProviderWork,
  drainProviderWork,
  type DrainRun,
  type NewWorkItem,
  type ProviderWorkItem,
  type ProviderWorkKind,
  type SyncedHandler,
  type WorkOutcome,
} from './providerWork'
import { MIN_SCORING_CALLS } from './scoring'
import { syncFixtures } from './sync'

/**
 * Liga a fila durável de trabalho à sync da ESPN (ADR-027, adendo do ticket
 * 03). Na ESPN um item é uma data do scoreboard de uma competição
 * (`round = YYYYMMDD`; vazio busca a rodada corrente): é a unidade que o
 * provedor entrega ou recusa, então a falha de uma data não refaz as outras.
 * O dreno entra na lista do coordenador (`runProviderDrains`), no mesmo trigger
 * e nos mesmos minutos da football-data, e retoma o que ficou pendente por
 * orçamento, bloqueio, falha parcial ou reinício, dentro da fatia de
 * subrequests da invocação.
 *
 * A fila guarda a tentativa de coletar, não o resultado: um item concluído
 * diz que o scoreboard daquela data foi consultado e gravado. Quem decide se
 * uma partida terminou é o estado dela no D1 (o poller replaneja a janela a
 * cada tick). Data sem evento não encerra nem cancela nada — a coleta só grava
 * o que o evento diz.
 */

export type EspnWorkBase = {
  kind: ProviderWorkKind
  /** Slug da ESPN (`competitions.external_id`). */
  competitionCode: string
  season: string
  competitionId: string
}

/** Um item por data (ou um item de rodada corrente quando não há datas). */
export function espnWorkItems(base: EspnWorkBase, dates: string[] | undefined): NewWorkItem[] {
  const unique = Array.from(new Set((dates ?? []).filter(Boolean)))
  const rounds = unique.length > 0 ? unique : ['']
  return rounds.map((round) => ({ provider: 'espn', ...base, round }))
}

/**
 * Adia as datas que a ESPN não entregou: viram itens pendentes, com o prazo que
 * o erro informa (bloqueio, orçamento) ou a espera conservadora.
 */
export async function deferEspnWork(
  db: D1Database,
  base: EspnWorkBase,
  dates: string[] | undefined,
  error: unknown,
  now = Date.now(),
): Promise<void> {
  await deferProviderWork(db, espnWorkItems(base, dates), error, now)
}

/**
 * Custo estimado de um item da ESPN, em chamadas (D1 e `fetch`), que o dreno
 * confere contra o saldo antes de começar o item. É o piso: o maior custo real
 * visto numa classe do dreno só o sobe nos itens seguintes. `espnWork.test.ts`
 * mede cada classe e falha se o custo real passar da estimativa.
 *
 * - requisição: reservar a vaga, o `fetch` e registrar a resposta
 *   (`ESPN_REQUEST_CALLS`, 3). Um 5xx com retry soma mais 3 e fica fora: se o
 *   saldo não cobrir a segunda tentativa, o item volta à fila sem tentativa;
 * - gravação da data: `espnWriteCalls` (6 para uma data de liga, de até 100
 *   jogos e 100 times), só quando a data traz eventos;
 * - pontuação do sync manual e da descoberta: o mínimo para planejar e gravar
 *   uma vez (`MIN_SCORING_CALLS`), o resto retoma no tick seguinte. O status da
 *   competição não avança aqui, ao contrário da football-data: depende da
 *   descoberta completa, que só o produtor vê.
 */
const DATE_EVENTS = 20
const DATE_TEAMS = 40

export function espnItemCost(item: ProviderWorkItem): number {
  const sync = ESPN_REQUEST_CALLS + espnWriteCalls(DATE_EVENTS, DATE_TEAMS)
  return item.kind === 'manual' || item.kind === 'discovery' ? sync + MIN_SCORING_CALLS : sync
}

/** O item mais barato da ESPN: um `result` ou `late` de uma data. */
export function espnMinItemCalls(): number {
  return ESPN_REQUEST_CALLS + espnWriteCalls(DATE_EVENTS, DATE_TEAMS)
}

/**
 * Como o item volta à fila depois de um erro, sem tocar nela. Falta de saldo de
 * subrequests não é falha do provedor: propaga, e o dreno devolve o item sem
 * tentativa. Recusa do orçamento, bloqueio ou suspensão valem para o provedor
 * inteiro (`providerBlocked`): o dreno encerra sem tentar os itens seguintes.
 */
function outcomeOfError(item: ProviderWorkItem, error: unknown): WorkOutcome {
  if (error instanceof CallBudgetExhaustedError) throw error
  if (isEspnRefusal(error)) {
    return {
      item,
      status: 'requeued',
      notBefore: error.retryAt,
      error: error.message,
      providerBlocked: true,
    }
  }
  return { item, status: 'retry', error: error instanceof Error ? error.message : String(error) }
}

export type EspnWorkDeps = {
  ae?: AnalyticsEngineDataset
}

/**
 * Executa um item reclamado: um sync da ESPN para a data, com o orçamento
 * compartilhado ligado e as chamadas pagas do saldo do item. Recusa do
 * orçamento, bloqueio ou suspensão devolvem o item à fila sem contar tentativa
 * (o provedor não foi chamado, ou proibiu o acesso). Timeout, 5xx e resposta
 * incompleta contam tentativa, até o teto.
 */
export function runEspnWorkItem(
  deps: EspnWorkDeps,
): (item: ProviderWorkItem, budget: ItemBudget) => Promise<WorkOutcome> {
  return async (item, budget) => {
    try {
      const result = await syncFixtures({
        competitionCode: item.competitionCode,
        season: Number(item.season),
        dates: item.round === '' ? undefined : [item.round],
        db: budget.db,
        coordinate: true,
        callGate: budget,
        onHttpAttempt: createProviderHttpObserver(deps.ae, {
          context: httpContextOf(item.kind),
          competitionId: item.competitionId,
        }),
        ae: deps.ae,
      })
      if (result.pending) return outcomeOfError(item, result.pending.error)
      return { item, status: 'done', result }
    } catch (error) {
      return outcomeOfError(item, error)
    }
  }
}

/**
 * Pós-sync: o sync administrativo e a descoberta repontuam os jogos que o sync
 * deixou encerrados sem `scored_at`, com o saldo que sobra ao item. Pontuação
 * que não termina devolve o item sem tentativa, e o dreno seguinte retoma. O
 * status da competição não avança aqui: um item cobre uma data, e o status
 * depende da descoberta completa (jogos futuros, times a definir), que só o
 * produtor vê. Resultado do poller é pontuado no tick seguinte, que lê as
 * pendências no D1.
 */
export function espnSyncedHandler(): SyncedHandler {
  return async (item, result, budget) => {
    if (item.kind !== 'manual' && item.kind !== 'discovery') return
    const competitionId = result?.competitionId || item.competitionId
    if (!competitionId) return
    return scoreWithinBudget(competitionId, budget)
  }
}

/**
 * Dreno da ESPN para o coordenador (`runProviderDrains`): retoma o trabalho
 * pendente entre os ticks, na ordem de prioridade, dentro da fatia de
 * subrequests que o coordenador entrega. É a única linha que a ESPN acrescenta à
 * lista do `scheduled`: o orçamento é o do coordenador, não um segundo.
 */
export function espnDrain(deps: { ae?: AnalyticsEngineDataset; now?: number }): ProviderDrain {
  return {
    provider: 'espn',
    minCalls: CYCLE_FIXED_CALLS + espnMinItemCalls(),
    run: (budget) => drainEspnWork(budget, deps),
  }
}

/**
 * Com o provedor suspenso ou bloqueado o dreno nem reclama os itens: a própria
 * reclamação recusa (`respectProviderAccess`), então eles ficam pendentes, sem
 * escrita no D1, até o bloqueio vencer ou o operador retomar, e a leitura do
 * estado (1 chamada da fatia) só acontece quando a reclamação veio vazia, para
 * dizer ao operador por que. Num tick com trabalho a ESPN não paga essa leitura.
 * Só registra `provider_work_run` quando reclamou itens ou quando saiu
 * bloqueada/suspensa.
 */
async function drainEspnWork(
  budget: DrainBudget,
  deps: { ae?: AnalyticsEngineDataset; now?: number },
): Promise<DrainRun> {
  const { ae } = deps
  const now = deps.now ?? Date.now()
  const startedAt = Date.now()
  const run = await drainProviderWork(budget, {
    provider: 'espn',
    now,
    concurrency: ESPN_MAX_CONCURRENT_COMPETITIONS,
    respectProviderAccess: true,
    runItem: runEspnWorkItem({ ae }),
    onSynced: espnSyncedHandler(),
    itemCost: espnItemCost,
    minItemCost: espnMinItemCalls(),
  })
  const postFailures = logPostSyncFailures(ae, run, 'ESPN')
  if (run.claimed === 0) {
    // Sem saldo para um item não é fila parada: só a reclamação vazia pode ser acesso pausado.
    if (run.stoppedBy !== 'budget') await reportPausedAccess(budget, ae, now)
    return run
  }
  // A gravação do estado que falhou (`settleError`) também marca a execução com erro.
  const failed = run.failed > 0 || postFailures > 0 || run.settleError !== undefined
  tryLogEvent(ae, 'provider_work_run', {
    blobs: [failed ? 'error' : 'ok', 'espn'],
    // claimed, done, requeued, failed, duration_ms, released, calls_used
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

/**
 * A reclamação veio vazia: se foi porque o provedor está bloqueado ou suspenso,
 * registra o motivo (o sinal de que a coleta parada espera o operador ou o
 * prazo). Fila vazia não registra nada. A leitura falha em silêncio: é só o aviso.
 */
async function reportPausedAccess(
  budget: DrainBudget,
  ae: AnalyticsEngineDataset | undefined,
  now: number,
): Promise<void> {
  try {
    const state = await readProviderState(budget.db, 'espn')
    const suspended = state?.suspendedAt != null
    if (!suspended && (state?.blockedUntil ?? 0) <= now) return
    const status = suspended ? 'suspended' : 'blocked'
    console.info(`[drain] ESPN ${status}: nenhum item reclamado.`)
    tryLogEvent(ae, 'provider_work_run', {
      blobs: [status, 'espn'],
      doubles: [0, 0, 0, 0, 0, 0, budget.used],
    })
  } catch (err) {
    console.error('[drain] Falha ao ler o estado de acesso da ESPN:', err)
  }
}
