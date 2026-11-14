/** Formatação de número, data e tempo compartilhada pelo painel de métricas e pelo radar. */

export const DAY_MS = 24 * 60 * 60 * 1000

/** Número em pt-BR sem arredondar: preserva decimais (ex.: pesos de sampling). */
export function formatNumber(n: number): string {
  return n.toLocaleString('pt-BR')
}

/** Contagem em pt-BR arredondada ao inteiro. */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('pt-BR')
}

/** Timestamp da SQL API (`YYYY-MM-DD hh:mm:ss`, UTC) → epoch ms; NaN se inválido. */
export function parseSqlUtc(ts: string): number {
  return new Date(`${ts.replace(' ', 'T')}Z`).getTime()
}

/** "YYYY-MM-DD hh:mm:ss" (UTC da SQL API) → "dd/mm hh:mm UTC". */
export function formatSince(ts: string): string {
  const [date, time] = ts.split(' ')
  if (!date || !time) return ts
  const [, m, d] = date.split('-')
  return `${d}/${m} ${time.slice(0, 5)} UTC`
}

/** O timestamp cai dentro dos últimos `days` dias: a coleta não cobre o período inteiro. */
export function isNewerThanPeriod(ts: string, days: number): boolean {
  const first = parseSqlUtc(ts)
  return Number.isFinite(first) && first > Date.now() - days * DAY_MS
}
