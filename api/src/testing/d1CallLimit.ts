/**
 * Limite de chamadas ao D1 por invocação do Worker, que o SQLite em memória de
 * `sqliteD1.ts` não tem. No plano Free são 50: cada `first`, `run`, `all` ou
 * `raw` de uma instrução conta uma chamada e um `batch` inteiro conta uma. A
 * chamada que passa do limite é rejeitada com o erro do D1 e não chega ao banco.
 * Só para testes; não depende do contador de produção (`matches/callBudget.ts`).
 */
export const D1_CALLS_PER_INVOCATION = 50

const STATEMENT_CALLS = new Set<PropertyKey>(['first', 'run', 'all', 'raw'])

export type LimitedD1 = {
  db: D1Database
  /** Começa outra invocação: zera a contagem. */
  startInvocation(): void
  /** Chamadas da invocação atual, contando as rejeitadas. */
  calls(): number
}

/** `limit` nulo só conta, sem rejeitar nada. */
export function limitD1Calls(
  db: D1Database,
  limit: number | null = D1_CALLS_PER_INVOCATION,
): LimitedD1 {
  let calls = 0
  const charge = () => {
    calls += 1
    if (limit !== null && calls > limit) {
      throw new Error('D1_ERROR: Too many API requests by single worker invocation.')
    }
  }

  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target)
        if (typeof value !== 'function') return value
        if (prop === 'bind') {
          return (...values: unknown[]) => wrapStatement(target.bind(...values))
        }
        if (STATEMENT_CALLS.has(prop)) {
          return async (...args: unknown[]) => {
            charge()
            return value.apply(target, args)
          }
        }
        return value.bind(target)
      },
    })

  const limited = new Proxy(db, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      if (prop === 'prepare') return (sql: string) => wrapStatement(target.prepare(sql))
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          charge()
          return target.batch(statements)
        }
      }
      return value.bind(target)
    },
  })

  return {
    db: limited,
    startInvocation: () => {
      calls = 0
    },
    calls: () => calls,
  }
}
