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
 *
 * Cada rótulo leva a concordância de gênero e número, que o painel usa para
 * escrever "Semifinais completas" ou "Terceiro lugar completo". Quem renomeia
 * um rótulo revê a concordância na mesma linha, e `rounds.test.ts` fixa os pares.
 */

/** Gênero e número do rótulo: feminino ou masculino, singular ou plural. */
export type RoundAgreement = 'fs' | 'fp' | 'ms' | 'mp'

const KNOCKOUT_LABELS: Record<string, { label: string; agreement: RoundAgreement }> = {
  GROUP_STAGE: { label: 'Fase de grupos', agreement: 'fs' },
  REGULAR_SEASON: { label: 'Temporada regular', agreement: 'fs' },
  LEAGUE_PHASE: { label: 'Fase de pontos', agreement: 'fs' },
  TACA_GUANABARA: { label: 'Taça Guanabara', agreement: 'fs' },
  RELEGATION_STAGE: { label: 'Rebaixamento', agreement: 'ms' },
  FIRST_STAGE: { label: '1ª fase', agreement: 'fs' },
  SECOND_STAGE: { label: '2ª fase', agreement: 'fs' },
  THIRD_STAGE: { label: '3ª fase', agreement: 'fs' },
  FIRST_ROUND: { label: '1ª fase', agreement: 'fs' },
  SECOND_ROUND: { label: '2ª fase', agreement: 'fs' },
  THIRD_ROUND: { label: '3ª fase', agreement: 'fs' },
  FOURTH_ROUND: { label: '4ª fase', agreement: 'fs' },
  FIFTH_ROUND: { label: '5ª fase', agreement: 'fs' },
  PLAYOFFS: { label: 'Playoffs', agreement: 'mp' },
  LAST_32: { label: 'Rodada de 32', agreement: 'fs' },
  LAST_16: { label: 'Oitavas de final', agreement: 'fp' },
  QUARTER_FINALS: { label: 'Quartas de final', agreement: 'fp' },
  SEMI_FINALS: { label: 'Semifinais', agreement: 'fp' },
  THIRD_PLACE: { label: 'Terceiro lugar', agreement: 'ms' },
  FINAL: { label: 'Final', agreement: 'fs' },
  TACA_GUANABARA_QUARTER_FINALS: { label: 'Quartas da Taça Guanabara', agreement: 'fp' },
  TACA_GUANABARA_SEMI_FINALS: { label: 'Semifinais da Taça Guanabara', agreement: 'fp' },
  TACA_GUANABARA_FINAL: { label: 'Final da Taça Guanabara', agreement: 'fs' },
  TACA_RIO_SEMI_FINALS: { label: 'Semifinais da Taça Rio', agreement: 'fp' },
  TACA_RIO_FINAL: { label: 'Final da Taça Rio', agreement: 'fs' },
  TROFEU_INCONFIDENCIA_SEMI_FINALS: {
    label: 'Semifinais do Troféu Inconfidência',
    agreement: 'fp',
  },
  TROFEU_INCONFIDENCIA_FINAL: { label: 'Final do Troféu Inconfidência', agreement: 'fs' },
  PLAYOFFS_SEMI_FINALS: { label: 'Semifinais dos playoffs', agreement: 'fp' },
  PLAYOFFS_FINAL: { label: 'Final dos playoffs', agreement: 'fs' },
  FARROUPILHA_SEMI_FINALS: { label: 'Semifinais do Farroupilha', agreement: 'fp' },
  FARROUPILHA_FINAL: { label: 'Final do Farroupilha', agreement: 'fs' },
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
  return Object.hasOwn(KNOCKOUT_LABELS, round) ? KNOCKOUT_LABELS[round].label : round
}

/**
 * Concordância do rótulo de `roundLabel`. Null quando a rodada é desconhecida e o
 * rótulo é o valor cru, que os resumos do painel não mostram.
 */
export function roundAgreement(round: string): RoundAgreement | null {
  if (/^\d+$/.test(round)) return 'fs'
  return Object.hasOwn(KNOCKOUT_LABELS, round) ? KNOCKOUT_LABELS[round].agreement : null
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

/** Os códigos de rodada com rótulo no mapa, para o teste que fixa rótulo e concordância. */
export const LABELED_ROUNDS: readonly string[] = Object.keys(KNOCKOUT_LABELS)

/** As fases em que `isKnockoutPhase` dá verdadeiro, para filtros em SQL. */
export const KNOCKOUT_PHASES: readonly string[] = Object.keys(KNOCKOUT_LABELS).filter(
  isKnockoutPhase,
)

interface RoundMatch {
  round: string
  phase: string | null
  start_time: string
}

function roundStage(match: RoundMatch): string {
  return /^\d+$/.test(match.round) && !isKnockoutPhase(match.phase)
    ? 'points'
    : `round:${match.round}`
}

/**
 * Ordena as rodadas para a navegação. As rodadas numéricas fora do mata-mata
 * formam uma só sequência, em ordem numérica, que jogo antecipado ou adiado não
 * altera. Essa sequência e as rodadas nomeadas seguem a menor data; no empate,
 * vem a que aparece primeiro na entrada. Rodadas prefixadas (`FASE_N`) seguem a
 * menor data, então um jogo antecipado pode reordená-las. Jogos da mesma rodada
 * mantêm a ordem recebida. As duas listagens HTTP usam esta ordem, que o cliente
 * consome sem reordenar.
 */
export function orderByRound<T extends RoundMatch>(matches: T[]): T[] {
  const firstDate = new Map<string, string>()
  const stageIndex = new Map<string, number>()
  for (const match of matches) {
    const stage = roundStage(match)
    if (!stageIndex.has(stage)) stageIndex.set(stage, stageIndex.size)
    const current = firstDate.get(stage)
    if (current === undefined || match.start_time < current) firstDate.set(stage, match.start_time)
  }
  const rounds = [...new Map(matches.map((m) => [m.round, m])).values()]
  rounds.sort((a, b) => {
    const stageA = roundStage(a)
    const stageB = roundStage(b)
    if (stageA === stageB) return Number(a.round) - Number(b.round)
    return (
      firstDate.get(stageA)!.localeCompare(firstDate.get(stageB)!) ||
      stageIndex.get(stageA)! - stageIndex.get(stageB)!
    )
  })
  const indexes = new Map(rounds.map((m, i) => [m.round, i]))
  return [...matches].sort((a, b) => indexes.get(a.round)! - indexes.get(b.round)!)
}
