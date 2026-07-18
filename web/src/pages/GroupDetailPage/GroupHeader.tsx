import { useState, useRef, useEffect } from 'react'
import styles from './GroupDetailPage.module.css'

interface GroupHeaderProps {
  group: {
    name: string
    competition_id: string
    competition_name: string | null
    member_count: number
    user_position: number
    user_points: number
  }
  isAdmin: boolean
  onOpenRename: () => void
  onDeleteGroup: () => void
  deleting: boolean
  onLeaveGroup: () => void
  leaving: boolean
}

export function GroupHeader({
  group,
  isAdmin,
  onOpenRename,
  onDeleteGroup,
  deleting,
  onLeaveGroup,
  leaving,
}: GroupHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return

    const handlePointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)

    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [menuOpen])

  return (
    <div className={styles.groupHeader}>
      <div className={styles.groupMeta}>
        <span className={styles.competition}>{group.competition_name ?? group.competition_id}</span>
        <div className={styles.groupNameRow}>
          <h1 className={styles.groupName}>{group.name}</h1>
          <div className={styles.menuWrap} ref={menuRef}>
            <button
              className={styles.kebabBtn}
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Opções do grupo"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className={styles.menu} role="menu">
                {isAdmin ? (
                  <>
                    <button
                      className={styles.menuItemNeutral}
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false)
                        onOpenRename()
                      }}
                    >
                      Editar nome
                    </button>
                    <button
                      className={styles.menuItem}
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false)
                        onDeleteGroup()
                      }}
                      disabled={deleting}
                    >
                      {deleting ? 'Excluindo...' : 'Excluir grupo'}
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.menuItem}
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      onLeaveGroup()
                    }}
                    disabled={leaving}
                  >
                    {leaving ? 'Saindo...' : 'Sair do grupo'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className={styles.groupActions}>
        <div className={styles.stats}>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{group.member_count}</span>
            <span className={styles.statLabel}>membros</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statValue}>#{group.user_position}</span>
            <span className={styles.statLabel}>sua posição</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{group.user_points}</span>
            <span className={styles.statLabel}>pontos</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GroupHeader
