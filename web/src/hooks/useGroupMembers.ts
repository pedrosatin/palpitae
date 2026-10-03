import { useEffect, useState } from 'react'
import { config } from '../config'
import { apiFetch } from '../lib/api'

export interface GroupMember {
  user_id: string
  display_name: string
  avatar_url: string | null
  role: string
  joined_at: string
  total_points: number
  exact_hits: number
}

/** Shared loader for GET /groups/:id/members (LeaderboardTab + MembersTab). */
export function useGroupMembers(groupId: string) {
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiFetch(`${config.apiUrl}/groups/${groupId}/members`)
      .then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar membros')
        return r.json() as Promise<{ members: GroupMember[] }>
      })
      .then((data) => setMembers(data.members))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId])

  return { members, setMembers, loading, error }
}
