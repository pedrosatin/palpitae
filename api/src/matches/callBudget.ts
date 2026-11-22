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

/**
 * A chamada não cabe no saldo da rotina: nada foi chamado. Quem a recebe devolve
 * o trabalho para retomar depois, sem contar falha do provedor.
 */
export class CallBudgetExhaustedError extends Error {
  constructor() {
    super('saldo de chamadas da invocação esgotado')
    this.name = 'CallBudgetExhaustedError'
  }
}

/**
 * Porteiro das chamadas de uma rotina que divide a invocação com outras (o dreno
 * da fila, ADR-027). A rotina o consulta antes de gastar, em vez de deixar o
 * limite da plataforma falhar a chamada 51.
 */
export type CallGate = {
  /** Cobra um `fetch` antes de iniciá-lo; lança `CallBudgetExhaustedError` se não couber. */
  chargeFetch(): void
  /** Chamadas que ainda cabem a esta rotina agora. */
  callsLeft(): number
}

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
