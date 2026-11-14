import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

/** Limite de instruções por `db.batch` do D1. */
const D1_BATCH_LIMIT = 100

/**
 * Executa as instruções em lotes de 100, em paralelo. Cada lote é uma transação
 * própria: a atomicidade vale dentro do lote, não entre eles.
 */
export async function runInBatches(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<void> {
  const batches = []
  for (let i = 0; i < statements.length; i += D1_BATCH_LIMIT) {
    batches.push(db.batch(statements.slice(i, i + D1_BATCH_LIMIT)))
  }
  await Promise.all(batches)
}
