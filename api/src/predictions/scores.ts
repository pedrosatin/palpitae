/** Teto do placar de um palpite. Evita números absurdos no feed e no card de compartilhar. */
export const MAX_SCORE = 99

export function isValidScore(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_SCORE
}
