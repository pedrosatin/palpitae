import Card from '../Card'
import styles from './GroupCard.module.css'

export interface GroupWithStats {
  id: string
  name: string
  is_admin: boolean
  competition_id: string
  created_at: string
  member_count: number
  user_position: number
  user_points: number
}

interface GroupCardProps {
  group: GroupWithStats
  onClick: () => void
}

export default function GroupCard({ group, onClick }: GroupCardProps) {
  const isOwner = group.is_admin

  return (
    <Card hoverable className={styles.card}>
      <button
        className={styles.cardBtn}
        onClick={onClick}
        aria-label={`Abrir grupo ${group.name}`}
      >
        <div className={styles.header}>
          <h3 className={styles.name}>{group.name}</h3>
          <div className={styles.badges}>
            {isOwner && <span className={styles.ownerBadge}>Admin</span>}
            <span className={styles.badge}>Copa 2026</span>
          </div>
        </div>

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
      </button>
    </Card>
  )
}
