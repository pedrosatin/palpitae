export type ScoringPreset = 'classic' | 'exact_only' | 'winner_only' | 'custom'

export const PRESET_VALUES: Record<
  Exclude<ScoringPreset, 'custom'>,
  { exact: number; winner: number; penalty: number }
> = {
  classic: { exact: 3, winner: 1, penalty: 1 },
  exact_only: { exact: 3, winner: 0, penalty: 1 },
  winner_only: { exact: 0, winner: 1, penalty: 1 },
}

interface ScoringDefaults {
  preset: ScoringPreset
  exact: number
  winner: number
  penalty: number
  classified: number
}

export const DEFAULT_SCORING: ScoringDefaults = {
  preset: 'classic',
  ...PRESET_VALUES.classic,
  classified: 0,
}

export const SCORING_HELP_TEXT: Record<'exact' | 'winner', string> = {
  exact: 'Placar exato: pontos para quem crava o placar da partida (ex.: 2 a 1).',
  winner:
    'Vencedor: pontos para quem acerta só o resultado — mandante, visitante ou empate — sem cravar o placar.',
}

export const PRESET_LABELS: Record<ScoringPreset, string> = {
  classic: 'Clássico',
  exact_only: 'Só placar exato',
  winner_only: 'Só vencedor',
  custom: 'Personalizado',
}
