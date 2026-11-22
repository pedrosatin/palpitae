/** Limiares públicos da API (auditoria 01 / ADR-029): no máximo 10% com pelo menos 10 palpiteiros. */

export const UNLIKELY_EXACT_BADGE_LABEL = 'improvável'

export const UNLIKELY_EXACT_THRESHOLD_PERCENT = 10

/** Title e texto para leitor de tela do selo no ranking. */
export function unlikelyExactBadgeTitle(): string {
  return `Placar exato que no máximo ${UNLIKELY_EXACT_THRESHOLD_PERCENT}% dos palpiteiros da competição cravaram nesta rodada`
}

/** Frase do resumo (segunda pessoa) quando a rodada de referência tem placar raro. */
export function unlikelyExactHighlightText(hasUnlikelyExact: boolean): string | null {
  if (!hasUnlikelyExact) return null
  return `Você cravou um placar improvável: no máximo ${UNLIKELY_EXACT_THRESHOLD_PERCENT}% dos palpiteiros da competição acertaram`
}

/** Frase do texto compartilhado em primeira pessoa. */
export function unlikelyExactShareHighlightText(hasUnlikelyExact: boolean): string | null {
  if (!hasUnlikelyExact) return null
  return `Cravei um placar improvável: no máximo ${UNLIKELY_EXACT_THRESHOLD_PERCENT}% dos palpiteiros da competição acertaram`
}
