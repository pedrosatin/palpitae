// Parallel of api/src/matches/phases.ts — web app cannot import from the API package.
// Difference: penaltyPicksEnabled is boolean here (API converts the DB integer before responding)
// vs number in the API version (D1 stores 0/1).
export const KNOCKOUT_PHASES = [
  'LAST_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
  'THIRD_PLACE',
  'FINAL',
] as const

export function isKnockoutPhase(phase: string | null | undefined): boolean {
  return phase != null && (KNOCKOUT_PHASES as readonly string[]).includes(phase)
}

export function penaltyPicksActive(penaltyPicksEnabled: boolean, pointsExact: number): boolean {
  return penaltyPicksEnabled && pointsExact > 0
}
