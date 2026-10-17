/**
 * Fonte de verdade dos rótulos de exibição de fase/rodada.
 *
 * O `round` cru é um detalhe do provider: na football-data as rodadas de grupo
 * vêm numéricas ("1".."8") e as fases de mata-mata vêm como `stage` ("LAST_32",
 * ...); nas copas da ESPN tanto a fase de grupos ("GROUP_STAGE") quanto as fases
 * preliminares e eliminatórias entram como código canônico. Traduzir isso para
 * um rótulo PT-BR é decisão de domínio compartilhada por dois consumidores — o
 * e-mail de lembrete (`roundReminder.ts`) e a resposta de `GET /matches`
 * (`router.ts`, campo `round_label`, consumido pelo front). Por isso o mapa
 * vive aqui, no back, e não duplicado no front.
 */
const KNOCKOUT_LABELS: Record<string, string> = {
  GROUP_STAGE: 'Fase de grupos',
  FIRST_STAGE: '1ª fase',
  SECOND_STAGE: '2ª fase',
  THIRD_STAGE: '3ª fase',
  FIRST_ROUND: '1ª fase',
  SECOND_ROUND: '2ª fase',
  THIRD_ROUND: '3ª fase',
  FOURTH_ROUND: '4ª fase',
  FIFTH_ROUND: '5ª fase',
  PLAYOFFS: 'Playoffs',
  LAST_32: 'Rodada de 32',
  LAST_16: 'Oitavas de final',
  QUARTER_FINALS: 'Quartas de final',
  SEMI_FINALS: 'Semifinais',
  THIRD_PLACE: 'Terceiro lugar',
  FINAL: 'Final',
}

/**
 * Rótulo de exibição de uma rodada. Rodada numérica → "Rodada N"; fase de mata-mata
 * conhecida → rótulo do mapa; desconhecida → o valor cru (fail-safe, nunca quebra).
 */
export function roundLabel(round: string): string {
  if (/^\d+$/.test(round)) return `Rodada ${round}`
  return KNOCKOUT_LABELS[round] ?? round
}
