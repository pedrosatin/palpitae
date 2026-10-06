import { useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { useGroupMembers, type GroupMember } from '../../hooks/useGroupMembers'
import { apiFetch } from '../../lib/api'
import { useConfirm } from '../ConfirmModal'
import Button from '../Button'
import ErrorState from '../ErrorState'
import styles from './MembersTab.module.css'

interface MembersTabProps {
  groupId: string
  currentUserId: string
  onMemberRemoved?: (userId: string) => void
}

function useMembers(groupId: string, onMemberRemoved?: (userId: string) => void) {
  const { members, setMembers, loading, error } = useGroupMembers(groupId)
  const [removing, setRemoving] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  async function removeMember(targetUserId: string, displayName: string) {
    trackEvent('click_members_remover')
    const ok = await confirm({
      title: 'Remover membro',
      message: `Remover "${displayName}" do grupo? A pessoa não poderá entrar de novo, nem com o convite.`,
      confirmLabel: 'Remover',
      danger: true,
    })
    if (!ok) return
    setRemoving(targetUserId)
    try {
      const res = await apiFetch(`${config.apiUrl}/groups/${groupId}/members/${targetUserId}`, {
        method: 'DELETE',
      })
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

  return { members, loading, error, removing, confirmDialog, removeMember }
}

interface MemberItemProps {
  member: GroupMember
  currentUserId: string
  removing: string | null
  onRemove: (userId: string, displayName: string) => void
}

function MemberItem({ member, currentUserId, removing, onRemove }: MemberItemProps) {
  return (
    <li className={styles.item}>
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
          {member.role === 'owner' && <span className={styles.badge}>admin</span>}
          {member.user_id === currentUserId && <span className={styles.badgeYou}>você</span>}
        </div>
      </div>

      {member.user_id !== currentUserId && member.role !== 'owner' && (
        <Button
          variant="danger"
          size="sm"
          onClick={() => onRemove(member.user_id, member.display_name)}
          disabled={removing === member.user_id}
        >
          {removing === member.user_id ? 'Removendo…' : 'Remover'}
        </Button>
      )}
    </li>
  )
}

export default function MembersTab({ groupId, currentUserId, onMemberRemoved }: MembersTabProps) {
  const { members, loading, error, removing, confirmDialog, removeMember } = useMembers(
    groupId,
    onMemberRemoved,
  )

  if (loading) {
    return <p className={styles.loading}>Carregando membros...</p>
  }

  if (error) {
    return <ErrorState message={error} />
  }

  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        {members.length} {members.length === 1 ? 'membro' : 'membros'} neste grupo
      </p>
      <ul className={styles.list}>
        {members.map((member) => (
          <MemberItem
            key={member.user_id}
            member={member}
            currentUserId={currentUserId}
            removing={removing}
            onRemove={removeMember}
          />
        ))}
      </ul>
      {confirmDialog}
    </div>
  )
}
