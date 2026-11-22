import { useState, useRef } from 'react'
import { trackEvent } from '../../analytics/ga'
import { useOutsideClick } from '../../hooks/useOutsideClick'
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

type GroupMenuProps = Omit<GroupHeaderProps, 'group'>

function StatItem({ value, label }: { value: string | number; label: string }) {
  return (
    <div className={styles.statItem}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
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

  useOutsideClick(menuRef, menuOpen, () => setMenuOpen(false), { closeOnEscape: true })

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

export function GroupHeader({ group, ...menuProps }: GroupHeaderProps) {
  return (
    <div className={styles.groupHeader}>
      <div className={styles.groupMeta}>
        <span className={styles.competition}>{group.competition_name ?? group.competition_id}</span>
        <div className={styles.groupNameRow}>
          <h1 className={styles.groupName}>{group.name}</h1>
          <GroupMenu {...menuProps} />
        </div>
      </div>
      <div className={styles.groupActions}>
        <div className={styles.stats}>
          <StatItem value={group.member_count} label="membros" />
          <StatItem value={positionLabel(group.user_position)} label="sua posição" />
          <StatItem value={group.user_points} label="pontos" />
        </div>
      </div>
    </div>
  )
}

export default GroupHeader
