/**
 * Regra única de travamento de palpite (ADR-004: derivado em runtime, nunca
 * persistido). Centralizado aqui porque a mesma condição aparece em vários
 * lugares — leitura dos palpites, revelação dos palpites alheios (anti-cópia) e
 * validação de escrita. Divergir entre eles abre brecha: se a leitura revela o
 * palpite dos outros mas a escrita ainda aceita edição, dá pra copiar.
 *
 * Travado = o jogo já começou E não está adiado.
 *
 * O `postponed = 0` existe porque um jogo adiado mantém o `start_time` original
 * (ver o upsert em sync.ts) — já passou, mas o jogo não aconteceu. Sem essa
 * cláusula o palpite ficaria congelado para sempre e o jogo seria disputado
 * semanas depois com todo mundo preso ao palpite antigo.
 */

/** Fragmento SQL. Consome UM parâmetro posicional: o `now` em ISO 8601. */
export function lockedSql(alias = 'm'): string {
  return `(${alias}.start_time <= ? AND ${alias}.postponed = 0)`
}

/**
 * Equivalente em TS, para os caminhos de escrita que já têm a linha em mãos.
 *
 * Compara com `!== 1` (e não `=== 0`) de propósito: fail-closed. Se a coluna vier
 * ausente/nula por qualquer motivo, o jogo é tratado como NÃO adiado e o lock
 * normal por horário continua valendo. O contrário deixaria a escrita aberta.
 */
export function isMatchLocked(
  match: { start_time: string; postponed?: number | null },
  now: string,
): boolean {
  return match.postponed !== 1 && now >= match.start_time
}
