import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

/** Métodos de `D1PreparedStatement` que mandam a consulta ao D1. */
export type D1StatementMethod = 'first' | 'run' | 'all' | 'raw'

const STATEMENT_METHODS = new Set<PropertyKey>(['first', 'run', 'all', 'raw'])

/**
 * Uma chamada que sai para o D1. Em `statement`, `target` é a instrução embrulhada
 * por baixo, já com os binds, e serve para trocar o método chamado.
 */
export type D1Call =
  | { kind: 'statement'; method: D1StatementMethod; target: D1PreparedStatement; args: unknown[] }
  | { kind: 'batch' }
  | { kind: 'exec' }

/**
 * Devolve o mesmo D1, passando por `intercept` cada chamada que sai por ele:
 * `first`, `run`, `all` e `raw` de uma instrução, `batch` e `exec`. `proceed` faz a
 * chamada original e devolve o resultado dela. `prepare` e `bind` não passam.
 */
export function interceptD1(
  db: D1Database,
  intercept: (call: D1Call, proceed: () => Promise<unknown>) => Promise<unknown>,
): D1Database {
  // O `batch` do D1 lê campos internos de cada instrução e recebe as originais.
  const originals = new WeakMap<object, D1PreparedStatement>()

  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target)
        if (typeof value !== 'function') return value
        if (prop === 'bind') {
          return (...values: unknown[]) => wrapStatement(target.bind(...values))
        }
        if (STATEMENT_METHODS.has(prop)) {
          return (...args: unknown[]) =>
            intercept(
              { kind: 'statement', method: prop as D1StatementMethod, target, args },
              () => value.apply(target, args) as Promise<unknown>,
            )
        }
        return value.bind(target)
      },
    })
    originals.set(wrapped, statement)
    return wrapped
  }

  return new Proxy(db, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      if (prop === 'prepare') return (sql: string) => wrapStatement(target.prepare(sql))
      if (prop === 'batch') {
        return (statements: D1PreparedStatement[]) =>
          intercept({ kind: 'batch' }, () =>
            target.batch(statements.map((statement) => originals.get(statement) ?? statement)),
          )
      }
      if (prop === 'exec') {
        return (sql: string) => intercept({ kind: 'exec' }, () => target.exec(sql))
      }
      return value.bind(target)
    },
  })
}
