/** Limiares de placares exatos no grupo (mesmos da API: 5, 15 e 30). */
export const EXACT_MILESTONES = [5, 15, 30] as const

export type ExactMilestone = (typeof EXACT_MILESTONES)[number]

/** Marcos atingidos até o total informado, em ordem crescente. */
export function achievedExactMilestones(exactHits: number): ExactMilestone[] {
  return EXACT_MILESTONES.filter((threshold) => exactHits >= threshold)
}

/** Maior limiar atingido, ou `null` abaixo de 5. */
export function highestExactMilestoneFromHits(exactHits: number): ExactMilestone | null {
  const achieved = achievedExactMilestones(exactHits)
  return achieved.length === 0 ? null : achieved[achieved.length - 1]
}

/** Rótulo curto do selo no ranking, ex.: `15 exatos`. */
export function exactMilestoneBadgeLabel(milestone: ExactMilestone): string {
  return `${milestone} exatos`
}

/** Lista os marcos para `title` e leitor de tela. */
export function exactMilestonesTitle(milestones: ExactMilestone[]): string {
  if (milestones.length === 0) return ''
  if (milestones.length === 1) {
    return `Marco de ${milestones[0]} placares exatos neste grupo`
  }
  const head = milestones.slice(0, -1).join(', ')
  const last = milestones[milestones.length - 1]
  return `Marcos de ${head} e ${last} placares exatos neste grupo`
}

/** Frase do resumo (segunda pessoa) quando a rodada cruza um ou mais limiares. */
export function exactMilestoneHighlightText(crossed: ExactMilestone[]): string | null {
  if (crossed.length === 0) return null
  if (crossed.length === 1) {
    return `Você cruzou o marco de ${crossed[0]} placares exatos neste grupo`
  }
  const head = crossed.slice(0, -1).join(', ')
  const last = crossed[crossed.length - 1]
  return `Você cruzou os marcos de ${head} e ${last} placares exatos neste grupo`
}

/**
 * Frase do texto compartilhado em primeira pessoa: quem lê é o destinatário.
 */
export function exactMilestoneShareHighlightText(crossed: ExactMilestone[]): string | null {
  if (crossed.length === 0) return null
  if (crossed.length === 1) {
    return `Cruzei o marco de ${crossed[0]} placares exatos neste grupo`
  }
  const head = crossed.slice(0, -1).join(', ')
  const last = crossed[crossed.length - 1]
  return `Cruzei os marcos de ${head} e ${last} placares exatos neste grupo`
}
