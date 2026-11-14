import type { D1Database, D1Result } from '@cloudflare/workers-types'
import { interceptD1 } from '../d1Intercept'

/** Linhas que o D1 informou ter lido e escrito nas consultas de uma requisição. */
export type D1RowUsage = { rowsRead: number; rowsWritten: number }

/**
 * Devolve o mesmo D1, somando em `usage` o `rows_read` e o `rows_written` que o D1
 * informa no `meta` de cada consulta (ADR-022).
 *
 * - `run`, `all` e cada instrução de um `batch` trazem `meta` e entram na soma.
 * - `first` não traz `meta`. O medidor troca a chamada por `all`, que custa o mesmo
 *   no D1 (o `first` também executa a consulta inteira), e devolve a primeira linha
 *   ou a coluna pedida, como o `first`.
 * - `raw` e `exec` também não trazem `meta` e passam sem medir. O código da API não
 *   usa nenhum dos dois.
 * - Consulta que falha não entra na soma.
 */
export function meterD1Rows(db: D1Database, usage: D1RowUsage): D1Database {
  const add = (meta: Partial<D1Result['meta']> | undefined) => {
    usage.rowsRead += rowCount(meta?.rows_read)
    usage.rowsWritten += rowCount(meta?.rows_written)
  }
  return interceptD1(db, async (call, proceed) => {
    if (call.kind === 'statement' && call.method === 'first') {
      const result = await call.target.all<Record<string, unknown>>()
      add(result.meta)
      return firstRow(result.results, call.args[0])
    }
    const result = await proceed()
    if (call.kind === 'batch') {
      for (const item of result as D1Result[]) add(item.meta)
    } else if (call.kind === 'statement' && call.method !== 'raw') {
      add((result as D1Result).meta)
    }
    return result
  })
}

function rowCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

// Devolve o mesmo que o `first` do D1. Sem linhas, null. Com coluna pedida, o valor
// dela na primeira linha, e coluna que não existe lança o mesmo erro do D1.
function firstRow(rows: Record<string, unknown>[] | undefined, column: unknown): unknown {
  const row = rows?.[0]
  if (!row) return null
  if (typeof column !== 'string') return row
  if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`)
  return row[column]
}
