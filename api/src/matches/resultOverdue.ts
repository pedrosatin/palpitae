/**
 * Resultado atrasado: jogo sem placar completo depois do início previsto + limiar,
 * excluindo adiados conhecidos. A mesma regra alimenta o painel admin (#617),
 * a sinalização ao participante e o alerta ao operador (ticket 05).
 *
 * Limiar padrão: 3 horas (`DEFAULT_OVERDUE_RESULT_HOURS`). Ajuste via
 * `RESULT_OVERDUE_HOURS` (inteiro positivo em horas). Valor inválido ou ausente
 * volta ao padrão.
 */

/** Horas após o kickoff antes de contar o jogo sem placar como atrasado. */
export const DEFAULT_OVERDUE_RESULT_HOURS = 3

/**
 * Lê `RESULT_OVERDUE_HOURS`. Inteiro positivo; qualquer outra coisa (vazio,
 * texto, zero, negativo, decimal) devolve o padrão.
 */
export function overdueResultHours(raw?: string | null): number {
  if (raw == null || raw.trim() === '') return DEFAULT_OVERDUE_RESULT_HOURS
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_OVERDUE_RESULT_HOURS
  return n
}

/** Expressão SQL `datetime('now', '-N hours')` para o limiar corrente. */
export function overdueCutoffSqlBind(hours: number): string {
  return `-${hours} hours`
}

/**
 * Condição SQL de jogo atrasado sem placar (buraco de feed). Consome o bind
 * de `overdueCutoffSqlBind(hours)` na comparação de `start_time`.
 *
 * Critério: `scheduled`/`live`, `postponed = 0`, placar incompleto,
 * `datetime(start_time) <= datetime('now', ?)`.
 *
 * `alias` vazio gera colunas sem prefixo (subquery `FROM matches`).
 */
export function overdueNoScoreSql(alias = 'm'): string {
  const p = alias ? `${alias}.` : ''
  return (
    `${p}status IN ('scheduled', 'live') AND ${p}postponed = 0 ` +
    `AND (${p}home_score IS NULL OR ${p}away_score IS NULL) ` +
    `AND datetime(${p}start_time) <= datetime('now', ?)`
  )
}

export type OverdueMatchFields = {
  start_time: string
  status?: string | null
  postponed?: number | boolean | null
  home_score?: number | null
  away_score?: number | null
}

/**
 * Equivalente em TS da condição SQL. `postponed` usa a mesma regra fail-closed
 * do travamento: valor diferente de 1/`true` conta como não adiado.
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

/** Agregado de jogos atrasados sem placar no D1. */
export type OverdueResultSummary = {
  matches: number
  /** Minutos desde o kickoff do jogo atrasado mais antigo; 0 se não há nenhum. */
  oldest_minutes: number
  /** Competições distintas com pelo menos um atraso. */
  competitions: number
}

/**
 * Conta jogos atrasados sem placar. Uma consulta; bind do limiar em horas.
 * `nowMs` só entra no cálculo de `oldest_minutes` (a SQL usa o relógio do D1).
 */
export async function countOverdueResults(
  db: D1Database,
  hours: number = DEFAULT_OVERDUE_RESULT_HOURS,
  nowMs: number = Date.now(),
): Promise<OverdueResultSummary> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS matches, ` +
        `COUNT(DISTINCT competition_id) AS competitions, ` +
        `MIN(start_time) AS oldest ` +
        `FROM matches WHERE ${overdueNoScoreSql('')}`,
    )
    .bind(overdueCutoffSqlBind(hours))
    .first<{ matches: number; competitions: number; oldest: string | null }>()

  const matches = Number(row?.matches ?? 0)
  const competitions = Number(row?.competitions ?? 0)
  if (matches <= 0 || !row?.oldest) {
    return { matches: 0, oldest_minutes: 0, competitions: 0 }
  }
  const oldestMinutes = Math.round((nowMs - Date.parse(row.oldest)) / 60_000)
  return {
    matches,
    competitions,
    oldest_minutes: Number.isFinite(oldestMinutes) ? Math.max(0, oldestMinutes) : 0,
  }
}
