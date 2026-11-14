/**
 * Limite de parâmetros por instrução no D1 da Cloudflare, que o SQLite em
 * memória de `sqliteD1.ts` não impõe. O D1 real recusa consultas com mais de
 * 100 binds com "too many SQL variables". Este wrapper rejeita a execução da
 * instrução que passar do teto. Só para testes.
 */
export const D1_BINDS_PER_STATEMENT = 100

const STATEMENT_CALLS = new Set<PropertyKey>(['first', 'run', 'all', 'raw'])

/**
 * Envolve um D1 para rejeitar instruções que recebam mais de `limit`
 * parâmetros em `bind`, antes de chegarem ao banco.
 */
export function limitD1Binds(db: D1Database, limit: number = D1_BINDS_PER_STATEMENT): D1Database {
  const bindCounts = new WeakMap<object, number>()
  const originals = new WeakMap<object, D1PreparedStatement>()
  const tooManyVariables = () => new Error('D1_ERROR: too many SQL variables')

  const wrapStatement = (
    statement: D1PreparedStatement,
    bindCount: number,
  ): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target)
        if (typeof value !== 'function') return value
        if (prop === 'bind') {
          return (...values: unknown[]) => wrapStatement(target.bind(...values), values.length)
        }
        if (STATEMENT_CALLS.has(prop)) {
          return (...args: unknown[]) => {
            if (bindCount > limit) return Promise.reject(tooManyVariables())
            return value.apply(target, args) as Promise<unknown>
          }
        }
        return value.bind(target)
      },
    })
    bindCounts.set(wrapped, bindCount)
    originals.set(wrapped, statement)
    return wrapped
  }

  return new Proxy(db, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      if (prop === 'prepare') {
        return (sql: string) => {
          const placeholderCount = (sql.match(/\?/g) ?? []).length
          return wrapStatement(target.prepare(sql), placeholderCount)
        }
      }
      if (prop === 'batch') {
        return (statements: D1PreparedStatement[]) => {
          if (statements.some((s) => (bindCounts.get(s) ?? 0) > limit)) {
            return Promise.reject(tooManyVariables())
          }
          return target.batch(statements.map((s) => originals.get(s) ?? s))
        }
      }
      return value.bind(target)
    },
  })
}
