/**
 * Regra única de travamento de palpite (ADR-004: derivado em runtime).
 * Centralizado aqui porque a mesma condição aparece em vários
 * lugares — leitura dos palpites, revelação dos palpites alheios (anti-cópia) e
 * validação de escrita. Divergir entre eles abre brecha: se a leitura revela o
 * palpite dos outros mas a escrita ainda aceita edição, dá pra copiar.
 *
 * Travado = o sync já viu o jogo iniciado (`locked_at` preenchido), OU está ao vivo /
 * encerrado, OU o horário passou e o jogo não está adiado.
 *
 * `locked_at` (migration 0016) é o instante em que o sync viu o jogo iniciado pela
 * primeira vez (status de início do provider ou status local live/finished) e nunca
 * é apagado. Sem ele, um jogo suspenso ou adiado DEPOIS do início (provider manda
 * SUSPENDED/POSTPONED, o status volta para 'scheduled' e `postponed` vira 1) reabria
 * palpites já revelados aos outros membros. Horário vencido sozinho não grava
 * `locked_at`: um adiamento de jogo que não começou continua reabrindo o palpite.
 *
 * O `postponed = 0` existe porque um jogo adiado mantém o `start_time` original
 * (ver o upsert em sync.ts) — já passou, mas o jogo não aconteceu. Sem essa
 * cláusula o palpite ficaria congelado para sempre e o jogo seria disputado
 * semanas depois com todo mundo preso ao palpite antigo.
 */

/**
 * Relógio do banco no formato de `Date.prototype.toISOString()`, o mesmo do `now`
 * que as rotas passam. Para o comando de escrita que confere o travamento no
 * instante em que grava, e não no instante em que a requisição começou.
 */
export const SQL_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

/**
 * Fragmento SQL. Consome UM parâmetro posicional: o `now` em ISO 8601. Com
 * `nowSql` (por exemplo `SQL_NOW`), usa essa expressão e não consome parâmetro.
 */
export function lockedSql(alias = 'm', nowSql = '?'): string {
  return `(${alias}.locked_at IS NOT NULL OR ${alias}.status IN ('live', 'finished') OR (${alias}.start_time <= ${nowSql} AND ${alias}.postponed = 0))`
}

/**
 * Equivalente em TS, para os caminhos de escrita que já têm a linha em mãos.
 *
 * Compara com `!== 1` (e não `=== 0`) de propósito: fail-closed. Se a coluna vier
 * ausente/nula por qualquer motivo, o jogo é tratado como NÃO adiado e o lock
 * normal por horário continua valendo. O contrário deixaria a escrita aberta.
 * Se o jogo já estiver ao vivo ('live') ou encerrado ('finished'), ou se o sync já o
 * tiver visto iniciado (`locked_at`), trava imediatamente.
 */
export function isMatchLocked(
  match: {
    start_time: string
    status?: string | null
    postponed?: number | null
    locked_at?: string | null
  },
  now: string,
): boolean {
  if (match.locked_at) return true
  if (match.status === 'live' || match.status === 'finished') return true
  return match.postponed !== 1 && new Date(now).getTime() >= new Date(match.start_time).getTime()
}
