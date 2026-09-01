import { describe, it, expect } from 'vitest';
import { PRESET_VALUES, SCORING_HELP_TEXT, PRESET_LABELS } from './constants';

describe('constants', () => {
  it('should have the correct PRESET_VALUES', () => {
    expect(PRESET_VALUES).toEqual({
      classic: { exact: 3, winner: 1, penalty: 1 },
      exact_only: { exact: 3, winner: 0, penalty: 1 },
      winner_only: { exact: 0, winner: 1, penalty: 1 },
    });
  });

  it('should have the correct SCORING_HELP_TEXT', () => {
    expect(SCORING_HELP_TEXT).toEqual({
      exact: 'Placar exato: pontos para quem crava o placar da partida (ex.: 2 a 1).',
      winner: 'Vencedor: pontos para quem acerta só o resultado — mandante, visitante ou empate — sem cravar o placar.',
    });
  });

  it('should have the correct PRESET_LABELS', () => {
    expect(PRESET_LABELS).toEqual({
      classic: 'Clássico',
      exact_only: 'Só placar exato',
      winner_only: 'Só vencedor',
      custom: 'Personalizado',
    });
  });
});
