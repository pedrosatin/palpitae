export const KNOCKOUT_LABELS: Record<string, string> = {
  LAST_32: 'Rodada de 32',
  LAST_16: 'Oitavas de final',
  QUARTER_FINALS: 'Quartas de final',
  SEMI_FINALS: 'Semifinais',
  THIRD_PLACE: 'Terceiro lugar',
  FINAL: 'Final',
}

export function roundLabel(round: string): string {
  if (/^\d+$/.test(round)) return `Rodada ${round}`
  return KNOCKOUT_LABELS[round] ?? round
}

export function isGroupStageRound(round: string): boolean {
  return /^\d+$/.test(round)
}

// null = no future round; undefined = pre-deploy cache without the field.
// Both cases fall back to the last round (preserves old behaviour).
export function applyDefaultRound(
  defaultRound: string | null | undefined,
  rounds: string[],
  setRoundIndex: (i: number) => void,
): void {
  if (defaultRound != null) {
    const idx = rounds.indexOf(defaultRound)
    setRoundIndex(idx >= 0 ? idx : rounds.length - 1)
  } else if (rounds.length > 0) {
    setRoundIndex(rounds.length - 1)
  }
}
