import type { D1Database } from '@cloudflare/workers-types'
import { runWithConcurrency } from '../concurrency'
import { FD_MAX_CONCURRENT_REQUESTS, FootballDataQuotaError } from './footballDataQuota'
import type { SyncResult } from './matchUpsert'

/**
 * Fila durável de trabalho pendente dos provedores (ADR-027).
 *
 * Os produtores (poller, descoberta diária, sync administrativo) gravam em
 * `provider_work` o que não coube no orçamento compartilhado ou que falhou,
 * com prioridade, tentativas e prazo de nova execução. O dreno retoma depois —
 * no mesmo tick, no tick seguinte ou no cron drenador — inclusive muito depois
 * da janela de 24 horas do resgate. Uma linha por chave de deduplicação
 * (provedor, tipo, competição, temporada, rodada): concluída ou falha, a linha
 * é reusada pelo próximo planejamento, então a tabela cresce com rodadas, não
 * com execuções.
 *
 * O dreno é genérico: quem executa o item (`runItem`) e o pós-sync
 * (`onSynced`) vêm de fora, porque o poller, a descoberta e o cron drenador
 * fazem o mesmo dreno com callbacks próprios.
 */

/** Tipos de trabalho. Menor prioridade executa antes. */
export type ProviderWorkKind = 'result' | 'late' | 'manual' | 'discovery'

export const WORK_PRIORITY: Record<ProviderWorkKind, number> = {
  result: 0,
  late: 1,
  manual: 1,
  discovery: 2,
}

/** Tentativas de execução antes do item falhar de vez (o produtor revive). */
export const WORK_MAX_ATTEMPTS = 6

/** Espera antes de retomar uma execução que falhou de verdade. */
export const WORK_RETRY_DELAY_MS = 60_000

/**
 * Espera antes de retomar quem ficou sem vaga no orçamento: uma janela inteira.
 * Não conta tentativa: o provedor não foi chamado.
 */
export const WORK_BUSY_RETRY_MS = 60_000

/** Validade do lease de execução: o dreno retoma o que passou dele. */
export const WORK_LEASE_MS = 5 * 60_000

/** Syncs de um dreno em voo (o mesmo teto do poller). */
export const DRAIN_CONCURRENCY = FD_MAX_CONCURRENT_REQUESTS

/** Itens reclamados por ciclo do dreno. */
export const DRAIN_MAX_ITEMS = 16

/** Ciclos do dreno por execução. */
export const DRAIN_MAX_CYCLES = 4

export type ProviderWorkItem = {
  kind: ProviderWorkKind
  competitionCode: string
  season: string
  /** Rodada football-data; vazio quando o sync busca a temporada inteira. */
  round: string
  /** Id interno da competição no D1, para a telemetria; vazio quando o produtor não o sabe. */
  competitionId: string
  attempts: number
}

export type NewWorkItem = {
  kind: ProviderWorkKind
  competitionCode: string
  season: string
  round: string
  competitionId?: string
  /** Prazo de retomada quando o produtor adia por orçamento ou cota. */
  notBefore?: number
  /** Falha que motivou o adiamento, para o painel do operador. */
  lastError?: string
}

/** Resultado de um item drenado, antes da gravação do estado na fila. */
export type WorkOutcome =
  | {
      item: ProviderWorkItem
      status: 'done'
      result?: SyncResult
      /** Falha do pós-sync que o item não repete: concluído, com erro no painel. */
      postError?: string
      /** Falha de pós-sync que já tem evento próprio e não vira erro do sync. */
      postSilent?: boolean
    }
  /**
   * De volta à fila sem tentativa nova do provedor: sem vaga no orçamento ou
   * pausa de cota vigente. `notBefore` é o prazo de retomada.
   */
  | { item: ProviderWorkItem; status: 'requeued'; notBefore: number; error: string }
  /** Execução que falhou de verdade: conta tentativa, até o teto. */
  | { item: ProviderWorkItem; status: 'retry'; error: string }

/** Total de um dreno, com os resultados de cada item reclamado. */
export type DrainRun = {
  claimed: number
  done: number
  requeued: number
  failed: number
  outcomes: WorkOutcome[]
}

