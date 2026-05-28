import type { Round } from './types'

export const ROUND_LABELS: Record<Round, string> = {
  LAST_32: '16 avos',
  LAST_16: 'Oitavas',
  QUARTER_FINALS: 'Quartas',
  SEMI_FINALS: 'Semi',
  FINAL: 'Final',
  THIRD_PLACE: '3º Lugar',
}

/** Max teams per group that can advance from group stage (top 2 + up to 1 best-third) */
export const MAX_PICKS_PER_GROUP_R32 = 3

// WC2026: 32 teams in knockouts → 8 slots per side in R32
export const LEFT_BRACKET_ROUNDS: Round[] = ['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS']
export const RIGHT_BRACKET_ROUNDS: Round[] = ['SEMI_FINALS', 'QUARTER_FINALS', 'LAST_16', 'LAST_32']

/** Number of slots per side per round (WC2026 format) */
export const HALF_SLOTS: Partial<Record<Round, number>> = {
  LAST_32: 8,
  LAST_16: 4,
  QUARTER_FINALS: 2,
  SEMI_FINALS: 1,
}

/** Base height (px) per R32 slot; other rounds scale as powers of 2 */
export const SLOT_BASE_HEIGHT = 76

/** Which round feeds into each round */
export const PREV_ROUND: Partial<Record<Round, Round>> = {
  LAST_16: 'LAST_32',
  QUARTER_FINALS: 'LAST_16',
  SEMI_FINALS: 'QUARTER_FINALS',
  FINAL: 'SEMI_FINALS',
  THIRD_PLACE: 'SEMI_FINALS',
}
