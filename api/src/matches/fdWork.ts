import type { D1Database } from '@cloudflare/workers-types'
import { logError, tryLogEvent } from '../observability/events'
import {
  createProviderHttpObserver,
  type ProviderHttpContext,
} from '../observability/providerHttp'
import { reconcileCompetitionStatus } from './competitionLifecycle'
import { FootballDataQuotaError } from './footballDataQuota'
import { FootballDataSlotBusyError } from './providerBudget'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures, type SyncOptions } from './sync'
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
 * descoberta e do sync administrativo e expõe o cron drenador, que retoma
 * entre os ticks o que ficou pendente por orçamento, falha ou reinício.
 */

/** Quem disparou a tentativa, na telemetria por item. */
function httpContextOf(kind: ProviderWorkKind): ProviderHttpContext {
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

export type FdWorkDeps = {
  db: D1Database
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
 * recuperação, falha de gravação) conta tentativa, até o teto da fila.
 */
export function runFootballDataWorkItem(
  deps: FdWorkDeps,
): (item: ProviderWorkItem) => Promise<WorkOutcome> {
  return async (item) => {
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
        db: deps.db,
        coordinate: true,
        onHttpAttempt: observer,
        ae: deps.ae,
        ...deps.extraSyncOptions?.(item),
      })
      return { item, status: 'done', result }
    } catch (err) {
      if (err instanceof FootballDataSlotBusyError) {
        return {
          item,
          status: 'requeued',
          notBefore: (deps.now ?? Date.now()) + WORK_BUSY_RETRY_MS,
          error: err.message,
        }
      }
      if (err instanceof FootballDataQuotaError) {
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
 */
export async function advanceCompetitionStatus(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  competitionId: string,
  now: number,
  tbdDiscarded: number,
): Promise<boolean> {
  try {
    const status = await reconcileCompetitionStatus(db, competitionId, now, tbdDiscarded)
    if (status === 'finished') {
      console.info(`[discovery] Competição ${competitionId} encerrada; sai da descoberta diária.`)
    }
    return true
  } catch (err) {
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
 * Pós-sync fora da janela de resultados: a descoberta repontua os jogos que o
 * sync deixou encerrados sem `scored_at` e avança o status da competição; o
 * sync administrativo repontua. Falha ao repontuar vira erro do sync no
 * resultado do item; falha ao avançar o status fica no evento próprio e só
 * marca a execução com erro. Nada disso repete o sync: o item termina, e o
 * reprocesso é idempotente (upsert sem mudança não grava; `scored_at` não
 * volta).
 */
export function footballDataSyncedHandler(deps: {
  db: D1Database
  ae?: AnalyticsEngineDataset
  now?: number
}): SyncedHandler {
  return async (item, result) => {
    if (item.kind === 'result' || item.kind === 'late') return
    const competitionId = result?.competitionId || item.competitionId
    if (item.kind === 'discovery' || item.kind === 'manual') {
      if (competitionId) {
        try {
          await scoreUnprocessedMatches(competitionId, deps.db)
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      }
    }
    if (item.kind === 'discovery') {
      const advanced = await advanceCompetitionStatus(
        deps.db,
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
 * Cron drenador: retoma o trabalho pendente da football-data entre os ticks,
 * na ordem de prioridade (resultado, varredura e manual, depois descoberta).
 * Falha do D1 no dreno não repete em tempestade: fica no evento e o próximo
 * ciclo tenta de novo.
 */
export async function drainFootballDataWork(
  db: D1Database,
  apiKey: string,
  ae?: AnalyticsEngineDataset,
  now = Date.now(),
): Promise<void> {
  const startedAt = Date.now()
  // Um saldo de `match_missing_from_feed` por execução do dreno, dividido entre
  // as descobertas; os demais itens não registram (só a descoberta registra).
  const missingEvents = { remaining: MISSING_EVENTS_PER_DISCOVERY }
  let run: DrainRun
  try {
    run = await drainProviderWork(db, {
      provider: 'football-data',
      now,
      runItem: runFootballDataWorkItem({
        db,
        apiKey,
        ae,
        now,
        extraSyncOptions: (item) => (item.kind === 'discovery' ? { missingEvents } : undefined),
      }),
      onSynced: footballDataSyncedHandler({ db, ae, now }),
    })
  } catch (err) {
    logError(
      ae,
      'provider_work_run',
      '[drain] Falha ao drenar a fila da football-data:',
      err,
      { blobs: ['error'] },
    )
    return
  }
  // Falha do pós-sync não repete o item (ele já terminou), mas não pode sumir:
  // a execução sai como erro e a falha sem evento próprio vai para o log.
  const postFailures = run.outcomes.filter(
    (outcome) => outcome.status === 'done' && outcome.postError,
  )
  for (const outcome of postFailures) {
    if (outcome.status !== 'done' || outcome.postSilent) continue
    logError(
      ae,
      'football_api_error',
      `[drain] Pós-sync falhou item=${outcome.item.kind}/${outcome.item.competitionCode}:`,
      outcome.postError,
      { blobs: ['drain_post_sync'] },
    )
  }
  tryLogEvent(ae, 'provider_work_run', {
    blobs: [run.failed > 0 || postFailures.length > 0 ? 'error' : 'ok'],
    // claimed, done, requeued, failed, duration_ms
    doubles: [run.claimed, run.done, run.requeued, run.failed, Date.now() - startedAt],
  })
}
