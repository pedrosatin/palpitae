import type { D1Database } from '@cloudflare/workers-types'
import { interceptD1 } from '../d1Intercept'

/**
 * Orçamento de chamadas de uma invocação do Worker (ADR-024).
 *
 * No plano Free a invocação faz no máximo 50 chamadas: cada consulta ao D1 conta
 * uma, um `db.batch()` inteiro conta uma e cada `fetch` conta uma
 * (https://developers.cloudflare.com/d1/platform/limits/ e
 * https://developers.cloudflare.com/workers/platform/limits/). A chamada que
 * passa do limite lança erro. O D1 de teste não impõe esse limite.
 */
export const INVOCATION_CALL_LIMIT = 50

/** Chamadas que a rotina pode fazer (`limit`) e as que já fez (`used`). */
export type CallBudget = { readonly limit: number; used: number }

export function callsLeft(budget: CallBudget): number {
  return Math.max(0, budget.limit - budget.used)
}

/**
 * Devolve o mesmo D1, somando em `budget.used` cada chamada que sai por ele:
 * `first`, `run`, `all` e `raw` de uma instrução, `batch` e `exec`. Só conta;
 * quem decide parar é a rotina que consulta o orçamento.
 */
export function countD1Calls(db: D1Database, budget: CallBudget): D1Database {
  return interceptD1(db, (_call, proceed) => {
    budget.used += 1
    return proceed()
  })
}
