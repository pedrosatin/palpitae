import { isKnockoutPhase } from './rounds'

/**
 * Identificação dos jogos de um confronto de mata-mata.
 *
 * O par de um jogo é o outro jogo da mesma competição e da mesma fase com os
 * times invertidos. Quando o provider informa `leg` (a ESPN manda), o valor é
 * usado. Sem `leg` (a football-data não manda), a ida é o jogo do par com
 * `start_time` anterior. Jogo de mata-mata sem par é jogo único.
 *
 * Fora do mata-mata não há confronto: em fase de grupos ou liga os mesmos times
 * se enfrentam com mando invertido e isso não forma ida e volta.
 */

export type TieMatch = {
  id: string
  competition_id: string
  phase: string | null
  home_team_id: string
  away_team_id: string
  start_time: string
  leg: 1 | 2 | null
}

export type TieRole = 'leg1' | 'leg2' | 'single'

export type TieInfo<T extends TieMatch> = {
  role: TieRole
  partner: T | null
}

function tieKey(competitionId: string, phase: string, homeTeamId: string, awayTeamId: string) {
  return `${competitionId}:${phase}:${homeTeamId}:${awayTeamId}`
}

/** Papel do jogo no confronto, dado o par já encontrado (ou null). */
export function resolveTieRole(match: TieMatch, partner: TieMatch | null): TieRole {
  if (match.leg === 1) return 'leg1'
  if (match.leg === 2) return 'leg2'
  if (!partner) return 'single'
  if (match.start_time !== partner.start_time) {
    return match.start_time < partner.start_time ? 'leg1' : 'leg2'
  }
  // Mesmo horário só acontece com dado ruim; o id desempata de forma estável.
  return match.id < partner.id ? 'leg1' : 'leg2'
}

/**
 * Indexa o papel e o par de cada jogo de mata-mata da lista. Jogos fora do
 * mata-mata não entram no mapa.
 */
export function indexTies<T extends TieMatch>(matches: T[]): Map<string, TieInfo<T>> {
  const byKey = new Map<string, T>()
  for (const m of matches) {
    if (!isKnockoutPhase(m.phase)) continue
    const key = tieKey(m.competition_id, m.phase as string, m.home_team_id, m.away_team_id)
    if (!byKey.has(key)) byKey.set(key, m)
  }

  const ties = new Map<string, TieInfo<T>>()
  for (const m of matches) {
    if (!isKnockoutPhase(m.phase)) continue
    const candidate = byKey.get(
      tieKey(m.competition_id, m.phase as string, m.away_team_id, m.home_team_id),
    )
    const partner = candidate && candidate.id !== m.id ? candidate : null
    ties.set(m.id, { role: resolveTieRole(m, partner), partner })
  }
  return ties
}

/**
 * Busca os jogos das fases de mata-mata informadas de uma competição, base para
 * `indexTies`. Fases fora do mata-mata são ignoradas.
 */
export async function fetchTieMatches<T extends TieMatch = TieMatch>(
  db: D1Database,
  competitionId: string,
  phases: Iterable<string | null | undefined>,
  extraColumns: readonly string[] = [],
): Promise<T[]> {
  const knockoutPhases = Array.from(new Set(phases)).filter(isKnockoutPhase) as string[]
  if (knockoutPhases.length === 0) return []

  const columns = [
    'id',
    'competition_id',
    'phase',
    'home_team_id',
    'away_team_id',
    'start_time',
    'leg',
    ...extraColumns,
  ].join(', ')
  const { results } = await db
    .prepare(
      `SELECT ${columns}
       FROM matches
       WHERE competition_id = ? AND phase IN (SELECT value FROM json_each(?))`,
    )
    .bind(competitionId, JSON.stringify(knockoutPhases))
    .all<T>()
  return results
}
