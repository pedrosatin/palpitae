import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { buildApiUrl } from '../config'
import { apiFetch } from './api'
import { isListOf, isRecord, UNEXPECTED_RESPONSE } from './responseShape'

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

export const GROUP_MEMBERS_STALE_TIME_MS = 30_000

export const groupMembersQueryPrefix = ['groups', 'members'] as const

export function groupMembersQueryKey(groupId: string) {
  return ['groups', 'members', groupId] as const
}

export function fetchGroupMembers(groupId: string, signal?: AbortSignal): Promise<GroupMember[]> {
  return apiFetch(buildApiUrl(`/groups/${encodeURIComponent(groupId)}/members`), { signal })
    .then((r) => {
      if (!r.ok) throw new Error('Erro ao carregar membros')
      return r.json() as Promise<unknown>
    })
    .then((body) => {
      const list = parseGroupMembers(body)
      if (!list) throw new Error(UNEXPECTED_RESPONSE)
      return list
    })
}

export function groupMembersQueryOptions(groupId: string) {
  return queryOptions({
    queryKey: groupMembersQueryKey(groupId),
    staleTime: GROUP_MEMBERS_STALE_TIME_MS,
    queryFn: ({ signal }) => fetchGroupMembers(groupId, signal),
  })
}

export function invalidateGroupMembers(queryClient: QueryClient, groupId?: string) {
  return queryClient.invalidateQueries({
    queryKey: groupId ? groupMembersQueryKey(groupId) : groupMembersQueryPrefix,
  })
}
