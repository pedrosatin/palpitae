/**
 * Regra única de travamento de palpite (ADR-004: derivado em runtime).
 * Centralizado aqui porque a mesma condição aparece em vários
 * lugares — leitura dos palpites, revelação dos palpites alheios (anti-cópia) e
 * validação de escrita. Divergir entre eles abre brecha: se a leitura revela o
 * palpite dos outros mas a escrita ainda aceita edição, dá pra copiar.
 *
 * Travado = o sync já persistiu a trava em `locked_at`, OU está ao vivo /
 * encerrado, OU o horário passou e o jogo não está adiado.
 *
 * `locked_at` também registra a trava por horário da linha anterior no sync.
 * Depois da revelação, adiamento, cancelamento e remarcação preservam a trava
 * permanente, conforme o ADR-023. Um adiamento recebido antes do kickoff mantém
 * a edição aberta até a nova data. Enquanto adiado, o jogo conserva o último
 * horário conhecido e `postponed = 1` impede a trava por esse horário antigo.
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
 *
 * O `now` é truncado para segundos antes da comparação de texto, porque o
 * `start_time` é gravado sem milissegundos (migration 0043). Com o `now` cru,
 * '2026-11-09T20:00:00Z' <= '2026-11-09T20:00:00.500Z' é falso (`Z` vem depois de
 * `.`), e o jogo seguia aberto até o fim do primeiro segundo enquanto
 * `isMatchLocked` já o tratava como travado.
 */
export function lockedSql(alias = 'm', nowSql = '?'): string {
  return `(${alias}.locked_at IS NOT NULL OR ${alias}.status IN ('live', 'finished') OR (${alias}.start_time <= strftime('%Y-%m-%dT%H:%M:%SZ', ${nowSql}) AND ${alias}.postponed = 0))`
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
