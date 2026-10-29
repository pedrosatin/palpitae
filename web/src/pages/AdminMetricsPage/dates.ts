/** Últimos `days` dias UTC, do mais antigo pro mais novo (YYYY-MM-DD). */
export function lastDays(days: number, endOffset = 0): string[] {
  const today = new Date()
  const keys: string[] = []
  for (let back = days - 1 + endOffset; back >= endOffset; back--) {
    const d = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back),
    )
    keys.push(d.toISOString().slice(0, 10))
  }
  return keys
}
