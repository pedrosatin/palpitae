import { useState, useRef, useEffect } from 'react'
import { trackEvent } from '../../analytics/ga'
import { positionLabel } from '../../lib/groupPosition'
import styles from './GroupDetailPage.module.css'

interface GroupHeaderProps {
  group: {
    name: string
    competition_id: string
    competition_name: string | null
    member_count: number
    user_position: number | null
    user_points: number
  }
  isAdmin: boolean
  onOpenRename: () => void
  onOpenRules?: () => void
  onDeleteGroup: () => void
  deleting: boolean
  onLeaveGroup: () => void
  leaving: boolean
}

interface GroupMenuProps {
  isAdmin: boolean
  onOpenRename: () => void
  onOpenRules?: () => void
  onDeleteGroup: () => void
  deleting: boolean
  onLeaveGroup: () => void
  leaving: boolean
}

function GroupMenu({
  isAdmin,
  onOpenRename,
  onOpenRules,
  onDeleteGroup,
  deleting,
  onLeaveGroup,
  leaving,
}: GroupMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const kebabRef = useRef<HTMLButtonElement>(null)

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
    <div className={styles.menuWrap} ref={menuRef}>
      <button
        ref={kebabRef}
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
          {onOpenRules && (
            <button
              className={styles.menuItemNeutral}
              role="menuitem"
              onClick={() => {
                trackEvent('click_group_detail_regras')
                // O item some ao fechar o menu. O foco vai ao botão do menu para o Modal devolvê-lo ali.
                kebabRef.current?.focus()
                setMenuOpen(false)
                onOpenRules()
              }}
            >
              Regras do grupo
            </button>
          )}
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
                Configurações do grupo
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
  )
}

export function GroupHeader({
  group,
  isAdmin,
  onOpenRename,
  onOpenRules,
  onDeleteGroup,
  deleting,
  onLeaveGroup,
  leaving,
}: GroupHeaderProps) {
  return (
    <div className={styles.groupHeader}>
      <div className={styles.groupMeta}>
        <span className={styles.competition}>{group.competition_name ?? group.competition_id}</span>
        <div className={styles.groupNameRow}>
          <h1 className={styles.groupName}>{group.name}</h1>
          <GroupMenu
            isAdmin={isAdmin}
            onOpenRename={onOpenRename}
            onOpenRules={onOpenRules}
            onDeleteGroup={onDeleteGroup}
            deleting={deleting}
            onLeaveGroup={onLeaveGroup}
            leaving={leaving}
          />
        </div>
      </div>
      <div className={styles.groupActions}>
        <div className={styles.stats}>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{group.member_count}</span>
            <span className={styles.statLabel}>membros</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{positionLabel(group.user_position)}</span>
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
