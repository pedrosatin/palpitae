/** Limiares da API (auditoria 01 / ADR-029): no máximo 10% com pelo menos 10 palpiteiros. */

export const UNLIKELY_EXACT_BADGE_LABEL = 'improvável'

/** Title e texto para leitor de tela do selo no ranking. */
export function unlikelyExactBadgeTitle(percent: number | null | undefined): string {
  if (percent == null) {
    return 'Placar exato improvável na competição nesta rodada'
  }
  return `Placar exato que só ${percent}% dos palpiteiros da competição cravaram nesta rodada`
}

/** Frase do resumo (segunda pessoa) quando a rodada de referência tem placar raro. */
export function unlikelyExactHighlightText(percent: number | null | undefined): string | null {
  if (percent == null) return null
  return `Você cravou um placar improvável: só ${percent}% dos palpiteiros da competição acertaram`
}

/** Frase do texto compartilhado em primeira pessoa. */
export function unlikelyExactShareHighlightText(percent: number | null | undefined): string | null {
  if (percent == null) return null
  return `Cravei um placar improvável: só ${percent}% dos palpiteiros da competição acertaram`
}
