import { useEffect, useState } from 'react'
import { buildApiUrl } from '../config'
import { apiFetch } from '../lib/api'
import { isListOf, isRecord, UNEXPECTED_RESPONSE } from '../lib/responseShape'

export interface GroupMember {
  user_id: string
  display_name: string
  avatar_url: string | null
  role: string
  joined_at: string
  total_points: number
  exact_hits: number
}

/** Lê `{ members }`. Lista ausente ou membro sem id, nome ou pontos devolve null. */
export function parseGroupMembers(body: unknown): GroupMember[] | null {
  const members = isRecord(body) ? body.members : null
  const ok = isListOf(members, {
    user_id: 'string',
    display_name: 'string',
    total_points: 'number',
  })
  return ok ? (members as unknown as GroupMember[]) : null
}

/** Shared loader for GET /groups/:id/members (LeaderboardTab + MembersTab). */
export function useGroupMembers(groupId: string) {
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiFetch(buildApiUrl(`/groups/${encodeURIComponent(groupId)}/members`))
      .then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar membros')
        return r.json() as Promise<unknown>
      })
      .then((body) => {
        const list = parseGroupMembers(body)
        if (!list) throw new Error(UNEXPECTED_RESPONSE)
        setMembers(list)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId])

  return { members, setMembers, loading, error }
}
