export interface GroupRulesInput {
  points_exact: number
  points_winner: number
  points_penalty?: number
  points_classified?: number
  predictions_visibility: string
  competition_type: 'league' | 'cup' | null
}

export interface GroupRules {
  scoring: string[]
  bonuses: string[]
  lock: string
  visibility: string
  period: string
  tiebreak: string[]
}

function pontos(value: number): string {
  return value === 1 ? '1 ponto' : `${value} pontos`
}

function scoringLines(exact: number, winner: number): string[] {
  if (exact === 0) {
    return [`Acertar quem vence ou o empate vale ${pontos(winner)}.`]
  }
  const lines = [`Placar exato vale ${pontos(exact)}.`]
  lines.push(
    winner > 0
      ? `Acertar só o resultado, sem o placar, vale ${pontos(winner)}.`
      : 'Acertar só o resultado, sem o placar, não pontua.',
  )
  return lines
}

function bonusLines(rules: GroupRulesInput): string[] {
  if (rules.competition_type !== 'cup') return []
  const lines: string[] = []
  const classified = rules.points_classified ?? 0
  const penalty = rules.points_penalty ?? 0
  if (classified > 0) {
    lines.push(
      `Classificado vale mais ${pontos(classified)} por acertar quem avança no confronto. Seus palpites definem o classificado. Em ida e volta, sem palpite em um dos jogos, o bônus não conta.`,
    )
  }
  if (penalty > 0) {
    lines.push(
      `Pênaltis valem mais ${pontos(penalty)} por acertar o vencedor da disputa quando seu palpite empata o jogo único ou o agregado da ida e volta.`,
    )
  }
  return lines
}

/**
 * A ordem espelha `ORDER BY total_points DESC, exact_hits DESC, joined_at ASC`
 * do ranking. Os exatos só contam quando o placar exato vale mais que o
 * resultado (ver docs/group-scoring.md).
 */
export function tiebreakCriteria(exact: number, winner: number): string[] {
  const criteria = ['mais pontos']
  if (exact > winner) criteria.push('mais placares exatos')
  criteria.push('quem entrou primeiro no grupo')
  return criteria
}

export function tiebreakSummary(exact: number, winner: number): string {
  return `Ordem do ranking: ${tiebreakCriteria(exact, winner).join(', depois ')}.`
}

export function buildGroupRules(input: GroupRulesInput): GroupRules {
  return {
    scoring: scoringLines(input.points_exact, input.points_winner),
    bonuses: bonusLines(input),
    lock: 'Cada palpite trava no início do jogo. Até lá você pode mudar quantas vezes quiser.',
    visibility:
      input.predictions_visibility === 'public'
        ? 'Os palpites de todos ficam visíveis o tempo todo.'
        : 'Os palpites dos outros só aparecem depois que o jogo começa.',
    period:
      input.competition_type === 'league'
        ? 'Vale o placar final, com os acréscimos.'
        : 'Vale o placar do tempo normal mais a prorrogação, quando houver. Os gols da disputa de pênaltis não entram no placar.',
    tiebreak: tiebreakCriteria(input.points_exact, input.points_winner),
  }
}
