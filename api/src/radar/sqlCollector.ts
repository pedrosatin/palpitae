
type Bound = { sql: string; params: unknown[] }

/**
 * Literal SQL para SQLite. Só aceita os tipos que o radar realmente grava —
 * qualquer outra coisa é erro, não conversão silenciosa: um `[object Object]`
 * indo parar no banco seria pior que a falha.
 */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Número inválido para SQL: ${value}`)
    return String(value)
  }
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  throw new Error(`Tipo não suportado em SQL: ${typeof value}`)
}

/** Substitui cada `?` posicional pelo literal correspondente. */
export function inlineParams(sql: string, params: unknown[]): string {
  let index = 0
  const inlined = sql.replace(/\?/g, () => {
    if (index >= params.length) throw new Error('Menos parâmetros que placeholders')
    return sqlLiteral(params[index++])
  })
  if (index !== params.length) {
    throw new Error(`Sobraram ${params.length - index} parâmetro(s) sem placeholder`)
  }
  return inlined
}

export class SqlCollector {
  private readonly collected: Bound[] = []

  prepare(sql: string) {
    const bound: Bound = { sql, params: [] }
    const statement = {
      bind: (...params: unknown[]) => {
        bound.params = params
        return statement
      },
    }
    this.collected.push(bound)
    return statement
  }

  async batch(): Promise<void> {
    // Os statements já foram registrados no `prepare`; o batch existe só para
    // satisfazer a interface que o syncRadar usa.
  }

  get size(): number {
    return this.collected.length
  }

  toSql(): string {
    return `${this.collected.map((s) => `${inlineParams(s.sql, s.params)};`).join('\n')}\n`
  }
}
