/**
 * Fonte de verdade dos rótulos de exibição de fase/rodada.
 *
 * O `round` cru depende do provider. Na football-data as rodadas de grupo vêm
 * numéricas de "1" a "8" e as fases de mata-mata vêm como `stage` a exemplo de
 * "LAST_32". Nas copas da ESPN tanto a fase de grupos "GROUP_STAGE" quanto as
 * fases preliminares e eliminatórias entram como código canônico. Traduzir isso
 * para um rótulo PT-BR é decisão de domínio compartilhada pelo e-mail de
 * lembrete em `roundReminder.ts` e pela resposta de `GET /matches` em
 * `router.ts` no campo `round_label`. Por isso o mapa vive no back e não é
 * duplicado no front.
 */
const KNOCKOUT_LABELS: Record<string, string> = {
  GROUP_STAGE: 'Fase de grupos',
  REGULAR_SEASON: 'Temporada regular',
  LEAGUE_PHASE: 'Fase de pontos',
  TACA_GUANABARA: 'Taça Guanabara',
  RELEGATION_STAGE: 'Rebaixamento',
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
  TACA_GUANABARA_QUARTER_FINALS: 'Quartas da Taça Guanabara',
  TACA_GUANABARA_SEMI_FINALS: 'Semifinais da Taça Guanabara',
  TACA_GUANABARA_FINAL: 'Final da Taça Guanabara',
  TACA_RIO_SEMI_FINALS: 'Semifinais da Taça Rio',
  TACA_RIO_FINAL: 'Final da Taça Rio',
  TROFEU_INCONFIDENCIA_SEMI_FINALS: 'Semifinais do Troféu Inconfidência',
  TROFEU_INCONFIDENCIA_FINAL: 'Final do Troféu Inconfidência',
  PLAYOFFS_SEMI_FINALS: 'Semifinais dos playoffs',
  PLAYOFFS_FINAL: 'Final dos playoffs',
  FARROUPILHA_SEMI_FINALS: 'Semifinais do Farroupilha',
  FARROUPILHA_FINAL: 'Final do Farroupilha',
}

/** Fases de pontos/grupos no mapa de rótulos que não são mata-mata. */
const NON_KNOCKOUT_PHASES = new Set([
  'GROUP_STAGE',
  'REGULAR_SEASON',
  'LEAGUE_PHASE',
  'TACA_GUANABARA',
  'RELEGATION_STAGE',
])

/**
 * Rótulo de exibição de uma rodada. Rodada numérica → "Rodada N"; fase de mata-mata
 * conhecida → rótulo do mapa; desconhecida → o valor cru (fail-safe, nunca quebra).
 */
export function roundLabel(round: string): string {
  if (/^\d+$/.test(round)) return `Rodada ${round}`
  return KNOCKOUT_LABELS[round] ?? round
}

/**
 * Fase eliminatória (mata-mata): qualquer fase conhecida do mapa acima, menos
 * fases de pontos/grupos. Rodadas numéricas, GROUP_STAGE, LEAGUE_PHASE,
 * REGULAR_SEASON, TACA_GUANABARA, RELEGATION_STAGE e fases desconhecidas ficam
 * de fora (fail-closed).
 */
export function isKnockoutPhase(phase: string | null | undefined): boolean {
  if (!phase || NON_KNOCKOUT_PHASES.has(phase)) return false
  return Object.hasOwn(KNOCKOUT_LABELS, phase)
}
