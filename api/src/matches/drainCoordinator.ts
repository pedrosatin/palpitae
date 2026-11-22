import type { D1Database } from '@cloudflare/workers-types'
import { tryLogError } from '../observability/events'
import { DRAIN_CALL_BUDGET, DrainBudget, CYCLE_FIXED_CALLS } from './drainBudget'
import { DRAIN_MAX_ITEMS, countReadyWork, type DrainRun, type ReadyWork } from './providerWork'

/**
 * Coordenador dos drenos do `scheduled` (ADR-027, adendo "subrequests do
 * dreno"): um único orçamento de subrequests para todas as filas de provedores
 * que drenam no mesmo tick.
 *
 * Cada dreno é um `ProviderDrain`. O coordenador reparte o saldo entre eles em
 * fatias que somam no máximo o orçamento, roda os drenos juntos e, com o que
 * sobrou de quem terminou cedo, roda de novo só os que pararam por falta de
 * saldo. Como cada dreno confere apenas a própria fatia, o total fica garantido
 * sem estado compartilhado entre eles. A ESPN entra com uma linha: um
 * `ProviderDrain` a mais na lista que o `scheduled` passa.
 *
 * Quem drena a fila `provider_work` de um provedor (`queue`) é medido antes de
 * repartir: uma consulta só (1 chamada do orçamento) conta o trabalho pronto de
 * cada um. O dreno sem nada pronto não roda, e o saldo dele fica com quem tem
 * fila, em vez de ficar parado numa fatia que ninguém usa e voltar só numa
 * rodada extra, com o custo fixo de outro ciclo (reclamar e gravar o estado).
 * Sem isso, a football-data com a ESPN ociosa concluía 4 itens por tick, e não os
 * 5 que o saldo inteiro comporta. Quem pede menos que a fatia justa recebe o que
 * pede e o resto vai a quem ainda quer mais.
 */

export type ProviderDrain = {
  provider: string
  /**
   * Menor fatia com que o dreno ainda conclui um item (o custo fixo de um ciclo
   * mais o item mais barato). A rodada que reaproveita a sobra não o chama com
   * menos que isso: gastaria um evento e nenhuma chamada útil.
   */
  minCalls?: number
  /**
   * O dreno consome a fila `provider_work` do provedor. O coordenador conta o
   * trabalho pronto dele antes de repartir o saldo (`countReadyWork`); com
   * `respectProviderAccess` o que o bloqueio ou a suspensão segura não conta como
   * pronto (o dreno ainda roda, para avisar o operador, mas pede só a fatia
   * mínima). Dreno sem `queue` sempre roda e pede o que sobrar.
   */
  queue?: { respectProviderAccess?: boolean }
  /**
   * Drena a fila dentro da fatia recebida. Todo D1 e todo `fetch` do dreno saem
   * por ela (`DrainBudget`), e `drainProviderWork` recebe a fatia como está.
   */
  run: (budget: DrainBudget) => Promise<DrainRun>
}

/** Rodadas do coordenador: a primeira reparte o saldo, as seguintes só reaproveitam a sobra. */
export const DRAIN_MAX_PASSES = 3

/** Fatias de `total` chamadas para `count` drenos: o resto vai para os primeiros da lista. */
export function splitBudget(total: number, count: number): number[] {
  const base = Math.floor(total / count)
  const extra = total - base * count
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0))
}

/**
 * Reparte `total` chamadas entre drenos que pedem `demands[i]` cada um (`Infinity`
 * pede o que sobrar). Quem pede menos que a fatia justa recebe o que pede, e o
 * resto se divide entre os demais, de novo, até ninguém pedir menos que a fatia
 * justa. Se todos pedem pouco, a sobra vai por cima da demanda (por igual, com o
 * resto para os primeiros da lista): a demanda conta o item mais barato, e o
 * item real costuma custar mais. Sem demanda conhecida é `splitBudget`.
 */
export function shareBudget(total: number, demands: readonly number[]): number[] {
  const shares = demands.map(() => 0)
  let remaining = total
  const open = new Set(demands.keys())
  for (let changed = true; changed && open.size > 0;) {
    changed = false
    const fair = Math.floor(remaining / open.size)
    for (const i of open) {
      if (demands[i] > fair) continue
      shares[i] = demands[i]
      remaining -= demands[i]
      open.delete(i)
      changed = true
    }
  }
  const takers = open.size > 0 ? [...open] : [...demands.keys()]
  const extra = splitBudget(remaining, takers.length)
  takers.forEach((drain, k) => {
    shares[drain] += extra[k]
  })
  return shares
}

function demandOf(drain: ProviderDrain, work: ReadyWork | undefined): number {
  if (!drain.queue || !work || drain.minCalls === undefined) return Infinity
  // Só a fatia que comporta a reclamação (e o aviso do acesso pausado), o mínimo para tentar.
  if (work.ready === 0) return drain.minCalls
  const itemCalls = Math.max(1, drain.minCalls - CYCLE_FIXED_CALLS)
  return CYCLE_FIXED_CALLS + Math.min(work.ready, DRAIN_MAX_ITEMS) * itemCalls
}