/**
 * O que o pós-sync acrescentou ao resultado do item. `error` registra a falha
 * no painel como erro do sync; `silent` marca uma falha que já tem evento
 * próprio (`competition_status_error`) e não vira `football_api_error`.
 */
export type SyncedOutcome = { error?: string; silent?: boolean }

export type SyncedHandler = (
  item: ProviderWorkItem,
  result?: SyncResult,
) => Promise<SyncedOutcome | void>

const WORK_KEY_SQL =
  'provider = ?1 AND kind = ?2 AND competition_code = ?3 AND season = ?4 AND round = ?5'

/**
 * Grava itens na fila, deduplicados pela chave. Item `pending`/`running` fica
 * como está (a execução em curso o resolve); `done`/`failed` volta a pendente
 * com as tentativas zeradas: é um novo planejamento do mesmo trabalho.
 */
export async function enqueueProviderWork(
  db: D1Database,
  items: NewWorkItem[],
  now = Date.now(),
): Promise<void> {
  if (items.length === 0) return
  await db.batch(
    items.map((item) =>
      db
        .prepare(
          `INSERT INTO provider_work
             (provider, kind, competition_code, competition_id, season, round, priority,
              status, attempts, not_before, lease_until, last_error, created_at, updated_at)
           VALUES ('football-data', ?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7, 0, ?9, ?8, ?8)
           ON CONFLICT (provider, kind, competition_code, season, round) DO UPDATE SET
             status = 'pending',
             attempts = 0,
             not_before = excluded.not_before,
             lease_until = 0,
             lease_owner = NULL,
             last_error = excluded.last_error,
             priority = excluded.priority,
             competition_id = CASE WHEN excluded.competition_id != ''
                                   THEN excluded.competition_id
                                   ELSE provider_work.competition_id END,
             updated_at = excluded.updated_at
           WHERE provider_work.status IN ('done', 'failed')`,
        )
        .bind(
          item.kind,
          item.competitionCode,
          item.competitionId ?? '',
          item.season,
          item.round,
          WORK_PRIORITY[item.kind],
          item.notBefore ?? 0,
          now,
          item.lastError ?? null,
        ),
    ),
  )
}

/**
 * Adia um sync direto que o orçamento ou a cota recusaram: o trabalho vira item
 * pendente da fila, para o dreno retomar. Falha de cota retoma no reset que a
 * resposta informou; sem vaga, depois de uma janela. Falhas de verdade (rede,
 * 5xx, gravação) seguem o mesmo caminho, com o prazo padrão.
 */
export async function deferProviderWork(
  db: D1Database,
  item: NewWorkItem,
  error: unknown,
  now = Date.now(),
): Promise<void> {
  const notBefore =
    error instanceof FootballDataQuotaError ? error.retryAt : now + WORK_BUSY_RETRY_MS
  await enqueueProviderWork(
    db,
    [
      {
        ...item,
        notBefore,
        lastError: error instanceof Error ? error.message : String(error),
      },
    ],
    now,
  )
}

type ClaimedRow = {
  kind: ProviderWorkKind
  competition_code: string
  competition_id: string
  season: string
  round: string
  attempts: number
}

/**
 * Reclama itens prontos para executar: `pending`, ou `running` com lease
 * vencido (o isolate que morreu com o item na mão). Um único UPDATE com
 * `RETURNING`: o D1 serializa escritas, então dois drenos nunca executam o
 * mesmo item — quem chega depois o vê `running` com lease fresco. `rowid`
 * desempata pela ordem em que o trabalho entrou na fila.
 */
export async function claimProviderWork(
  db: D1Database,
  opts: { provider: string; limit?: number; now?: number },
): Promise<ProviderWorkItem[]> {
  const now = opts.now ?? Date.now()
  const { results } = await db
    .prepare(
      `UPDATE provider_work
          SET status = 'running', lease_until = ?1, lease_owner = ?2, updated_at = ?3
        WHERE rowid IN (
          SELECT rowid FROM provider_work
           WHERE provider = ?4
             AND not_before <= ?3
             AND (status = 'pending' OR (status = 'running' AND lease_until < ?3))
           ORDER BY priority, created_at, rowid
           LIMIT ?5)
       RETURNING kind, competition_code, competition_id, season, round, attempts`,
    )
    .bind(
      now + WORK_LEASE_MS,
      crypto.randomUUID(),
      now,
      opts.provider,
      opts.limit ?? DRAIN_MAX_ITEMS,
    )
    .all<ClaimedRow>()
  return results.map((row) => ({
    kind: row.kind,
    competitionCode: row.competition_code,
    competitionId: row.competition_id,
    season: row.season,
    round: row.round,
    attempts: row.attempts,
  }))
}

