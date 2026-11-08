import { useCallback, useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import { useGroupMembers } from '../../hooks/useGroupMembers'
import ErrorState from '../ErrorState'
import PredictionsModal from './PredictionsModal'
import styles from './LeaderboardTab.module.css'
import type { Member } from './types'

interface LeaderboardTabProps {
  groupId: string
  currentUserId: string
}

export default function LeaderboardTab({ groupId, currentUserId }: LeaderboardTabProps) {
  const { members, loading, error } = useGroupMembers(groupId)
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)

  const openMemberModal = useCallback((member: Member) => {
    trackEvent('click_leaderboard_ver_palpites')
    setSelectedMember(member)
  }, [])

  const closeModal = useCallback(() => {
    setSelectedMember(null)
  }, [])

  if (loading) {
    return <p className={styles.loading}>Carregando classificação...</p>
  }

  if (error) {
    return <ErrorState message={error} />
  }

  if (members.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Nenhum membro encontrado.</p>
      </div>
    )
  }

  return (
    <>
      <div className={styles.root}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thPos}>#</th>
              <th className={styles.thName}>Jogador</th>
              <th className={styles.thPts}>
                <span className={styles.labelLong} aria-hidden="true">
                  Pontos
                </span>
                <abbr className={styles.labelShort} title="Pontos" aria-hidden="true">
                  Pts
                </abbr>
                <span className={styles.srOnly}>Pontos</span>
              </th>
              <th className={styles.thExact}>
                <span className={styles.labelLong} aria-hidden="true">
                  Exatos
                </span>
                <abbr className={styles.labelShort} title="Placares exatos" aria-hidden="true">
                  Ex.
                </abbr>
                <span className={styles.srOnly}>Placares exatos</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member, index) => (
              <tr
                key={member.user_id}
                className={member.user_id === currentUserId ? styles.rowSelf : styles.row}
                onClick={() => openMemberModal(member)}
                title={`Ver palpites de ${member.display_name}`}
              >
                <td className={styles.tdPos}>{index + 1}</td>
                <td className={styles.tdName}>
                  <div className={styles.nameCell}>
                    {member.avatar_url ? (
                      <img src={member.avatar_url} alt="" className={styles.avatar} />
                    ) : (
                      <span className={styles.avatarFallback}>
                        {member.display_name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className={styles.nameBody}>
                      <span className={styles.displayName}>{member.display_name}</span>
                      {(member.role === 'owner' || member.user_id === currentUserId) && (
                        <span className={styles.badges}>
                          {member.role === 'owner' && (
                            <span className={styles.ownerBadge}>admin</span>
                          )}
                          {member.user_id === currentUserId && (
                            <span className={styles.youBadge}>você</span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className={styles.tdPts}>{member.total_points}</td>
                <td className={styles.tdExact}>{member.exact_hits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedMember && (
        <PredictionsModal member={selectedMember} groupId={groupId} onClose={closeModal} />
      )}
    </>
  )
}
