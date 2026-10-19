/**
 * Orçamento do free tier football-data.org.
 *
 * A API limita a 10 requests/minuto (header `X-Requests-Available-Minute`).
 * Discovery (1×/dia, fora do pico) e poller (~30 min) compartilham esta cota.
 * `FD_MAX_CONCURRENT_REQUESTS` fica abaixo de 10 para deixar folga a retries e
 * sobreposição ocasional entre jobs no mesmo minuto.
 */

/** Limite documentado do free tier (requests por minuto). */
export const FD_FREE_REQUESTS_PER_MINUTE = 10

/**
 * Teto de syncs football-data em paralelo por ciclo (poller/discovery).
 * Estritamente menor que `FD_FREE_REQUESTS_PER_MINUTE`.
 */
export const FD_MAX_CONCURRENT_REQUESTS = 4

/** Espera única antes de repetir um request que voltou HTTP 429. */
export const FD_RETRY_BACKOFF_MS = 6_000

/**
 * Executa `worker` sobre `items` com no máximo `limit` promessas em voo.
 * Preserva a ordem dos resultados. `limit < 1` trata como 1.
 */
export async function runWithConcurrency<T, R>(
  limit: number,
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []

  const concurrency = Math.max(1, Math.min(limit, items.length))
  const results = new Array<R>(items.length)
  let nextIndex = 0

  const runners = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })

  await Promise.all(runners)
  return results
}
