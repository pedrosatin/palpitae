// football-data.org v4 stage values — single source of truth; SQL IN clauses derive from this list. Web copy: web/src/lib/phases.ts.
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

// Active only when toggle is on AND group scores exact scores (points_exact > 0 — 1X2 groups have no shootout bonus).
export function penaltyPicksActive(penaltyPicksEnabled: number, pointsExact: number): boolean {
  return penaltyPicksEnabled === 1 && pointsExact > 0
}

export const KNOCKOUT_PHASES_SQL = KNOCKOUT_PHASES.map((p) => `'${p}'`).join(', ')
