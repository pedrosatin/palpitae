import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { runWithConcurrency } from '../concurrency'
import { CallBudgetExhaustedError } from './callBudget'
import type { DrainBudget, ItemBudget } from './drainBudget'
import { FD_MAX_CONCURRENT_REQUESTS } from './footballDataQuota'
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
 *
 * Subrequests (ADR-027, adendo "subrequests do dreno"): o dreno roda numa
 * fatia do orçamento da invocação (`DrainBudget`), nunca sem ela. Reclama só o
 * que a fatia comporta, admite cada item pela estimativa de custo dele, grava o
 * estado de todos num único `db.batch()` e devolve à fila, sem tentativa nova,
 * o que não coube.
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
  /**
   * Football-data: a rodada; vazio quando o sync busca a temporada inteira.
   * ESPN: a data do scoreboard (`YYYYMMDD`); vazio busca a rodada corrente.
   */
  round: string
  /** Id interno da competição no D1, para a telemetria; vazio quando o produtor não o sabe. */
  competitionId: string
  attempts: number
  /**
   * Dono do lease que o reclamou (fencing): o estado do item só é gravado
   * enquanto o lease ainda é dele. Um dreno lento, cujo lease venceu e foi
   * reclamado por outro, não fecha nem devolve o item do segundo.
   */
  leaseOwner: string
}