/**
 * Conta o trabalho pronto dos drenos que têm fila (1 chamada, que conta mesmo
 * quando falha). Só vale a pena com mais de um dreno: com um só, ele recebe o
 * saldo inteiro de qualquer jeito. A falha da consulta não derruba o
 * coordenador: sem a contagem, a divisão é por igual.
 */
async function probeQueues(
  rawDb: D1Database,
  drains: readonly ProviderDrain[],
  now: number,
): Promise<{ work?: Map<string, ReadyWork>; calls: number }> {
  const withQueue = drains.filter((drain) => drain.queue)
  if (drains.length < 2 || withQueue.length === 0) return { calls: 0 }
  try {
    const work = await countReadyWork(
      rawDb,
      withQueue.map((drain) => ({
        provider: drain.provider,
        respectProviderAccess: drain.queue?.respectProviderAccess,
      })),
      now,
    )
    return { work, calls: 1 }
  } catch (err) {
    console.error('[drain] Falha ao contar o trabalho pronto, dividindo o saldo por igual:', err)
    return { calls: 1 }
  }
}

/** Os drenos cuja fatia, na repartição do que sobrou, chega ao `minCalls` deles. */
function withUsefulShare(drains: readonly ProviderDrain[], left: number): ProviderDrain[] {
  let useful = [...drains]
  while (useful.length > 0) {
    const share = Math.floor(left / useful.length)
    const next = useful.filter((drain) => share >= (drain.minCalls ?? 0))
    if (next.length === useful.length) break
    useful = next
  }
  return useful
}

type PassResult = { used: number; stoppedByBudget: boolean }

/**
 * Roda um dreno numa fatia. Falha do dreno fica no log e não derruba os outros:
 * o que ele deixou `running` volta pelo lease, e o que gastou já está contado.
 */
async function runOne(
  rawDb: D1Database,
  drain: ProviderDrain,
  share: number,
  ae?: AnalyticsEngineDataset,
): Promise<PassResult> {
  const budget = new DrainBudget(rawDb, share)
  try {
    const run = await drain.run(budget)
    return { used: budget.used, stoppedByBudget: run.stoppedBy === 'budget' }
  } catch (err) {
    tryLogError(
      ae,
      'provider_work_run',
      `[drain] Falha ao drenar a fila de ${drain.provider}:`,
      err,
      {
        // provedor em blob3, como em toda linha de `provider_work_run`; a mensagem vai para blob4
        blobs: ['error', drain.provider],
      },
    )
    return { used: budget.used, stoppedByBudget: false }
  }
}

function logPerf(line: Record<string, unknown>): void {
  try {
    console.info('[perf]', JSON.stringify(line))
  } catch (err) {
    console.error('[drain] Falha ao registrar a linha [perf]:', err)
  }
}

/**
 * Drena as filas dos provedores num orçamento só de `limit` subrequests
 * (`DRAIN_CALL_BUDGET`, as 5 restantes ficam para a limpeza e a folga). Devolve o
 * total gasto, com a chamada que conta o trabalho pronto (`probeQueues`).
 */
export async function runProviderDrains(
  rawDb: D1Database,
  drains: readonly ProviderDrain[],
  opts: { limit?: number; ae?: AnalyticsEngineDataset; now?: number } = {},
): Promise<number> {
  const startedAt = Date.now()
  const limit = opts.limit ?? DRAIN_CALL_BUDGET
  const probe = await probeQueues(rawDb, drains, opts.now ?? Date.now())
  const queues = probe.work
  let left = limit - probe.calls
  // Sem trabalho pronto nem acesso pausado a avisar, o dreno da fila não roda.
  const idle = (drain: ProviderDrain) => {
    const work = queues?.get(drain.provider)
    return Boolean(queues && drain.queue && !work)
  }
  let pending = drains.filter((drain) => !idle(drain))
  for (let pass = 0; pass < DRAIN_MAX_PASSES && pending.length > 0; pass++) {
    // Sem o que um ciclo custa de fixo não há dreno que reclame um item.
    if (left <= CYCLE_FIXED_CALLS) break
    // Só a primeira rodada chama todos: nas seguintes, quem não tem fatia útil fica de fora.
    const running = pass === 0 ? pending : withUsefulShare(pending, left)
    if (running.length === 0) break
    // A primeira rodada reparte pela demanda de cada fila; as seguintes, o que sobrou, por igual.
    const shares =
      pass === 0 && queues
        ? shareBudget(
            left,
            running.map((drain) => demandOf(drain, queues.get(drain.provider))),
          )
        : splitBudget(left, running.length)
    const results = await Promise.all(
      running.map((drain, i) => runOne(rawDb, drain, shares[i], opts.ae)),
    )
    const spent = results.reduce((sum, result) => sum + result.used, 0)
    left -= spent
    pending = running.filter((_, i) => results[i].stoppedByBudget)
    if (spent === 0) break
  }
  logPerf({
    route: 'cron drainProviderWork',
    drains: drains.map((drain) => drain.provider),
    idle: drains.filter(idle).map((drain) => drain.provider),
    calls_used: limit - left,
    calls_budget: limit,
    unfinished: pending.map((drain) => drain.provider),
    total_ms: Date.now() - startedAt,
  })
  return limit - left
}
