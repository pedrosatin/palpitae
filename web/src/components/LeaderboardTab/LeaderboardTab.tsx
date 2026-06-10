import { useEffect, useState } from 'react'
import { config } from '../../config'
import styles from './LeaderboardTab.module.css'

interface LeaderboardTabProps {
  groupId: string
  isAdmin: boolean
  currentUserId: string
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

export default function LeaderboardTab({
  groupId,
  isAdmin,
  currentUserId,
}: LeaderboardTabProps) {
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

  async function removeMember(targetUserId: string) {
    if (!confirm('Remover este membro do grupo?')) return
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
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Erro ao remover membro')
    } finally {
      setRemoving(null)
    }
  }

  if (loading) {
    return <p className={styles.loading}>Carregando classificação...</p>
  }

  if (error) {
    return <div className={styles.error}>{error}</div>
  }

  if (members.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Nenhum membro encontrado.</p>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.thPos}>#</th>
            <th className={styles.thName}>Jogador</th>
            <th className={styles.thPts}>Pontos</th>
            <th className={styles.thExact}>Exatos</th>
            {isAdmin && <th className={styles.thAction} />}
          </tr>
        </thead>
        <tbody>
          {members.map((member, index) => (
            <tr
              key={member.user_id}
              className={
                member.user_id === currentUserId ? styles.rowSelf : styles.row
              }
            >
              <td className={styles.tdPos}>{index + 1}</td>
              <td className={styles.tdName}>
                {member.avatar_url ? (
                  <img
                    src={member.avatar_url}
                    alt=""
                    className={styles.avatar}
                  />
                ) : (
                  <span className={styles.avatarFallback}>
                    {member.display_name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className={styles.displayName}>
                  {member.display_name}
                </span>
                {member.role === 'owner' && (
                  <span className={styles.ownerBadge}>admin</span>
                )}
                {member.user_id === currentUserId && (
                  <span className={styles.youBadge}>você</span>
                )}
              </td>
              <td className={styles.tdPts}>{member.total_points}</td>
              <td className={styles.tdExact}>{member.exact_hits}</td>
              {isAdmin && (
                <td className={styles.tdAction}>
                  {member.user_id !== currentUserId && (
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeMember(member.user_id)}
                      disabled={removing === member.user_id}
                    >
                      {removing === member.user_id ? '...' : 'Remover'}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
