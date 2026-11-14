/**
 * Executa `worker` sobre `items` com no máximo `limit` promessas em voo.
 * Preserva a ordem dos resultados. `limit < 1` trata como 1.
 *
 * Rejeita na primeira falha de um `worker`: quem precisa seguir com as demais
 * tarefas captura o erro dentro do próprio `worker`.
 */
export async function runWithConcurrency<T, R>(
  limit: number,
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []

  const concurrency = Math.max(1, Math.min(limit, items.length))
  const results = Array.from({ length: items.length }) as R[]
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
