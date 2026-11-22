import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import {
  groupMembersQueryKey,
  groupMembersQueryOptions,
  type GroupMember,
} from '../lib/groupMembers'

export type { GroupMember }
export { parseGroupMembers } from '../lib/groupMembers'

/** Shared loader for GET /groups/:id/members (LeaderboardTab + MembersTab). */
export function useGroupMembers(groupId: string) {
  const queryClient = useQueryClient()
  const query = useQuery(groupMembersQueryOptions(groupId))

  const setMembers = useCallback(
    (updater: GroupMember[] | ((prev: GroupMember[]) => GroupMember[])) => {
      queryClient.setQueryData<GroupMember[]>(groupMembersQueryKey(groupId), (prev) => {
        const current = prev ?? []
        return typeof updater === 'function' ? updater(current) : updater
      })
    },
    [groupId, queryClient],
  )

  return {
    members: query.data ?? [],
    setMembers,
    loading: query.isPending,
    error:
      query.data === undefined && query.isError
        ? query.error instanceof Error
          ? query.error.message
          : 'Erro ao carregar membros'
        : null,
    refetch: query.refetch,
  }
}
