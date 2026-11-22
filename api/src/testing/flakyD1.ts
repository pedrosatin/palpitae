/**
 * D1 de teste que falha por regra, para exercitar a recuperação do dreno quando
 * o próprio D1 falha (e não o saldo de chamadas). As instruções ficam marcadas
 * com o SQL de origem, para a regra reconhecer qual chamada falhar. Só para
 * testes; coloque-o por baixo de `limitD1Calls` para a chamada que falhou
 * continuar contando no limite da invocação.
 */

export type FlakyRules = {
  failBatch?: (sqls: string[]) => boolean
  failStatement?: (sql: string) => boolean
}

const STATEMENT_METHODS = new Set<PropertyKey>(['first', 'run', 'all', 'raw'])
const SQL = Symbol('sql')

type Tagged = D1PreparedStatement & { [SQL]?: string }

export function flakyD1(db: D1Database, rules: FlakyRules): D1Database {
  const tag = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const tagged: Tagged = new Proxy(statement, {
      get(target, prop) {
        if (prop === SQL) return sql
        const value: unknown = Reflect.get(target, prop, target)
        if (typeof value !== 'function') return value
        if (prop === 'bind') return (...args: unknown[]) => tag(target.bind(...args), sql)
        if (STATEMENT_METHODS.has(prop)) {
          return (...args: unknown[]) => {
            if (rules.failStatement?.(sql)) {
              return Promise.reject(new Error('D1_ERROR: falha simulada da instrução'))
            }
            return value.apply(target, args)
          }
        }
        return value.bind(target)
      },
    })
    return tagged
  }
  return new Proxy(db, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      if (prop === 'prepare') return (sql: string) => tag(target.prepare(sql), sql)
      if (prop === 'batch') {
        return (statements: Tagged[]) => {
          const sqls = statements.map((statement) => statement[SQL] ?? '')
          if (rules.failBatch?.(sqls)) {
            return Promise.reject(new Error('D1_ERROR: falha simulada do batch'))
          }
          return target.batch(statements)
        }
      }
      return value.bind(target)
    },
  })
}

/** O batch que grava o estado dos itens do dreno (só `UPDATE provider_work`). */
export const isStateBatch = (sqls: string[]) =>
  sqls.length > 0 && sqls.every((sql) => sql.includes('UPDATE provider_work'))
