export type ScoringPreset = 'classic' | 'exact_only' | 'winner_only' | 'custom'

export const PRESET_VALUES: Record<
  Exclude<ScoringPreset, 'custom'>,
  { exact: number; winner: number; penalty: number }
> = {
  // penalty = 1 em todos os presets (bônus aditivo, independente do placar exato).
  classic: { exact: 3, winner: 1, penalty: 1 },
  exact_only: { exact: 3, winner: 0, penalty: 1 },
  // "Só vencedor": sem bônus por placar exato (points_exact = 0). Ativa a UI 1X2
  // (Casa / Empate / Fora) no palpite.
  winner_only: { exact: 0, winner: 1, penalty: 1 },
}

export const SCORING_HELP_TEXT: Record<'exact' | 'winner', string> = {
  exact:
    'Placar exato: pontos para quem crava o placar da partida (ex.: 2 a 1).',
  winner:
    'Vencedor: pontos para quem acerta só o resultado — mandante, visitante ou empate — sem cravar o placar.',
}

export const PRESET_LABELS: Record<ScoringPreset, string> = {
  classic: 'Clássico',
  exact_only: 'Só placar exato',
  winner_only: 'Só vencedor',
  custom: 'Personalizado',
}
