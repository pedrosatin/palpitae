import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { GroupWithStats } from '../../../components/GroupCard'
import { invalidateApiCache } from '../../../lib/api-cache'
import { fetchGroupsList } from '../../../lib/groupsList'

interface UseDashboardGroupsParams {
  userId: string
  normalizedPendingInvite?: string
}

type GroupsLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; groups: GroupWithStats[] }

export function useDashboardGroups({ userId, normalizedPendingInvite }: UseDashboardGroupsParams) {
  const location = useLocation()
  const [load, setLoad] = useState<GroupsLoad>({ status: 'loading' })
  const [joinOpen, setJoinOpen] = useState(false)
  const [matchedInviteGroupId, setMatchedInviteGroupId] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const pendingInviteRef = useRef(normalizedPendingInvite)
  pendingInviteRef.current = normalizedPendingInvite

  const fetchGroups = useCallback(
    (forceRefresh = false) => {
      const requestId = ++requestIdRef.current
      setLoad({ status: 'loading' })
      if (forceRefresh) {
        invalidateApiCache('groups:')
      }

      fetchGroupsList(userId, normalizedPendingInvite)
        .then((data) => {
          if (requestId !== requestIdRef.current) return
          setLoad({ status: 'ready', groups: data.groups })
          const invite =
            normalizedPendingInvite && pendingInviteRef.current === normalizedPendingInvite
              ? normalizedPendingInvite
              : undefined
          if (invite) {
            setJoinOpen(!data.matched_invite_group_id)
          }
          setMatchedInviteGroupId(invite ? (data.matched_invite_group_id ?? null) : null)
        })
        .catch((err: Error) => {
          if (requestId !== requestIdRef.current) return
          setLoad({ status: 'error', message: err.message })
        })
    },
    [userId, normalizedPendingInvite],
  )

  const refreshGroups = useCallback((): Promise<GroupWithStats[] | null> => {
    const requestId = ++requestIdRef.current
    invalidateApiCache('groups:')
    return fetchGroupsList(userId)
      .then((data) => {
        if (requestId !== requestIdRef.current) return null
        setLoad((current) =>
          current.status === 'ready' ? { status: 'ready', groups: data.groups } : current,
        )
        return data.groups
      })
      .catch(() => null)
  }, [userId])

  const lastRequestRef = useRef<{ userId: string; state: unknown } | null>(null)

  useEffect(() => {
    const state = location.state
    const previous = lastRequestRef.current
    lastRequestRef.current = { userId, state }
    if (!normalizedPendingInvite && previous?.userId === userId && previous.state === state) return
    const needsRefresh = (state as { refreshGroups?: boolean } | null)?.refreshGroups === true
    fetchGroups(needsRefresh)
  }, [fetchGroups, location.state, userId, normalizedPendingInvite])

  return {
    groups: load.status === 'ready' ? load.groups : [],
    loading: load.status === 'loading',
    error: load.status === 'error' ? load.message : null,
    joinOpen,
    setJoinOpen,
    matchedInviteGroupId,
    fetchGroups,
    refreshGroups,
  }
}
