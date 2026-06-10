import { useEffect, useState } from 'react'
import { config } from '../../config'
import styles from './MembersTab.module.css'

interface MembersTabProps {
  groupId: string
  currentUserId: string
  onMemberRemoved?: (userId: string) => void
}

interface Member {
  user_id: string
  display_name: string
  avatar_url: string | null
  role: string
  joined_at: string
  total_points: number
  exact_hits: number
}

export default function MembersTab({
  groupId,
  currentUserId,
  onMemberRemoved,
}: MembersTabProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`${config.apiUrl}/groups/${groupId}/members`, {
      credentials: 'include',
    })
      .then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar membros')
        return r.json() as Promise<{ members: Member[] }>
      })
      .then((data) => setMembers(data.members))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId])

  async function removeMember(targetUserId: string, displayName: string) {
    if (!confirm(`Remover "${displayName}" do grupo?`)) return
    setRemoving(targetUserId)
    try {
      const res = await fetch(
        `${config.apiUrl}/groups/${groupId}/members/${targetUserId}`,
        { method: 'DELETE', credentials: 'include' },
      )
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Erro ao remover membro')
      }
      setMembers((prev) => prev.filter((m) => m.user_id !== targetUserId))
      onMemberRemoved?.(targetUserId)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Erro ao remover membro')
    } finally {
      setRemoving(null)
    }
  }

  if (loading) {
    return <p className={styles.loading}>Carregando membros...</p>
  }

  if (error) {
    return <div className={styles.error}>{error}</div>
  }

  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        {members.length} {members.length === 1 ? 'membro' : 'membros'} neste
        grupo
      </p>
      <ul className={styles.list}>
        {members.map((member) => (
          <li key={member.user_id} className={styles.item}>
            <div className={styles.identity}>
              {member.avatar_url ? (
                <img src={member.avatar_url} alt="" className={styles.avatar} />
              ) : (
                <span className={styles.avatarFallback}>
                  {member.display_name.charAt(0).toUpperCase()}
                </span>
              )}
              <div className={styles.info}>
                <span className={styles.name}>{member.display_name}</span>
                {member.role === 'owner' && (
                  <span className={styles.badge}>admin</span>
                )}
                {member.user_id === currentUserId && (
                  <span className={styles.badgeYou}>você</span>
                )}
              </div>
            </div>

            {member.user_id !== currentUserId && member.role !== 'owner' && (
              <button
                className={styles.removeBtn}
                onClick={() =>
                  removeMember(member.user_id, member.display_name)
                }
                disabled={removing === member.user_id}
              >
                {removing === member.user_id ? 'Removendo…' : 'Remover'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
