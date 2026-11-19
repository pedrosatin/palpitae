import { useEffect, useState } from 'react'
import { buildApiUrl } from '../config'
import { apiFetch } from '../lib/api'

export interface RoundStanding {
  user_id: string
  round_points: number
  /** Positivo é subiu. `null` quando ninguém tinha ponto antes da rodada. */
  position_change: number | null
  /** Rodadas encerradas seguidas, da referência para trás, com todos os jogos palpitados. */
  streak: number
  /** Placares exatos acumulados no grupo. */
  exact_hits?: number
  /** Maior marco de placares exatos no grupo (5, 15 ou 30). Ausente ou null abaixo de 5. */
  exact_milestone?: number | null
  /** Marcos cruzados na rodada de referência. Ausente ou [] se nenhum. */
  exact_milestones_crossed?: number[]
  /** Placar exato raro na competição, na rodada de referência. */
  unlikely_exact?: boolean
}

interface RoundStandings {
  round: string | null
  standings: RoundStanding[]
}

const NO_ROUND: RoundStandings = { round: null, standings: [] }

/**
 * Carrega `GET /groups/:id/round-standings`. A falha vira "sem rodada", porque o
 * ranking continua correto sem a coluna da rodada. Com `enabled: false` não busca
 * (útil no resumo quando a rodada ainda não tem escopo).
 */
export function useRoundStandings(groupId: string, enabled = true) {
  const [data, setData] = useState<RoundStandings>(NO_ROUND)
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) {
      setData(NO_ROUND)
      setLoading(false)
      return
    }
    let current = true
    setLoading(true)
    setData(NO_ROUND)
    apiFetch(buildApiUrl(`/groups/${encodeURIComponent(groupId)}/round-standings`))
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
  }, [groupId, enabled])

  return { round: data.round, standings: data.standings, loading }
}
