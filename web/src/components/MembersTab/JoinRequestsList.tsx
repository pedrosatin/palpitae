import { useCallback, useEffect, useState } from 'react'
import { trackJoinGroup } from '../../analytics/funnel'
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
  onDecided?: () => void
}

export default function JoinRequestsList({ groupId, onDecided }: JoinRequestsListProps) {
  const [requests, setRequests] = useState<JoinRequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(
        buildApiUrl(`/groups/${encodeURIComponent(groupId)}/join-requests`),
      )
      if (!res.ok) throw new Error(await readApiError(res, 'Erro ao carregar pedidos'))
      const body = (await res.json()) as { requests?: JoinRequestItem[] }
      setRequests(body.requests ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar pedidos')
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    void load()
  }, [load])

  async function decide(requestId: string, action: 'approve' | 'reject') {
    trackEvent(action === 'approve' ? 'click_members_aprovar_pedido' : 'click_members_recusar_pedido')
    setBusyId(requestId)
    try {
      const res = await apiFetch(
        buildApiUrl(
          `/groups/${encodeURIComponent(groupId)}/join-requests/${encodeURIComponent(requestId)}/${action}`,
        ),
        { method: 'POST' },
      )
      if (!res.ok) throw new Error(await readApiError(res, 'Não foi possível decidir o pedido'))
      if (action === 'approve') trackJoinGroup('request')
      setRequests((prev) => prev.filter((r) => r.id !== requestId))
      onDecided?.()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Não foi possível decidir o pedido')
    } finally {
      setBusyId(null)
    }
  }

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
