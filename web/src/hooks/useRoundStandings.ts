import { useQuery } from '@tanstack/react-query'
import { buildApiUrl } from '../config'
import { apiFetch } from '../lib/api'

export interface RoundStanding {
  user_id: string
  round_points: number
  position_change: number | null
  streak: number
  exact_hits?: number
  exact_milestone?: number | null
  exact_milestones_crossed?: number[]
  unlikely_exact?: boolean
}

interface RoundStandings {
  round: string | null
  standings: RoundStanding[]
}

const NO_ROUND: RoundStandings = { round: null, standings: [] }

export function roundStandingsQueryKey(groupId: string) {
  return ['groups', 'round-standings', groupId] as const
}

function fetchRoundStandings(groupId: string, signal?: AbortSignal): Promise<RoundStandings> {
  return apiFetch(buildApiUrl(`/groups/${encodeURIComponent(groupId)}/round-standings`), {
    signal,
  }).then((r) => {
    if (!r.ok) throw new Error('Erro ao carregar a rodada')
    return r.json() as Promise<RoundStandings>
  })
}

/**
 * Carrega `GET /groups/:id/round-standings`. A falha vira "sem rodada", porque o
 * ranking continua correto sem a coluna da rodada. Com `enabled: false` não busca
 * (útil no resumo quando a rodada ainda não tem escopo).
 */
export function useRoundStandings(groupId: string, enabled = true) {
  const query = useQuery({
    queryKey: roundStandingsQueryKey(groupId),
    queryFn: ({ signal }) => fetchRoundStandings(groupId, signal),
    enabled,
    retry: false,
  })

  if (!enabled) {
    return { round: NO_ROUND.round, standings: NO_ROUND.standings, loading: false }
  }

  const data = query.isError || !query.data ? NO_ROUND : query.data
  return {
    round: data.round,
    standings: data.standings,
    loading: query.isPending,
  }
}
