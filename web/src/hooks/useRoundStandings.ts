import { useEffect, useState } from 'react'
import { config } from '../config'
import { apiFetch } from '../lib/api'

export interface RoundStanding {
  user_id: string
  round_points: number
  /** Positivo é subiu. `null` quando ninguém tinha ponto antes da rodada. */
  position_change: number | null
}

interface RoundStandings {
  round: string | null
  standings: RoundStanding[]
}

const NO_ROUND: RoundStandings = { round: null, standings: [] }

/**
 * Carrega `GET /groups/:id/round-standings`. A falha vira "sem rodada", porque o
 * ranking continua correto sem a coluna da rodada.
 */
export function useRoundStandings(groupId: string) {
  const [data, setData] = useState<RoundStandings>(NO_ROUND)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let current = true
    setLoading(true)
    setData(NO_ROUND)
    apiFetch(`${config.apiUrl}/groups/${groupId}/round-standings`)
      .then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar a rodada')
        return r.json() as Promise<RoundStandings>
      })
      .then((body) => {
        if (current) setData(body)
      })
      .catch(() => {
        if (current) setData(NO_ROUND)
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [groupId])

  return { round: data.round, standings: data.standings, loading }
}
