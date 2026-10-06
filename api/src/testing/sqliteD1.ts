/// <reference types="node" />
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'

/**
 * D1 de teste sobre SQLite em memória, com todas as migrations aplicadas.
 * Executa o SQL de produção de verdade (constraints, upserts, batches), ao
 * contrário dos fakes que só capturam binds. Só para testes.
 */
export function createSqliteD1(): { sqlite: DatabaseSync; db: D1Database } {
  const sqlite = new DatabaseSync(':memory:')
  const migrations = new URL('../../migrations/', import.meta.url)
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'))
  }
  function prepare(sql: string, values: SQLInputValue[] = []) {
    return {
      bind(...args: SQLInputValue[]) {
        return prepare(sql, args)
      },
      async first() {
        return sqlite.prepare(sql).get(...values) ?? null
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values), success: true }
      },
      async run() {
        const result = sqlite.prepare(sql).run(...values)
        return { success: true, meta: { changes: Number(result.changes) } }
      },
    }
  }
  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.all())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
  return { sqlite, db }
}
