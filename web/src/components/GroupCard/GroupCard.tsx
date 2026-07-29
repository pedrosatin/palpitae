import { useState } from 'react'
import Card from '../Card'
import ShareGroupModal from '../ShareGroupModal'
import { trackEvent } from '../../analytics/ga'
import styles from './GroupCard.module.css'

export interface PodiumEntry {
  position: number
  display: string
  points: number
  is_you: boolean
}

export interface GroupWithStats {
  id: string
  name: string
  is_admin: boolean
  competition_id: string
  competition_name: string | null
  competition_type?: 'league' | 'cup' | null
  competition_status?: 'upcoming' | 'ongoing' | 'finished' | null
  created_at: string
  member_count: number
  user_position: number
  user_points: number
  pending_predictions: number
  podium?: PodiumEntry[] | null
}

interface GroupCardProps {
  group: GroupWithStats
  onClick: () => void
}

/**
 * Pódio de um grupo encerrado. Substitui os stats "como vou" pela resposta que
 * importa quando o campeonato acaba: quem venceu. #1 recebe a coroa (lime), o
 * resto fica em texto secundário. Se o usuário ficou fora do top-3, anexamos a
 * linha dele separada, para ele não perder a própria colocação.
 */
function Podium({ group }: { group: GroupWithStats }) {
  const podium = group.podium ?? []
  const youInPodium = podium.some((entry) => entry.is_you)

  return (
    <ol className={styles.podium}>
      {podium.map((entry) => (
        <li
          key={entry.position}
          className={styles.podiumRow}
          data-champion={entry.position === 1 || undefined}
          data-you={entry.is_you || undefined}
        >
          <span className={styles.podiumRank} aria-hidden="true">
            {entry.position === 1 ? '🏆' : entry.position}
          </span>
          <span className={styles.podiumName}>
            {entry.is_you ? 'Você' : entry.display}
            {entry.position === 1 && <span className={styles.srOnly}> — campeão</span>}
          </span>
          <span className={styles.podiumPoints}>{entry.points}</span>
        </li>
      ))}

      {!youInPodium && (
        <li className={styles.podiumRow} data-you data-outside>
          <span className={styles.podiumRank} aria-hidden="true">
            #{group.user_position}
          </span>
          <span className={styles.podiumName}>Você</span>
          <span className={styles.podiumPoints}>{group.user_points}</span>
        </li>
      )}
    </ol>
  )
}

export default function GroupCard({ group, onClick }: GroupCardProps) {
  const isOwner = group.is_admin
  const isFinished = group.competition_status === 'finished'
  const [shareOpen, setShareOpen] = useState(false)
  const hasPending = !isFinished && group.pending_predictions > 0
  const pendingLabel =
    group.pending_predictions === 1
      ? '1 palpite pendente'
      : `${group.pending_predictions} palpites pendentes`

  return (
    <Card hoverable className={isFinished ? `${styles.card} ${styles.finished}` : styles.card}>
      <button className={styles.cardBtn} onClick={onClick} aria-label={`Abrir grupo ${group.name}`}>
        <div className={styles.header}>
          <h3 className={styles.name}>{group.name}</h3>
          <div className={styles.badges}>
            {hasPending && <span className={styles.pendingBadge}>{pendingLabel}</span>}
            {isOwner && <span className={styles.ownerBadge}>Admin</span>}
            <span
              className={styles.badgeWrapper}
              data-tooltip={group.competition_name ?? group.competition_id}
            >
              <span className={styles.badge}>{group.competition_name ?? group.competition_id}</span>
            </span>
          </div>
        </div>

        {isFinished ? (
          <Podium group={group} />
        ) : (
          <div className={styles.stats}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Membros</span>
              <span className={styles.statValue}>{group.member_count}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Sua posição</span>
              <span className={styles.statValue}>#{group.user_position}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Seus pontos</span>
              <span className={styles.statValue}>{group.user_points}</span>
            </div>
          </div>
        )}
      </button>

      {isFinished && (
        <div className={styles.finishedFooter}>
          <button
            type="button"
            className={styles.shareBtn}
            onClick={() => {
              trackEvent('click_groupcard_compartilhar', { group_id: group.id })
              setShareOpen(true)
            }}
          >
            <span aria-hidden="true">↗</span> Compartilhar resultado
          </button>
        </div>
      )}

      {isFinished && (
        <ShareGroupModal isOpen={shareOpen} onClose={() => setShareOpen(false)} group={group} />
      )}
    </Card>
  )
}