async function completeWork(db: D1Database, item: ProviderWorkItem, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_work
          SET status = 'done', last_error = NULL, updated_at = ?6
        WHERE ${WORK_KEY_SQL}`,
    )
    .bind('football-data', item.kind, item.competitionCode, item.season, item.round, now)
    .run()
}

/**
 * Devolve o item à fila com o prazo e as tentativas dados, ou o marca falhado
 * quando as tentativas chegam ao teto. Solta o lease de todo jeito.
 */
async function requeueWork(
  db: D1Database,
  item: ProviderWorkItem,
  opts: { attempts: number; notBefore: number; error: string; now: number },
): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_work
          SET status = CASE WHEN ?6 >= ?7 THEN 'failed' ELSE 'pending' END,
              attempts = ?6, not_before = ?8, last_error = ?9,
              lease_until = 0, lease_owner = NULL, updated_at = ?10
        WHERE ${WORK_KEY_SQL}`,
    )
    .bind(
      'football-data',
      item.kind,
      item.competitionCode,
      item.season,
      item.round,
      opts.attempts,
      WORK_MAX_ATTEMPTS,
      opts.notBefore,
      opts.error,
      opts.now,
    )
    .run()
}

export type DrainOptions = {
  provider: string
  now?: number
  /** Executa um item reclamado e devolve o resultado sem tocar na fila. */
  runItem: (item: ProviderWorkItem) => Promise<WorkOutcome>
  /** Pós-sync de um item concluído; falha dele não repete o sync. */
  onSynced?: SyncedHandler
  maxCycles?: number
  maxItems?: number
}

/**
 * Drena a fila: reclama itens por prioridade, executa com o teto de syncs em
 * voo e grava o estado de cada um. Um ciclo só continua quando a reclamação
 * veio cheia (podem haver mais itens) ou quando algo ficou pendente de novo —
 * os prazos de retomada (uma janela, um reset de 429) já afastam o item, e o
 * ciclo seguinte sai sem reclamá-lo.
 */
export async function drainProviderWork(db: D1Database, opts: DrainOptions): Promise<DrainRun> {
  const now = opts.now ?? Date.now()
  const maxItems = opts.maxItems ?? DRAIN_MAX_ITEMS
  const run: DrainRun = { claimed: 0, done: 0, requeued: 0, failed: 0, outcomes: [] }
  const maxCycles = opts.maxCycles ?? DRAIN_MAX_CYCLES
  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const items = await claimProviderWork(db, { provider: opts.provider, now, limit: maxItems })
    if (items.length === 0) break
    run.claimed += items.length
    const outcomes = await runWithConcurrency(DRAIN_CONCURRENCY, items, opts.runItem)
    for (const outcome of outcomes) {
      if (outcome.status === 'done' && opts.onSynced) {
        try {
          const post = await opts.onSynced(outcome.item, outcome.result)
          if (post?.error) outcome.postError = post.error
          if (post?.silent) outcome.postSilent = true
        } catch (err) {
          outcome.postError = err instanceof Error ? err.message : String(err)
        }
      }
      run.outcomes.push(outcome)
      switch (outcome.status) {
        case 'done':
          await completeWork(db, outcome.item, now)
          run.done += 1
          break
        case 'requeued':
          await requeueWork(db, outcome.item, {
            attempts: outcome.item.attempts,
            notBefore: outcome.notBefore,
            error: outcome.error,
            now,
          })
          run.requeued += 1
          break
        case 'retry': {
          const attempts = outcome.item.attempts + 1
          if (attempts >= WORK_MAX_ATTEMPTS) run.failed += 1
          await requeueWork(db, outcome.item, {
            attempts,
            notBefore: now + WORK_RETRY_DELAY_MS,
            error: outcome.error,
            now,
          })
          break
        }
      }
    }
    if (items.length < maxItems && !outcomes.some((outcome) => outcome.status === 'requeued')) {
      break
    }
  }
  return run
}
