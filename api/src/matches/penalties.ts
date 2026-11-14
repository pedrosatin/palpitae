import type { TieRole } from './ties'

/**
 * Penalty-shootout eligibility gate — data-driven by (competition, phase).
 *
 * A competition lists which knockout stages decide on penalties in a single game
 * via competitions.penalty_phases (a JSON array of raw football-data `stage`
 * strings, e.g. ["LAST_16","FINAL"]). This is the single source of truth shared
 * by scoring (whether to award the penalty bonus) and the matches router (the
 * `decides_on_penalties` flag the frontend uses to show the pick).
 *
 * Fail-closed: a phase not listed — or an empty list — never goes to penalties.
 * Os confrontos de ida e volta seguem `decidesOnPenalties`.
 */
export function matchGoesToPenalties(penaltyPhases: string[], matchPhase: string | null): boolean {
  return penaltyPhases.includes(matchPhase ?? '')
}

/**
 * Se o jogo decide nos pênaltis quando termina empatado. A volta de um confronto
 * sempre decide pelo agregado, a ida nunca, e o jogo único segue `penalty_phases`.
 * Sem papel no confronto (fora do mata-mata), vale a regra do jogo único.
 */
export function decidesOnPenalties(
  tieRole: TieRole | undefined,
  penaltyPhases: string[],
  phase: string | null,
): boolean {
  if (tieRole === 'leg2') return true
  if (tieRole === 'leg1') return false
  return matchGoesToPenalties(penaltyPhases, phase)
}

/**
 * Parses the competitions.penalty_phases TEXT column (JSON) into a string[].
 * Anything malformed or non-array (incl. the '[]' default) yields an empty list,
 * keeping the gate fail-closed. Parsed in the Worker — no SQL json_each/LIKE.
 */
export function parsePenaltyPhases(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? (parsed.filter((item) => typeof item === 'string') as string[])
      : []
  } catch {
    return []
  }
}
