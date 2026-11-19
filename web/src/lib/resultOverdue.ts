/**
 * Resultado atrasado no cliente: mesma regra do painel e do alerta
 * (`api/src/matches/resultOverdue.ts`). Limiar padrão de 3 h; a UI usa a
 * constante local porque o bundle não lê o env do Worker. Se o operador
 * alterar `RESULT_OVERDUE_HOURS` na API, o painel e o e-mail acompanham; o
 * badge do participante continua no padrão documentado até o front receber
 * o limiar por payload (fora deste ticket).
 */

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
