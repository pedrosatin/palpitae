import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { trackApproveJoinRequest } from '../../analytics/funnel'
import { trackEvent } from '../../analytics/ga'
import { buildApiUrl } from '../../config'
import { apiFetch, readApiError } from '../../lib/api'
import Avatar from '../Avatar'
import Button from '../Button'
import styles from './MembersTab.module.css'

export type JoinRequestItem = {
  id: string
  user_id: string
  display_name: string
  avatar_url: string | null
  created_at: string
}

interface JoinRequestsListProps {
  groupId: string
  onDecided?: (action: 'approve' | 'reject') => void
}

function joinRequestsQueryKey(groupId: string) {
  return ['groups', 'join-requests', groupId] as const
}

async function fetchJoinRequests(groupId: string, signal?: AbortSignal): Promise<JoinRequestItem[]> {
  const res = await apiFetch(
    buildApiUrl(`/groups/${encodeURIComponent(groupId)}/join-requests`),
    { signal },
  )
  if (!res.ok) throw new Error(await readApiError(res, 'Erro ao carregar pedidos'))
  const body = (await res.json()) as { requests?: JoinRequestItem[] }
  return body.requests ?? []
}

export default function JoinRequestsList({ groupId, onDecided }: JoinRequestsListProps) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: joinRequestsQueryKey(groupId),
    queryFn: ({ signal }) => fetchJoinRequests(groupId, signal),
  })
  const [busyId, setBusyId] = useState<string | null>(null)

  const decideMutation = useMutation({
    mutationFn: async ({
      requestId,
      action,
    }: {
      requestId: string
      action: 'approve' | 'reject'
    }) => {
      const res = await apiFetch(
        buildApiUrl(
          `/groups/${encodeURIComponent(groupId)}/join-requests/${encodeURIComponent(requestId)}/${action}`,
        ),
        { method: 'POST' },
      )
      if (!res.ok) throw new Error(await readApiError(res, 'Não foi possível decidir o pedido'))
      return { requestId, action }
    },
    onSuccess: ({ requestId, action }) => {
      if (action === 'approve') trackApproveJoinRequest()
      queryClient.setQueryData<JoinRequestItem[]>(joinRequestsQueryKey(groupId), (prev) =>
        (prev ?? []).filter((r) => r.id !== requestId),
      )
      onDecided?.(action)
    },
    onError: (e: unknown) => {
      alert(e instanceof Error ? e.message : 'Não foi possível decidir o pedido')
    },
    onSettled: () => {
      setBusyId(null)
    },
  })

  function decide(requestId: string, action: 'approve' | 'reject') {
    trackEvent(action === 'approve' ? 'click_members_aprovar_pedido' : 'click_members_recusar_pedido')
    setBusyId(requestId)
    decideMutation.mutate({ requestId, action })
  }

  const requests = query.data ?? []
  const loading = query.isPending
  const error =
    !query.data && query.isError
      ? query.error instanceof Error
        ? query.error.message
        : 'Erro ao carregar pedidos'
      : null

  if (loading) return <p className={styles.loading}>Carregando pedidos...</p>
  if (error) return <p className={styles.hint}>{error}</p>
  if (requests.length === 0) return null

  return (
    <section className={styles.requests} data-testid="join-requests-list">
      <h3 className={styles.requestsTitle}>
        Pedidos pendentes ({requests.length})
      </h3>
      <ul className={styles.list}>
        {requests.map((request) => (
          <li key={request.id} className={styles.item}>
            <div className={styles.identity}>
              <Avatar name={request.display_name} src={request.avatar_url} />
              <div className={styles.info}>
                <span className={styles.name}>{request.display_name}</span>
              </div>
            </div>
            <div className={styles.requestActions}>
              <Button
                variant="outline"
                size="sm"
                disabled={busyId === request.id}
                onClick={() => decide(request.id, 'reject')}
              >
                Recusar
              </Button>
              <Button
                size="sm"
                disabled={busyId === request.id}
                onClick={() => decide(request.id, 'approve')}
              >
                Aprovar
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
