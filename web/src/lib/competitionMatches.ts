import { queryOptions } from '@tanstack/react-query'
import { buildApiUrl } from '../config'
import type { Match } from '../components/MatchCard/types'
import { apiFetch } from './api'
import { applyDefaultRound } from './rounds'

export type CompetitionMatchesResponse = {
  matches: Match[]
  default_round: string | null
}

export const MATCHES_STALE_TIME_MS = 30_000

/** Busca a lista de partidas da competição. */
export function fetchCompetitionMatches(
  competitionId: string,
): Promise<CompetitionMatchesResponse> {
  return apiFetch(
    buildApiUrl(
      '/matches',
      new URLSearchParams({ competition_id: competitionId, round_order: '1' }),
    ),
  ).then((r) => {
    if (!r.ok) throw new Error('Erro ao carregar jogos')
    return r.json() as Promise<CompetitionMatchesResponse>
  })
}

/**
 * Opções da query de partidas. As abas Palpites, Palpites do grupo e Tabela
 * compartilham a query `['matches', competitionId]` com staleTime de 30s.
 */
export function competitionMatchesQueryOptions(competitionId: string) {
  return queryOptions({
    queryKey: ['matches', competitionId] as const,
    staleTime: MATCHES_STALE_TIME_MS,
    queryFn: () => {
      return fetchCompetitionMatches(competitionId)
    },
  })
}

export function matchesQueryErrorMessage(error: unknown, isError: boolean): string | null {
  if (error instanceof Error) return error.message
  if (isError) return 'Erro ao carregar jogos'
  return null
}

/**
 * Points `setRoundIndex` at the competition's default round given the freshly
 * fetched matches: derive the distinct rounds in order, then defer to
 * `applyDefaultRound`. Both the predictions and group-picks tabs ran this
 * inline after loading matches.
 *
 * `requestedRound` vem do `?rodada=` do link do painel. Se a rodada existe na
 * competição, ela vence a rodada padrão. Senão o link cai na padrão.
 */
export function applyDefaultRoundFromMatches(
  matches: Match[],
  defaultRound: string | null | undefined,
  setRoundIndex: (i: number) => void,
  requestedRound?: string | null,
): void {
  const rounds = [...new Set(matches.map((m) => m.round))]
  const round = requestedRound && rounds.includes(requestedRound) ? requestedRound : defaultRound
  applyDefaultRound(round, rounds, setRoundIndex)
}
