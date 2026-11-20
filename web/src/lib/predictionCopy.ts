/**
 * Compatibilidade de cópia entre grupos. Espelha `acceptsFrom` e `outcomeScore`
 * da API (`api/src/predictions/replicate.ts`). Os vetores em
 * `test-vectors/copia.json` fixam a paridade.
 */

export type CopyMode = {
  points_exact: number
}

/**
 * Origem "só vencedor" não grava em destino que pontua o placar exato. O botão
 * grava 1x0 e apagaria um placar que o destino pode ter palpitado.
 */
export function acceptsFrom(source: CopyMode, target: CopyMode): boolean {
  return source.points_exact > 0 || target.points_exact === 0
}

/**
 * Num grupo "só vencedor" (`points_exact = 0`), o resultado do palpite vira 1x0,
 * 0x0 ou 0x1, os placares dos botões Casa, Empate e Fora.
 */
export function outcomeScore(home: number, away: number): { home: number; away: number } {
  if (home > away) return { home: 1, away: 0 }
  if (home < away) return { home: 0, away: 1 }
  return { home: 0, away: 0 }
}

/** Placar gravado no destino: resultado reduzido se o destino for só vencedor. */
export function scoreForTarget(
  target: CopyMode,
  home: number,
  away: number,
): { home: number; away: number } {
  return target.points_exact === 0 ? outcomeScore(home, away) : { home, away }
}
