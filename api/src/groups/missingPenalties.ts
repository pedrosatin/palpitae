import { matchGoesToPenalties, parsePenaltyPhases } from '../matches/penalties'
import { fetchTieMatches, indexTies, type TieInfo, type TieMatch } from '../matches/ties'
import { penaltyPickNeeded } from '../predictions/penaltyPick'
import type { PenaltyCandidate } from './pendingPredictions'

/** Grupo em andamento com os candidatos de `pendingSummarySql`. */
export type PenaltyCheckGroup = {
  id: string
  competition_id: string
  penalty_phases: string | null
  candidates: readonly PenaltyCandidate[]
}

type SavedPick = {
  home: number
  away: number
  penaltyWinner: 'home' | 'away' | null
}

/** Papel e par de cada jogo de mata-mata das competições, uma consulta por competição. */
async function tiesByCompetition(
  db: D1Database,
  groups: readonly PenaltyCheckGroup[],
): Promise<Map<string, Map<string, TieInfo<TieMatch>>>> {
  const phases = new Map<string, Set<string>>()
  for (const group of groups) {
    const set = phases.get(group.competition_id) ?? new Set<string>()
    for (const candidate of group.candidates) set.add(candidate.phase)
    phases.set(group.competition_id, set)
  }
  const entries = await Promise.all(
    [...phases].map(async ([competitionId, set]) => {
      const matches = await fetchTieMatches(db, competitionId, set)
      return [competitionId, indexTies(matches)] as const
    }),
  )
  return new Map(entries)
}

/** Palpites do usuário nos jogos dos grupos, pela chave `grupo|jogo`, numa consulta só. */
async function fetchSavedPicks(
  db: D1Database,
  userId: string,
  pairs: ReadonlyArray<{ groupId: string; matchId: string }>,
): Promise<Map<string, SavedPick>> {
  const picks = new Map<string, SavedPick>()
  const groupIds = [...new Set(pairs.map((pair) => pair.groupId))]
  const matchIds = [...new Set(pairs.map((pair) => pair.matchId))]
  const { results } = await db
    .prepare(
      `SELECT group_id, match_id, predicted_home_score, predicted_away_score, predicted_penalty_winner
       FROM predictions
       WHERE user_id = ?
         AND group_id IN (SELECT value FROM json_each(?))
         AND match_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(userId, JSON.stringify(groupIds), JSON.stringify(matchIds))
    .all<{
      group_id: string
      match_id: string
      predicted_home_score: number
      predicted_away_score: number
      predicted_penalty_winner: 'home' | 'away' | null
    }>()
  for (const row of results) {
    picks.set(`${row.group_id}|${row.match_id}`, {
      home: row.predicted_home_score,
      away: row.predicted_away_score,
      penaltyWinner: row.predicted_penalty_winner,
    })
  }
  return picks
}

/**
 * Palpites salvos em que falta o vencedor dos pênaltis, por grupo. O card da aba
 * Palpitar mostra "falta pênalti" neles e o contador da rodada não os conta como
 * palpitados. O painel segue a mesma regra, `penaltyPickNeeded`.
 *
 * O papel no confronto vem de `indexTies`, como em `GET /matches`, e a ida vem
 * do palpite salvo do usuário no mesmo grupo. Sem candidato, não consulta nada.
 */
export async function missingPenalties(
  db: D1Database,
  userId: string,
  groups: readonly PenaltyCheckGroup[],
): Promise<Map<string, PenaltyCandidate[]>> {
  const missing = new Map<string, PenaltyCandidate[]>()
  const withCandidates = groups.filter((group) => group.candidates.length > 0)
  if (withCandidates.length === 0) return missing

  const ties = await tiesByCompetition(db, withCandidates)
  const tieOf = (group: PenaltyCheckGroup, matchId: string) =>
    ties.get(group.competition_id)?.get(matchId)
  const leg1Of = (group: PenaltyCheckGroup, matchId: string) => {
    const tie = tieOf(group, matchId)
    return tie?.role === 'leg2' ? tie.partner?.id : undefined
  }

  const picks = await fetchSavedPicks(
    db,
    userId,
    withCandidates.flatMap((group) =>
      group.candidates.flatMap(({ match_id }) => {
        const leg1 = leg1Of(group, match_id)
        return [match_id, ...(leg1 ? [leg1] : [])].map((matchId) => ({
          groupId: group.id,
          matchId,
        }))
      }),
    ),
  )

  for (const group of withCandidates) {
    const penaltyPhases = parsePenaltyPhases(group.penalty_phases)
    const list = group.candidates.filter((candidate) => {
      const pick = picks.get(`${group.id}|${candidate.match_id}`)
      if (!pick || pick.penaltyWinner) return false
      const leg1 = leg1Of(group, candidate.match_id)
      const leg1Pick = leg1 ? picks.get(`${group.id}|${leg1}`) : undefined
      return penaltyPickNeeded({
        eligible: matchGoesToPenalties(penaltyPhases, candidate.phase),
        role: tieOf(group, candidate.match_id)?.role ?? 'single',
        home: pick.home,
        away: pick.away,
        leg1Score: leg1Pick ? { homeScore: leg1Pick.home, awayScore: leg1Pick.away } : null,
      })
    })
    if (list.length > 0) missing.set(group.id, list)
  }
  return missing
}
