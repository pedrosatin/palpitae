import type { D1Database } from '@cloudflare/workers-types'
import { logError } from '../observability/events'
import { DRAIN_CALL_BUDGET, DrainBudget, CYCLE_FIXED_CALLS } from './drainBudget'
import type { DrainRun } from './providerWork'

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
 */

export type ProviderDrain = {
  /** Nome do provedor, para o log. */
  provider: string
  /**
   * Menor fatia com que o dreno ainda conclui um item (o custo fixo de um ciclo
   * mais o item mais barato). A rodada que reaproveita a sobra não o chama com
   * menos que isso: gastaria um evento e nenhuma chamada útil.
   */
  minCalls?: number
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
    logError(ae, 'provider_work_run', `[drain] Falha ao drenar a fila de ${drain.provider}:`, err, {
      blobs: ['error'],
    })
    return { used: budget.used, stoppedByBudget: false }
  }
}

/**
 * Drena as filas dos provedores num orçamento só de `limit` subrequests
 * (`DRAIN_CALL_BUDGET`, as 5 restantes ficam para a limpeza e a folga). Devolve o
 * total gasto.
 */
export async function runProviderDrains(
  rawDb: D1Database,
  drains: readonly ProviderDrain[],
  opts: { limit?: number; ae?: AnalyticsEngineDataset } = {},
): Promise<number> {
  const startedAt = Date.now()
  const limit = opts.limit ?? DRAIN_CALL_BUDGET
  let left = limit
  let pending = [...drains]
  for (let pass = 0; pass < DRAIN_MAX_PASSES && pending.length > 0; pass++) {
    // Sem o que um ciclo custa de fixo não há dreno que reclame um item.
    if (left <= CYCLE_FIXED_CALLS) break
    // Só a primeira rodada chama todos: nas seguintes, quem não tem fatia útil fica de fora.
    const running = pass === 0 ? pending : withUsefulShare(pending, left)
    if (running.length === 0) break
    const shares = splitBudget(left, running.length)
    const results = await Promise.all(
      running.map((drain, i) => runOne(rawDb, drain, shares[i], opts.ae)),
    )
    const spent = results.reduce((sum, result) => sum + result.used, 0)
    left -= spent
    pending = running.filter((_, i) => results[i].stoppedByBudget)
    if (spent === 0) break
  }
  console.info(
    '[perf]',
    JSON.stringify({
      route: 'cron drainProviderWork',
      drains: drains.map((drain) => drain.provider),
      calls_used: limit - left,
      calls_budget: limit,
      unfinished: pending.map((drain) => drain.provider),
      total_ms: Date.now() - startedAt,
    }),
  )
  return limit - left
}
