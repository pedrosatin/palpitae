import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { buildApiUrl } from '../../../config'
import type { GroupWithStats } from '../../../components/GroupCard'
import { apiFetch } from '../../../lib/api'
import { fetchCachedJson, invalidateApiCache } from '../../../lib/api-cache'

interface UseDashboardGroupsParams {
  normalizedPendingInvite?: string
}

export function useDashboardGroups({ normalizedPendingInvite }: UseDashboardGroupsParams) {
  const location = useLocation()
  const [groups, setGroups] = useState<GroupWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [joinOpen, setJoinOpen] = useState(false)

  const fetchGroups = useCallback(
    (forceRefresh = false) => {
      setLoading(true)
      if (forceRefresh) {
        invalidateApiCache('groups:')
      }

      fetchCachedJson(
        `groups:list:${normalizedPendingInvite ?? 'default'}`,
        () => {
          const searchParams = new URLSearchParams()

          if (normalizedPendingInvite) {
            searchParams.set('invite_code', normalizedPendingInvite)
          }

          return apiFetch(
            buildApiUrl('/groups', searchParams),
            forceRefresh ? { cache: 'no-store' } : undefined,
          ).then((res) => {
            if (!res.ok) throw new Error('Falha ao carregar grupos')
            return res.json() as Promise<{
              groups: GroupWithStats[]
              matched_invite_group_id: string | null
            }>
          })
        },
        30_000,
      )
        .then((data) => {
          setGroups(data.groups)
          if (normalizedPendingInvite) {
            setJoinOpen(!data.matched_invite_group_id)
          }
          setLoading(false)
        })
        .catch((err) => {
          setError(err.message)
          setLoading(false)
        })
    },
    [normalizedPendingInvite],
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
    fetchGroups,
  }
}
