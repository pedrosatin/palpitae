import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { GroupWithStats } from '../../../components/GroupCard'
import { invalidateApiCache } from '../../../lib/api-cache'
import { fetchGroupsList } from '../../../lib/groupsList'

interface UseDashboardGroupsParams {
  userId: string
  normalizedPendingInvite?: string
}

/** Carregando, erro e lista se excluem: um erro antigo não sobrevive à carga seguinte. */
type GroupsLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; groups: GroupWithStats[] }

export function useDashboardGroups({ userId, normalizedPendingInvite }: UseDashboardGroupsParams) {
  const location = useLocation()
  const [load, setLoad] = useState<GroupsLoad>({ status: 'loading' })
  const [joinOpen, setJoinOpen] = useState(false)
  // Grupo do convite em que o usuário já está. A página navega direto para ele.
  const [matchedInviteGroupId, setMatchedInviteGroupId] = useState<string | null>(null)
  // Só a carga mais recente aplica a resposta. Uma anterior que chega depois é descartada.
  const requestIdRef = useRef(0)
  // Convite na URL agora. Se ele saiu enquanto a lista carregava, a resposta não abre o modal.
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

  // Parâmetros da última busca disparada pelo efeito.
  const lastRequestRef = useRef<{ userId: string; state: unknown } | null>(null)

  useEffect(() => {
    const state = location.state
    const previous = lastRequestRef.current
    lastRequestRef.current = { userId, state }
    // Convite que sai da URL (dispensado ou aceito) não muda a lista: nada a buscar.
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
  }
}
