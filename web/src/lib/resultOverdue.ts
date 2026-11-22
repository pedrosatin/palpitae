
/** Horas após o kickoff antes de sinalizar resultado pendente. */
export const DEFAULT_OVERDUE_RESULT_HOURS = 3

export type OverdueMatchFields = {
  start_time: string
  status?: string | null
  postponed?: number | boolean | null
  home_score?: number | null
  away_score?: number | null
}

/**
 * Jogo `scheduled`/`live`, não adiado, sem placar completo, com início há
 * pelo menos `hours` horas. Não inventa placar: só classifica o estado.
 */
export function isResultOverdue(
  match: OverdueMatchFields,
  nowMs: number,
  hours: number = DEFAULT_OVERDUE_RESULT_HOURS,
): boolean {
  if (match.status !== 'scheduled' && match.status !== 'live') return false
  if (match.postponed === 1 || match.postponed === true) return false
  if (match.home_score != null && match.away_score != null) return false
  const start = Date.parse(match.start_time)
  if (!Number.isFinite(start)) return false
  return nowMs >= start + hours * 60 * 60 * 1000
}