export type NewWorkItem = {
  /** Provedor dono do item; ausente = football-data. */
  provider?: string
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
   * pausa de cota vigente. `notBefore` é o prazo de retomada. `providerBlocked`
   * marca o provedor inteiro sem vaga (a janela é dele, não do item): o dreno
   * encerra sem tentar os itens seguintes, que só gastariam uma reserva recusada
   * cada um.
   */
  | {
      item: ProviderWorkItem
      status: 'requeued'
      notBefore: number
      error: string
      providerBlocked?: boolean
    }
  /** Execução que falhou de verdade: conta tentativa, até o teto. */
  | { item: ProviderWorkItem; status: 'retry'; error: string }

/** Por que o dreno parou antes de esvaziar a fila: falta de saldo ou provedor sem vaga. */
export type DrainStop = 'budget' | 'provider'

/** Total de um dreno, com os resultados de cada item reclamado. */
export type DrainRun = {
  claimed: number
  done: number
  requeued: number
  failed: number
  /** Reclamados e devolvidos sem começar (ou sem terminar), sem tentativa nova. */
  released: number
  /**
   * Itens cujo estado não foi gravado porque o lease venceu e outro dreno os
   * reclamou (fencing). Fora de `done`, `requeued`, `failed` e `released`.
   */
  leaseLost: number
  /** Só `budget` pede mais saldo: com o provedor sem vaga, chamadas a mais não ajudam. */
  stoppedBy?: DrainStop
  /**
   * A gravação do estado falhou duas vezes e só a liberação mínima funcionou: os
   * itens do ciclo voltaram a `pending` sem tentativa (o que tinham concluído
   * roda de novo, idempotente), e o dreno parou. Traz a mensagem da falha.
   */
  settleError?: string
  outcomes: WorkOutcome[]
}

/**
 * O que o pós-sync acrescentou ao resultado do item. `error` registra a falha
 * no painel como erro do sync; `silent` marca uma falha que já tem evento
 * próprio (`competition_status_error`) e não vira `football_api_error`.
 * `incomplete` diz que o saldo acabou no meio do pós-sync (a pontuação, por
 * exemplo): o item volta à fila sem tentativa nova e retoma de onde parou.
 */
export type SyncedOutcome = { error?: string; silent?: boolean; incomplete?: boolean }

export type SyncedHandler = (
  item: ProviderWorkItem,
  result: SyncResult | undefined,
  budget: ItemBudget,
) => Promise<SyncedOutcome | void>

const FOOTBALL_DATA = 'football-data'

const WORK_KEY_SQL =
  'provider = ?1 AND kind = ?2 AND competition_code = ?3 AND season = ?4 AND round = ?5'

/**
 * Grava itens na fila, deduplicados pela chave (o provedor do item, a
 * football-data quando ausente). Item `pending`/`running` fica como está (a
 * execução em curso o resolve); `done`/`failed` volta a pendente com as
 * tentativas zeradas: é um novo planejamento do mesmo trabalho.
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
           VALUES (?10, ?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7, 0, ?9, ?8, ?8)
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
          item.provider ?? FOOTBALL_DATA,
        ),
    ),
  )
}

/**
 * Quando o erro diz até quando esperar (`retryAt`: cota esgotada, pausa por
 * 429 ou 403, coleta suspensa), o prazo de retomada é esse; os demais usam a
 * espera conservadora de uma janela.
 */
function retryAtOf(error: unknown, now: number): number {
  const retryAt = (error as { retryAt?: unknown } | null)?.retryAt
  return typeof retryAt === 'number' ? retryAt : now + WORK_BUSY_RETRY_MS
}

/**
 * Adia um sync direto que o orçamento ou a cota recusaram: o trabalho vira item
 * pendente da fila, para o dreno retomar. Falha de cota ou bloqueio retoma no
 * prazo que o erro informa; sem vaga, depois de uma janela. Falhas de verdade
 * (rede, 5xx, gravação) seguem o mesmo caminho, com o prazo padrão. Aceita
 * vários itens (as datas de um sync da ESPN) no mesmo batch.
 */
export async function deferProviderWork(
  db: D1Database,
  item: NewWorkItem | NewWorkItem[],
  error: unknown,
  now = Date.now(),
): Promise<void> {
  const notBefore = retryAtOf(error, now)
  const lastError = error instanceof Error ? error.message : String(error)
  await enqueueProviderWork(
    db,
    (Array.isArray(item) ? item : [item]).map((one) => ({ ...one, notBefore, lastError })),
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
  priority: number
  created_at: number
  /** Posição na fila: desempata a ordem de chegada. */
  seq: number
}

/**
 * Reclama itens prontos para executar: `pending`, ou `running` com lease
 * vencido (o isolate que morreu com o item na mão). Um único UPDATE com
 * `RETURNING`: o D1 serializa escritas, então dois drenos nunca executam o
 * mesmo item — quem chega depois o vê `running` com lease fresco. `rowid`
 * desempata pela ordem em que o trabalho entrou na fila.
 *
 * `respectProviderAccess` (a ESPN) não reclama nada enquanto o provedor está
 * bloqueado ou suspenso, na própria instrução, sem chamada a mais.
 *
 * O `ORDER BY` do subselect só escolhe quais itens reclamar: a ordem das linhas
 * do `RETURNING` não é garantida. Os itens voltam ordenados por prioridade,
 * `created_at` e `rowid`, como o subselect, porque o dreno os admite no saldo
 * nessa ordem, e uma descoberta inserida antes de um resultado não pode passar
 * à frente dele.
 */
export async function claimProviderWork(
  db: D1Database,
  opts: { provider: string; limit?: number; now?: number; respectProviderAccess?: boolean },
): Promise<ProviderWorkItem[]> {
  const now = opts.now ?? Date.now()
  // Provedor bloqueado ou suspenso pelo controle de acesso (`provider_rate_state`): nada é
  // reclamado, e o item segue `pending`, sem escrita, até o bloqueio vencer ou o operador retomar.
  const accessGuard = opts.respectProviderAccess
    ? `AND NOT EXISTS (SELECT 1 FROM provider_rate_state AS access
                        WHERE access.provider = ?4
                          AND (access.suspended_at IS NOT NULL OR access.blocked_until > ?3))`
    : ''
  // Um dono por reclamação: o estado dos itens só é gravado por quem ainda o é.
  const leaseOwner = crypto.randomUUID()
  const { results } = await db
    .prepare(
      `UPDATE provider_work
          SET status = 'running', lease_until = ?1, lease_owner = ?2, updated_at = ?3
        WHERE rowid IN (
          SELECT rowid FROM provider_work
           WHERE provider = ?4
             AND not_before <= ?3
             AND (status = 'pending' OR (status = 'running' AND lease_until < ?3))
             ${accessGuard}
           ORDER BY priority, created_at, rowid
           LIMIT ?5)
       RETURNING kind, competition_code, competition_id, season, round, attempts,
                 priority, created_at, rowid AS seq`,
    )
    .bind(now + WORK_LEASE_MS, leaseOwner, now, opts.provider, opts.limit ?? DRAIN_MAX_ITEMS)
    .all<ClaimedRow>()
  return results
    .sort((a, b) => a.priority - b.priority || a.created_at - b.created_at || a.seq - b.seq)
    .map((row) => ({
      kind: row.kind,
      competitionCode: row.competition_code,
      competitionId: row.competition_id,
      season: row.season,
      round: row.round,
      attempts: row.attempts,
      leaseOwner,
    }))
}

/** Trabalho de um provedor na fila: o que o dreno reclamaria agora e o que o controle de acesso segura. */
export type ReadyWork = { ready: number; paused: number }

/**
 * Conta, numa consulta só (1 chamada), o trabalho pronto de cada provedor: itens
 * `pending` com o prazo vencido ou `running` com o lease vencido, os mesmos que
 * `claimProviderWork` reclamaria. Nos provedores com `respectProviderAccess` o
 * que o bloqueio ou a suspensão segura sai de `ready` e vai para `paused`. O
 * coordenador dos drenos usa a contagem para repartir o saldo entre quem tem
 * fila (ADR-027, adendo do ticket 03). Provedor sem linha não tem trabalho.
 */
export async function countReadyWork(
  db: D1Database,
  providers: { provider: string; respectProviderAccess?: boolean }[],
  now = Date.now(),
): Promise<Map<string, ReadyWork>> {
  const guarded = providers.filter((p) => p.respectProviderAccess).map((p) => p.provider)
  const { results } = await db
    .prepare(
      `SELECT w.provider AS provider,
              SUM(CASE WHEN s.provider IS NOT NULL
                        AND (s.suspended_at IS NOT NULL OR s.blocked_until > ?1)
                       THEN 0 ELSE 1 END) AS ready,
              SUM(CASE WHEN s.provider IS NOT NULL
                        AND (s.suspended_at IS NOT NULL OR s.blocked_until > ?1)
                       THEN 1 ELSE 0 END) AS paused
         FROM provider_work AS w
         LEFT JOIN provider_rate_state AS s
                ON s.provider = w.provider
               AND w.provider IN (SELECT value FROM json_each(?3))
        WHERE w.provider IN (SELECT value FROM json_each(?2))
          AND w.not_before <= ?1
          AND (w.status = 'pending' OR (w.status = 'running' AND w.lease_until < ?1))
        GROUP BY w.provider`,
    )
    .bind(now, JSON.stringify(providers.map((p) => p.provider)), JSON.stringify(guarded))
    .all<{ provider: string; ready: number; paused: number }>()
  return new Map(results.map((row) => [row.provider, { ready: row.ready, paused: row.paused }]))
}

/**
 * Fencing: o estado de um item só é gravado se ele segue `running` com o dono
 * que o reclamou. O lease de 5 min vence, e um dreno lento que volta depois de
 * outro ter reclamado o item não o fecha nem o devolve: a instrução não altera
 * linha nenhuma, e o chamador vê `changes = 0` no resultado do batch.
 */
const leaseFence = (param: number) => `status = 'running' AND lease_owner = ?${param}`

function completeStatement(
  db: D1Database,
  provider: string,
  item: ProviderWorkItem,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE provider_work
          SET status = 'done', last_error = NULL, lease_until = 0, lease_owner = NULL,
              updated_at = ?6
        WHERE ${WORK_KEY_SQL} AND ${leaseFence(7)}`,
    )
    .bind(provider, item.kind, item.competitionCode, item.season, item.round, now, item.leaseOwner)
}

/**
 * Devolve o item à fila com o prazo e as tentativas dados, ou o marca falhado
 * quando as tentativas chegam ao teto. Solta o lease, desde que ainda seja de
 * quem executou o item.
 */
function requeueStatement(
  db: D1Database,
  provider: string,
  item: ProviderWorkItem,
  opts: { attempts: number; notBefore: number; error: string; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE provider_work
          SET status = CASE WHEN ?6 >= ?7 THEN 'failed' ELSE 'pending' END,
              attempts = ?6, not_before = ?8, last_error = ?9,
              lease_until = 0, lease_owner = NULL, updated_at = ?10
        WHERE ${WORK_KEY_SQL} AND ${leaseFence(11)}`,
    )
    .bind(
      provider,
      item.kind,
      item.competitionCode,
      item.season,
      item.round,
      opts.attempts,
      WORK_MAX_ATTEMPTS,
      opts.notBefore,
      opts.error,
      opts.now,
      item.leaseOwner,
    )
}

/**
 * Devolve à fila um item reclamado que o saldo não deixou começar: volta a
 * `pending` e solta o lease, sem mexer em tentativas, prazo nem último erro. O
 * provedor não foi chamado, então o item não falhou; o próximo dreno o reclama.
 */
function releaseStatement(
  db: D1Database,
  provider: string,
  item: ProviderWorkItem,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE provider_work
          SET status = 'pending', lease_until = 0, lease_owner = NULL, updated_at = ?6
        WHERE ${WORK_KEY_SQL} AND ${leaseFence(7)}`,
    )
    .bind(provider, item.kind, item.competitionCode, item.season, item.round, now, item.leaseOwner)
}

export type DrainOptions = {
  provider: string
  now?: number
  /**
   * Executa um item reclamado e devolve o resultado sem tocar na fila. Usa o D1
   * e o `fetch` do `budget` do item, que recusam o que passaria do saldo; quem
   * captura erros não pode engolir `CallBudgetExhaustedError` (o item volta à
   * fila sem tentativa nova).
   */
  runItem: (item: ProviderWorkItem, budget: ItemBudget) => Promise<WorkOutcome>
  /** Pós-sync de um item concluído; falha dele não repete o sync. */
  onSynced?: SyncedHandler
  /** Estimativa conservadora do custo de um item, em chamadas (D1 e `fetch`). */
  itemCost: (item: ProviderWorkItem) => number
  /**
   * Classe de custo do item (padrão: o tipo). O maior custo real visto num item
   * concluído da classe, neste dreno, sobe a estimativa dos seguintes da mesma
   * classe. Nunca a baixa: a estimativa estática é o piso, porque um item barato
   * (poucos jogos) não diz que o próximo também será.
   */
  costClass?: (item: ProviderWorkItem) => string
  /** O menor `itemCost` possível: dimensiona quantos itens reclamar de uma vez. */
  minItemCost: number
  /** Itens em execução ao mesmo tempo; padrão `DRAIN_CONCURRENCY`. */
  concurrency?: number
  /** Não reclama itens enquanto o provedor está bloqueado ou suspenso (ver `claimProviderWork`). */
  respectProviderAccess?: boolean
  maxCycles?: number
  maxItems?: number
}

/** O que um ciclo reclamou, executou e devolveu, antes da gravação do estado. */
type CycleResult = {
  outcomes: WorkOutcome[]
  released: ProviderWorkItem[]
  halt?: DrainStop
  /** Falha da gravação do estado que só a liberação mínima contornou. */
  settleError?: string
  /**
   * Com `settleError`: quantos itens do ciclo a liberação mínima devolveu a
   * `pending` (as linhas que o `UPDATE` alterou). Os demais já eram de outro dreno.
   */
  recovered?: number
  /**
   * Itens cujo estado o batch não gravou porque o lease deles já era de outro
   * dreno (fencing): o outro é quem os resolve.
   */
  lost: ProviderWorkItem[]
}

/** Maior custo real, por classe de custo, dos itens concluídos neste dreno. Só sobe a estimativa. */
type ObservedCosts = Map<string, number>

type CycleContext = {
  budget: DrainBudget
  opts: DrainOptions
  now: number
  cycle: CycleResult
  observed: ObservedCosts
}

/**
 * Pós-sync de um item concluído. O saldo que acaba aqui devolve o item para
 * retomar sem tentativa nova; qualquer outra falha só marca o item concluído
 * com o erro.
 */
async function applyPostSync(
  ctx: CycleContext,
  outcome: Extract<WorkOutcome, { status: 'done' }>,
  span: ItemBudget,
): Promise<WorkOutcome> {
  const resume = (): WorkOutcome => {
    ctx.cycle.halt ??= 'budget'
    return {
      item: outcome.item,
      status: 'requeued',
      notBefore: ctx.now,
      error: 'saldo de chamadas esgotado no pós-sync; retoma do ponto em que parou',
    }
  }
  try {
    const post = await ctx.opts.onSynced?.(outcome.item, outcome.result, span)
    if (post?.incomplete) return resume()
    if (post?.error) outcome.postError = post.error
    if (post?.silent) outcome.postSilent = true
  } catch (err) {
    if (err instanceof CallBudgetExhaustedError) return resume()
    outcome.postError = err instanceof Error ? err.message : String(err)
  }
  return outcome
}

/**
 * Admite o item no saldo: reserva a estimativa dele. Sem saldo livre, espera um
 * item em voo terminar, que devolve o que reservou e não gastou, e tenta de novo;
 * sem nenhum em voo, o que falta não cabe mais neste dreno e ele encerra. Também
 * devolve `undefined` quando o dreno já encerrou (outro item viu o provedor sem
 * vaga ou o saldo acabar).
 */
async function admit(
  ctx: CycleContext,
  item: ProviderWorkItem,
  costClass: string,
): Promise<ItemBudget | undefined> {
  while (!ctx.cycle.halt) {
    const estimate = Math.max(ctx.opts.itemCost(item), ctx.observed.get(costClass) ?? 0)
    const span = ctx.budget.open(estimate)
    if (span) return span
    if (!ctx.budget.hasInFlight()) {
      ctx.cycle.halt = 'budget'
      return undefined
    }
    await ctx.budget.nextRelease()
  }
  return undefined
}

/**
 * Executa um item dentro do saldo. Sem saldo para a estimativa dele, ou com o
 * provedor sem vaga, o item volta à fila sem começar. O maior custo real de item
 * concluído sobe a estimativa dos seguintes da mesma classe.
 */
async function executeItem(ctx: CycleContext, item: ProviderWorkItem): Promise<void> {
  const { cycle, observed } = ctx
  const costClass = ctx.opts.costClass?.(item) ?? item.kind
  const span = await admit(ctx, item, costClass)
  if (!span) {
    cycle.released.push(item)
    return
  }
  try {
    let outcome = await ctx.opts.runItem(item, span)
    if (outcome.status === 'done') outcome = await applyPostSync(ctx, outcome, span)
    if (outcome.status === 'done') {
      observed.set(costClass, Math.max(observed.get(costClass) ?? 0, span.used()))
    }
    if (outcome.status === 'requeued' && outcome.providerBlocked) cycle.halt ??= 'provider'
    cycle.outcomes.push(outcome)
  } catch (err) {
    if (err instanceof CallBudgetExhaustedError) {
      cycle.halt ??= 'budget'
      cycle.released.push(item)
    } else {
      cycle.outcomes.push({
        item,
        status: 'retry',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  } finally {
    span.close()
  }
}

/**
 * Instrução de estado de cada resultado do ciclo e de cada item devolvido, e os
 * itens a que elas se referem, na mesma ordem (o resultado do batch é por posição).
 */
function settleStatements(
  db: D1Database,
  provider: string,
  cycle: CycleResult,
  now: number,
): { statements: D1PreparedStatement[]; items: ProviderWorkItem[] } {
  const statements = cycle.outcomes.map((outcome) => {
    switch (outcome.status) {
      case 'done':
        return completeStatement(db, provider, outcome.item, now)
      case 'requeued':
        return requeueStatement(db, provider, outcome.item, {
          attempts: outcome.item.attempts,
          notBefore: outcome.notBefore,
          error: outcome.error,
          now,
        })
      case 'retry':
        return requeueStatement(db, provider, outcome.item, {
          attempts: outcome.item.attempts + 1,
          notBefore: now + WORK_RETRY_DELAY_MS,
          error: outcome.error,
          now,
        })
    }
  })
  for (const item of cycle.released) statements.push(releaseStatement(db, provider, item, now))
  return {
    statements,
    items: [...cycle.outcomes.map((outcome) => outcome.item), ...cycle.released],
  }
}

/**
 * Soma os resultados de um ciclo, já gravados, no total do dreno. O que o
 * fencing recusou (`lost`) não é do dreno: não conta como concluído, devolvido
 * nem falhado, mas o trabalho que o item fez já aconteceu e fica em `outcomes`.
 */
function tally(run: DrainRun, cycle: CycleResult): void {
  const lost = new Set(cycle.lost)
  run.leaseLost += lost.size
  run.released += cycle.released.filter((item) => !lost.has(item)).length
  for (const outcome of cycle.outcomes) {
    run.outcomes.push(outcome)
    if (lost.has(outcome.item)) continue
    if (outcome.status === 'done') run.done += 1
    else if (outcome.status === 'requeued') run.requeued += 1
    else if (outcome.item.attempts + 1 >= WORK_MAX_ATTEMPTS) run.failed += 1
  }
}

/** Espera antes de repetir a gravação do estado: dá tempo de uma falha transitória do D1 passar. */
export const SETTLE_RETRY_MS = 250

/**
 * Liberação mínima: um único `UPDATE` que devolve a `pending`, sem lease e sem
 * mexer em tentativas, prazo nem último erro, os itens `running` do ciclo que
 * ainda têm o lease deste dreno (fencing). Não grava o que o ciclo concluiu,
 * então o item concluído roda de novo (idempotente).
 */
function releaseCycleStatement(
  db: D1Database,
  provider: string,
  items: ProviderWorkItem[],
  now: number,
): D1PreparedStatement {
  const keys = items.map((item) => [
    item.kind,
    item.competitionCode,
    item.season,
    item.round,
    item.leaseOwner,
  ])
  return db
    .prepare(
      `UPDATE provider_work
          SET status = 'pending', lease_until = 0, lease_owner = NULL, updated_at = ?3
        WHERE provider = ?1 AND status = 'running'
          AND EXISTS (SELECT 1 FROM json_each(?2) AS k
                       WHERE json_extract(k.value, '$[0]') = kind
                         AND json_extract(k.value, '$[1]') = competition_code
                         AND json_extract(k.value, '$[2]') = season
                         AND json_extract(k.value, '$[3]') = round
                         AND json_extract(k.value, '$[4]') = lease_owner)`,
    )
    .bind(provider, JSON.stringify(keys), now)
}

/** O lease venceu e outro dreno reclamou o item: o estado dele não foi gravado por este dreno. */
function logLeaseLost(provider: string, item: ProviderWorkItem): void {
  console.warn(
    `[drain] Lease perdido provider=${provider} item=${item.kind}/${item.competitionCode}/${item.round}: o estado não foi gravado, o dreno que o reclamou o resolve.`,
  )
}

/**
 * Grava o estado do ciclo num `db.batch()`, com o fencing por dono do lease em
 * cada instrução (`leaseFence`): o item que outro dreno reclamou depois do
 * vencimento do lease não é tocado, e o resultado do batch o aponta
 * (`cycle.lost`). O fencing protege o estado da fila; o que o item já gravou
 * no calendário e o pós-sync que já rodou antes da gravação não se desfazem.
 *
 * Se o D1 falhar, repete uma vez; se falhar de novo, tenta a liberação mínima,
 * que devolve os itens do ciclo a `pending` sem tentativa e sem lease (também
 * com o fencing). As três chamadas estão reservadas na fatia
 * (`STATE_RESERVE_CALLS`). Registra em `cycle.settleError` a mensagem da falha
 * quando só a liberação funcionou. Se nem ela funcionar, o D1 está indisponível
 * de forma persistente e o erro sobe: os itens ficam `running` até o lease de
 * 5 min vencer, e o dreno seguinte os reclama, sem tentativa gasta a mais.
 */
async function settleCycle(
  budget: DrainBudget,
  provider: string,
  items: ProviderWorkItem[],
  cycle: CycleResult,
  now: number,
): Promise<void> {
  const { statements, items: settled } = settleStatements(budget.db, provider, cycle, now)
  const write = () => budget.db.batch(statements)
  let results: Awaited<ReturnType<typeof write>> | undefined
  try {
    results = await write()
  } catch (err) {
    console.error('[drain] Gravação do estado dos itens falhou, repetindo:', err)
  }
  if (!results) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_RETRY_MS))
    try {
      results = await write()
    } catch (err) {
      console.error('[drain] Gravação do estado falhou de novo, devolvendo os itens à fila:', err)
      const released = await releaseCycleStatement(budget.db, provider, items, now).run()
      cycle.recovered = released.meta?.changes ?? 0
      cycle.settleError = err instanceof Error ? err.message : String(err)
      return
    }
  }
  // Instrução que não alterou linha: o lease já era de outro dreno.
  cycle.lost = settled.filter((_, i) => (results[i]?.meta?.changes ?? 0) === 0)
  for (const item of cycle.lost) logLeaseLost(provider, item)
}

/**
 * Executa os itens reclamados, com o teto de syncs em voo, e grava o estado de
 * todos num único `db.batch()` (reservado na fatia): concluídos, devolvidos por
 * falha, por vaga ou por saldo, e os que não chegaram a começar.
 */
async function runCycle(
  budget: DrainBudget,
  opts: DrainOptions,
  items: ProviderWorkItem[],
  now: number,
  observed: ObservedCosts,
): Promise<CycleResult> {
  const cycle: CycleResult = { outcomes: [], released: [], lost: [] }
  const ctx: CycleContext = { budget, opts, now, cycle, observed }
  await runWithConcurrency(opts.concurrency ?? DRAIN_CONCURRENCY, items, (item) =>
    executeItem(ctx, item),
  )
  await settleCycle(budget, opts.provider, items, cycle, now)
  return cycle
}

/**
 * Drena a fila: reclama itens por prioridade, só quantos a fatia comporta,
 * executa com o teto de syncs em voo e grava o estado de cada um. Um ciclo só
 * continua quando a reclamação veio cheia (pode haver mais itens): os prazos de
 * retomada (uma janela, um reset de 429) já afastam o que ficou pendente, e um
 * ciclo a mais para reclamar nada custaria uma chamada à toa. Para quando o
 * saldo não cobre mais um item (`stoppedBy: 'budget'`), quando o provedor está
 * sem vaga (`'provider'`) ou quando a gravação do estado falha (`settleError`).
 */
export async function drainProviderWork(
  budget: DrainBudget,
  opts: DrainOptions,
): Promise<DrainRun> {
  const now = opts.now ?? Date.now()
  const maxItems = opts.maxItems ?? DRAIN_MAX_ITEMS
  const maxCycles = opts.maxCycles ?? DRAIN_MAX_CYCLES
  const run: DrainRun = {
    claimed: 0,
    done: 0,
    requeued: 0,
    failed: 0,
    released: 0,
    leaseLost: 0,
    outcomes: [],
  }
  const observed: ObservedCosts = new Map()
  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const limit = budget.claimLimit(opts.minItemCost, maxItems)
    if (limit < 1) {
      run.stoppedBy = 'budget'
      break
    }
    const items = await claimProviderWork(budget.db, {
      provider: opts.provider,
      now,
      limit,
      respectProviderAccess: opts.respectProviderAccess,
    })
    if (items.length === 0) break
    run.claimed += items.length
    const result = await runCycle(budget, opts, items, now, observed)
    if (result.settleError !== undefined) {
      // O estado não foi gravado e o D1 está instável: a liberação mínima devolveu a `pending`
      // os itens que ainda eram deste dreno. Os que outro dreno já reclamou (o filtro por dono
      // os preserva) não foram devolvidos por ele e contam como lease perdido.
      const recovered = result.recovered ?? 0
      run.released += recovered
      run.leaseLost += items.length - recovered
      run.settleError = result.settleError
      break
    }
    tally(run, result)
    if (result.halt) {
      run.stoppedBy = result.halt
      break
    }
    if (items.length < limit) break
  }
  return run
}
