/**
 * Coletor de SQL — implementa o mínimo da interface do D1 (`prepare`/`bind`/
 * `batch`) e, em vez de executar, serializa os statements num script `.sql`.
 *
 * Existe porque a coleta do radar não pode rodar dentro do Worker: a
 * API-Football aplica rate limit **por IP**, e os IPs de saída dos Cloudflare
 * Workers são compartilhados por milhares de clientes — a primeira chamada do
 * dia já volta 429 mesmo com a quota da conta intacta (2/100). Do IP de um
 * runner do GitHub a mesma chamada devolve 200. Ver ADR-014.
 *
 * Com isto, `syncRadar` roda **sem nenhuma alteração** fora do Worker: o script
 * do cron passa este coletor no lugar do D1, e o workflow aplica o SQL gerado
 * com `wrangler d1 execute --remote --file`. Um `INSERT` por linha seria ~1.500
 * requisições HTTP na REST API do D1; um arquivo é uma chamada só.
 */

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

  /** Script pronto para `wrangler d1 execute --file`. */
  toSql(): string {
    const lines = this.collected.map((s) => `${inlineParams(s.sql, s.params)};`)
    // Tudo numa transação: um snapshot pela metade (competições sem os jogos,
    // ou o UPDATE de is_current sem os INSERTs) é pior que nenhum snapshot.
    return ['BEGIN TRANSACTION;', ...lines, 'COMMIT;', ''].join('\n')
  }
}
