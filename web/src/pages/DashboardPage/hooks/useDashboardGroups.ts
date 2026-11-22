import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { GroupWithStats } from '../../../components/GroupCard'
import {
  fetchGroupsList,
  groupsListQueryKey,
  groupsListQueryOptions,
  groupsListQueryPrefix,
} from '../../../lib/groupsList'

interface UseDashboardGroupsParams {
  userId: string
  normalizedPendingInvite?: string
}

export function useDashboardGroups({ userId, normalizedPendingInvite }: UseDashboardGroupsParams) {
  const location = useLocation()
  const queryClient = useQueryClient()
  const [joinOpen, setJoinOpen] = useState(false)
  const [matchedInviteGroupId, setMatchedInviteGroupId] = useState<string | null>(null)
  const [queryInvite, setQueryInvite] = useState(normalizedPendingInvite)
  const prevUserIdRef = useRef(userId)

  if (prevUserIdRef.current !== userId || normalizedPendingInvite) {
    prevUserIdRef.current = userId
    if (queryInvite !== normalizedPendingInvite) {
      setQueryInvite(normalizedPendingInvite)
    }
  }

  const groupsQuery = useQuery(groupsListQueryOptions(userId, queryInvite))
  const refetchRef = useRef(groupsQuery.refetch)
  refetchRef.current = groupsQuery.refetch
  const queryInviteRef = useRef(queryInvite)
  queryInviteRef.current = queryInvite
  const refreshIdRef = useRef(0)

  const fetchGroups = useCallback(
    (forceRefresh = false) => {
      if (forceRefresh) {
        void queryClient.cancelQueries({ queryKey: groupsListQueryPrefix }, { silent: true })
        void queryClient.invalidateQueries({ queryKey: groupsListQueryPrefix, refetchType: 'none' })
        if (queryInviteRef.current !== normalizedPendingInvite) {
          setQueryInvite(normalizedPendingInvite)
          return
        }
        void refetchRef.current({ cancelRefetch: true })
        return
      }
      void refetchRef.current({ cancelRefetch: false })
    },
    [normalizedPendingInvite, queryClient],
  )

  const refreshGroups = useCallback(async (): Promise<GroupWithStats[] | null> => {
    const requestId = ++refreshIdRef.current
    const invite = queryInviteRef.current
    try {
      const data = await fetchGroupsList(invite)
      if (requestId !== refreshIdRef.current) return null
      queryClient.setQueryData(groupsListQueryKey(userId, invite), data)
      return data.groups
    } catch {
      return null
    }
  }, [queryClient, userId])

  useEffect(() => {
    const needsRefresh =
      (location.state as { refreshGroups?: boolean } | null)?.refreshGroups === true
    if (!needsRefresh) return
    void queryClient.invalidateQueries({ queryKey: groupsListQueryPrefix })
  }, [location.state, queryClient])

  useEffect(() => {
    if (!normalizedPendingInvite || !groupsQuery.data) {
      setMatchedInviteGroupId(null)
      return
    }
    setJoinOpen(!groupsQuery.data.matched_invite_group_id)
    setMatchedInviteGroupId(groupsQuery.data.matched_invite_group_id ?? null)
  }, [normalizedPendingInvite, groupsQuery.data])

  const loading = !groupsQuery.data && (groupsQuery.isPending || groupsQuery.isFetching)
  const error =
    loading || groupsQuery.data
      ? null
      : groupsQuery.error instanceof Error
        ? groupsQuery.error.message
        : groupsQuery.isError
          ? 'Falha ao carregar grupos'
          : null

  return {
    groups: groupsQuery.data?.groups ?? [],
    loading,
    error,
    joinOpen,
    setJoinOpen,
    matchedInviteGroupId,
    fetchGroups,
    refreshGroups,
  }
}
