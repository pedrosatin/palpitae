import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { buildApiUrl } from '../config'
import type { GroupWithStats } from '../components/GroupCard'
import { apiFetch } from './api'

export type GroupsListResponse = {
  groups: GroupWithStats[]
  matched_invite_group_id: string | null
}

export const GROUPS_STALE_TIME_MS = 30_000

export const groupsQueryKey = ['groups'] as const

export const groupsListQueryPrefix = ['groups', 'list'] as const

export function groupsListQueryKey(userId: string | undefined, inviteCode?: string) {
  return ['groups', 'list', userId ?? null, inviteCode ?? 'default'] as const
}

export function fetchGroupsList(inviteCode?: string): Promise<GroupsListResponse> {
  const searchParams = new URLSearchParams()
  if (inviteCode) searchParams.set('invite_code', inviteCode)
  return apiFetch(buildApiUrl('/groups', searchParams), { cache: 'no-store' }).then((res) => {
    if (!res.ok) throw new Error('Falha ao carregar grupos')
    return res.json() as Promise<GroupsListResponse>
  })
}

export function groupsListQueryOptions(userId: string | undefined, inviteCode?: string) {
  return queryOptions({
    queryKey: groupsListQueryKey(userId, inviteCode),
    staleTime: userId ? GROUPS_STALE_TIME_MS : 0,
    queryFn: () => fetchGroupsList(inviteCode),
  })
}

export function invalidateGroupsList(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: groupsListQueryPrefix, refetchType: 'none' })
}
