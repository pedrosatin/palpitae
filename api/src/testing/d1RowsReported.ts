/**
 * Linhas lidas e escritas que o D1 informa no `meta` de cada consulta e que o SQLite
 * em memória de `sqliteD1.ts` não informa. `rowsFor` decide o valor de cada
 * instrução pelo SQL, e o embrulho põe `rows_read` e `rows_written` no resultado de
 * `all`, `run` e de cada instrução de um `batch`. O `first` continua sem `meta`, como
 * no D1.
 * Só para testes. Não depende do medidor de produção (`security/d1Usage.ts`).
 */
export type ReportedRows = { rows_read: number; rows_written: number }

export function reportD1Rows(db: D1Database, rowsFor: (sql: string) => ReportedRows): D1Database {
  // O `batch` do SQLite em memória lê campos internos de cada instrução.
  const originals = new WeakMap<object, { statement: D1PreparedStatement; sql: string }>()

  const withRows = (result: unknown, sql: string) => {
    const { meta, ...rest } = (result ?? {}) as { meta?: object }
    return { ...rest, meta: { ...meta, ...rowsFor(sql) } }
  }

  const wrapStatement = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target)
        if (typeof value !== 'function') return value
        if (prop === 'bind') {
          return (...values: unknown[]) => wrapStatement(target.bind(...values), sql)
        }
        if (prop === 'all' || prop === 'run') {
          return async (...args: unknown[]) => withRows(await value.apply(target, args), sql)
        }
        return value.bind(target)
      },
    })
    originals.set(wrapped, { statement, sql })
    return wrapped
  }

  return new Proxy(db, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      if (prop === 'prepare') return (sql: string) => wrapStatement(target.prepare(sql), sql)
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          const unwrapped = statements.map((s) => originals.get(s) ?? { statement: s, sql: '' })
          const results = await target.batch(unwrapped.map((s) => s.statement))
          return results.map((result, i) => withRows(result, unwrapped[i].sql))
        }
      }
      return value.bind(target)
    },
  })
}
