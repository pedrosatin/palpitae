// O rótulo de exibição (`round_label`) vem pronto da API (`GET /matches`) — a fonte
// única é o back (`api/src/matches/rounds.ts`). Aqui fica só a lógica client-side
// que deriva do `round` cru e não tem por que ir ao servidor.

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
