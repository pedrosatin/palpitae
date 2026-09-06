import { config } from '../config'
import type { Match } from '../components/MatchCard'
import { apiFetch } from './api'
import { fetchCachedJson } from './api-cache'
import { applyDefaultRound } from './rounds'

export type CompetitionMatchesResponse = {
  matches: Match[]
  default_round: string | null
}

/**
 * Fetches (and briefly caches) the match list for a competition. The
 * predictions, group-picks and standings tabs all hit `GET /matches` with the
 * same `matches:<competitionId>` cache key and 30s TTL — this is that call in
 * one place.
 */
export function fetchCompetitionMatches(
  competitionId: string,
): Promise<CompetitionMatchesResponse> {
  return fetchCachedJson(
    `matches:${competitionId}`,
    () =>
      apiFetch(`${config.apiUrl}/matches?competition_id=${encodeURIComponent(competitionId)}`).then(
        (r) => {
          if (!r.ok) throw new Error('Erro ao carregar jogos')
          return r.json() as Promise<CompetitionMatchesResponse>
        },
      ),
    30_000,
  )
}

/**
 * Points `setRoundIndex` at the competition's default round given the freshly
 * fetched matches: derive the distinct rounds in order, then defer to
 * `applyDefaultRound`. Both the predictions and group-picks tabs ran this
 * inline after loading matches.
 */
export function applyDefaultRoundFromMatches(
  matches: Match[],
  defaultRound: string | null | undefined,
  setRoundIndex: (i: number) => void,
): void {
  const rounds = [...new Set(matches.map((m) => m.round))]
  applyDefaultRound(defaultRound, rounds, setRoundIndex)
}
