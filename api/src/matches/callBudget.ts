import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

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

/** Métodos de `D1PreparedStatement` que mandam a consulta ao D1. */
const STATEMENT_CALLS = new Set<PropertyKey>(['first', 'run', 'all', 'raw'])

/**
 * Devolve o mesmo D1, somando em `budget.used` cada chamada que sai por ele:
 * `first`, `run`, `all` e `raw` de uma instrução, `batch` e `exec`. Só conta;
 * quem decide parar é a rotina que consulta o orçamento.
 */
export function countD1Calls(db: D1Database, budget: CallBudget): D1Database {
  // O `batch` do D1 lê campos internos de cada instrução: recebe as originais.
  const originals = new WeakMap<object, D1PreparedStatement>()

  const countStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const counted = new Proxy(statement, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target)
        if (typeof value !== 'function') return value
        if (prop === 'bind') {
          return (...values: unknown[]) => countStatement(target.bind(...values))
        }
        if (STATEMENT_CALLS.has(prop)) {
          return (...args: unknown[]) => {
            budget.used += 1
            return value.apply(target, args)
          }
        }
        return value.bind(target)
      },
    })
    originals.set(counted, statement)
    return counted
  }

  return new Proxy(db, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      if (prop === 'prepare') return (sql: string) => countStatement(target.prepare(sql))
      if (prop === 'batch') {
        return (statements: D1PreparedStatement[]) => {
          budget.used += 1
          return target.batch(statements.map((statement) => originals.get(statement) ?? statement))
        }
      }
      if (prop === 'exec') {
        return (sql: string) => {
          budget.used += 1
          return target.exec(sql)
        }
      }
      return value.bind(target)
    },
  })
}
