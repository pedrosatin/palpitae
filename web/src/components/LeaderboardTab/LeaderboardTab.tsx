import { useCallback, useEffect, useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import Modal from '../Modal'
import styles from './LeaderboardTab.module.css'

interface LeaderboardTabProps {
  groupId: string
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

interface UserPrediction {
  match_id: string
  predicted_home_score: number
  predicted_away_score: number
  points_awarded: number
  match_status: string
  match_start_time: string
  home_score: number | null
  away_score: number | null
  round: string
  home_team_name: string
  home_team_short_name: string
  home_team_logo: string
  away_team_name: string
  away_team_short_name: string
  away_team_logo: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

export default function LeaderboardTab({
  groupId,
  currentUserId,
}: LeaderboardTabProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [modalPredictions, setModalPredictions] = useState<UserPrediction[]>([])
  const [modalLoading, setModalLoading] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

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

  const openMemberModal = useCallback(
    (member: Member) => {
      trackEvent('click_leaderboard_ver_palpites')
      setSelectedMember(member)
      setModalPredictions([])
      setModalError(null)
      setModalLoading(true)

      fetch(
        `${config.apiUrl}/predictions/user?group_id=${encodeURIComponent(groupId)}&user_id=${encodeURIComponent(member.user_id)}`,
        { credentials: 'include' },
      )
        .then((r) => {
          if (!r.ok) throw new Error('Erro ao carregar palpites')
          return r.json() as Promise<{ predictions: UserPrediction[] }>
        })
        .then((data) => setModalPredictions(data.predictions))
        .catch((e: Error) => setModalError(e.message))
        .finally(() => setModalLoading(false))
    },
    [groupId],
  )

  const closeModal = useCallback(() => {
    setSelectedMember(null)
    setModalPredictions([])
    setModalError(null)
  }, [])

  const modalByRound = new Map<string, UserPrediction[]>()
  for (const p of modalPredictions) {
    if (!modalByRound.has(p.round)) modalByRound.set(p.round, [])
    modalByRound.get(p.round)!.push(p)
  }
  const modalRoundKeys = Array.from(modalByRound.keys())

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
    <>
      <div className={styles.root}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thPos}>#</th>
              <th className={styles.thName}>Jogador</th>
              <th className={styles.thPts}>Pontos</th>
              <th className={styles.thExact}>Exatos</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member, index) => (
              <tr
                key={member.user_id}
                className={
                  member.user_id === currentUserId
                    ? styles.rowSelf
                    : styles.row
                }
                onClick={() => openMemberModal(member)}
                title={`Ver palpites de ${member.display_name}`}
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedMember && (
        <Modal
          isOpen={true}
          onClose={closeModal}
          title={`Palpites de ${selectedMember.display_name}`}
        >
          {modalLoading && (
            <p className={styles.modalLoading}>Carregando palpites...</p>
          )}
          {modalError && (
            <p className={styles.modalError}>{modalError}</p>
          )}
          {!modalLoading && !modalError && modalPredictions.length === 0 && (
            <p className={styles.modalEmpty}>
              Nenhum palpite registrado ainda.
            </p>
          )}
          {!modalLoading && !modalError && modalPredictions.length > 0 && (
            <div className={styles.predRoundGroups}>
              {modalRoundKeys.map((round) => (
                <section key={round} className={styles.predRoundGroup}>
                  <h3 className={styles.predRoundHeader}>Rodada {round}</h3>
                  <ul className={styles.predList}>
                    {modalByRound.get(round)!.map((p) => {
                      const isFinished = p.match_status === 'finished'
                      return (
                        <li key={p.match_id} className={styles.predItem}>
                          <div className={styles.predMatch}>
                            <span className={styles.predTeam}>
                              <img
                                src={p.home_team_logo}
                                alt={p.home_team_short_name}
                                className={styles.predCrest}
                                loading="lazy"
                              />
                              {p.home_team_short_name}
                            </span>
                            <span className={styles.predVs}>×</span>
                            <span className={`${styles.predTeam} ${styles.predTeamAway}`}>
                              {p.away_team_short_name}
                              <img
                                src={p.away_team_logo}
                                alt={p.away_team_short_name}
                                className={styles.predCrest}
                                loading="lazy"
                              />
                            </span>
                          </div>
                          <div className={styles.predScores}>
                            <span className={styles.predLabel}>Palpite</span>
                            <span className={styles.predScore}>
                              {p.predicted_home_score} × {p.predicted_away_score}
                            </span>
                            {isFinished && (
                              <>
                                <span className={styles.predLabel}>Resultado</span>
                                <span className={styles.predScore}>
                                  {p.home_score ?? '–'} × {p.away_score ?? '–'}
                                </span>
                              </>
                            )}
                          </div>
                          <div className={styles.predMeta}>
                            <span className={styles.predDate}>
                              {formatDate(p.match_start_time)}
                            </span>
                            {isFinished && (
                              <span
                                className={
                                  p.points_awarded > 0
                                    ? styles.predPointsGreen
                                    : styles.predPointsZero
                                }
                              >
                                {p.points_awarded} pt
                              </span>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
