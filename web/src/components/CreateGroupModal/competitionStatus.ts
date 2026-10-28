import type { Competition } from './types'

export type CompetitionSelectGroups = {
  /** Competições com jogos já em disputa (pode palpitar as rodadas que faltam). */
  ongoing: Competition[]
  /** Competições que ainda não começaram (todos os jogos ainda por vir). */
  upcoming: Competition[]
}

/**
 * Select de criação de grupo: competições encerradas não fazem sentido (não há
 * como palpitar jogos que já aconteceram), então saem da lista. As elegíveis
 * voltam separadas para os <optgroup> do select — "Em andamento" primeiro.
 * A ordem interna de cada grupo é preservada (a API já ordena por nome).
 */
export function partitionSelectableCompetitions(
  competitions: Competition[],
): CompetitionSelectGroups {
  const groups: CompetitionSelectGroups = { ongoing: [], upcoming: [] }
  for (const competition of competitions) {
    if (competition.status === 'finished') continue
    if (competition.status === 'ongoing') groups.ongoing.push(competition)
    else groups.upcoming.push(competition)
  }
  return groups
}

/** Lista única do select: andamento primeiro, depois as por começar. */
export function selectableCompetitions(
  competitions: Competition[],
): { list: Competition[]; groups: CompetitionSelectGroups } {
  const groups = partitionSelectableCompetitions(competitions)
  return { list: [...groups.ongoing, ...groups.upcoming], groups }
}
