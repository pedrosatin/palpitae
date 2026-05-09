import Button from './Button'
import Card from './Card'
import styles from './GroupCard.module.css'

export interface GroupWithStats {
  id: string
  name: string
  admin_id: string
  competition_id: string
  created_at: string
  member_count: number
  user_position: number
  user_points: number
}

interface GroupCardProps {
  group: GroupWithStats
  onViewPredictions: (groupId: string) => void
  onViewLeaderboard: (groupId: string) => void
}

export default function GroupCard({
  group,
  onViewPredictions,
  onViewLeaderboard,
}: GroupCardProps) {
  return (
    <Card hoverable>
      <div className={styles.header}>
        <h3 className={styles.name}>{group.name}</h3>
        <span className={styles.badge}>Copa 2026</span>
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

      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => onViewPredictions(group.id)}>
          Ver previsões
        </Button>
        <Button variant="secondary" onClick={() => onViewLeaderboard(group.id)}>
          Ver classificação
        </Button>
      </div>
    </Card>
  )
}
