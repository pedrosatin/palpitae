import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { GroupWithStats } from '../../../components/GroupCard'
import { invalidateApiCache } from '../../../lib/api-cache'
import { fetchGroupsList } from '../../../lib/groupsList'

interface UseDashboardGroupsParams {
  userId: string
  normalizedPendingInvite?: string
}

export function useDashboardGroups({ userId, normalizedPendingInvite }: UseDashboardGroupsParams) {
  const location = useLocation()
  const [groups, setGroups] = useState<GroupWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [joinOpen, setJoinOpen] = useState(false)
  // Grupo do convite em que o usuário já está. A página navega direto para ele.
  const [matchedInviteGroupId, setMatchedInviteGroupId] = useState<string | null>(null)

  const fetchGroups = useCallback(
    (forceRefresh = false) => {
      setLoading(true)
      if (forceRefresh) {
        invalidateApiCache('groups:')
      }

      fetchGroupsList(userId, normalizedPendingInvite)
        .then((data) => {
          setGroups(data.groups)
          if (normalizedPendingInvite) {
            setJoinOpen(!data.matched_invite_group_id)
          }
          setMatchedInviteGroupId(
            normalizedPendingInvite ? (data.matched_invite_group_id ?? null) : null,
          )
          setLoading(false)
        })
        .catch((err) => {
          setError(err.message)
          setLoading(false)
        })
    },
    [userId, normalizedPendingInvite],
  )

  useEffect(() => {
    const needsRefresh =
      (location.state as { refreshGroups?: boolean } | null)?.refreshGroups === true
    fetchGroups(needsRefresh)
  }, [fetchGroups, location.state])

  return {
    groups,
    loading,
    error,
    joinOpen,
    setJoinOpen,
    matchedInviteGroupId,
    fetchGroups,
  }
}
