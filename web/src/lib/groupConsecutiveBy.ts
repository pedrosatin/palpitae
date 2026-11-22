/**
 * Agrupa itens consecutivos que produzem a mesma chave em `keyFn`.
 * Mantém a ordem original sem juntar ocorrências separadas da mesma chave.
 */
export function groupConsecutiveBy<T, K>(items: readonly T[], keyFn: (item: T) => K): [K, T[]][] {
  const result: [K, T[]][] = []
  for (const item of items) {
    const key = keyFn(item)
    const last = result[result.length - 1]
    if (last && last[0] === key) {
      last[1].push(item)
    } else {
      result.push([key, [item]])
    }
  }
  return result
}
