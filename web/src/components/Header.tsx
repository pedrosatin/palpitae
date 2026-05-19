import { useEffect, useRef, useState } from 'react'
import Button from './Button'
import styles from './Header.module.css'

interface User {
  nickname?: string
  avatar_url?: string
  email: string
  feature_flags?: {
    create_group?: boolean
  }
}

interface HeaderProps {
  user: User
  onCreateGroup: () => void
  onJoinGroup: () => void
  onLogout: () => void
}

export default function Header({
  user,
  onCreateGroup,
  onJoinGroup,
  onLogout,
}: HeaderProps) {
  const canCreateGroup = user.feature_flags?.create_group ?? false
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handleOutsideClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [menuOpen])

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <a href="/" className={styles.logoLink} aria-label="Ir para a home">
          <img src="/logo-text.svg" alt="Palpitae" className={styles.logo} />
        </a>

        <div className={styles.actions}>
          <>
            <Button variant="secondary" onClick={onJoinGroup}>
              Entrar em grupo
            </Button>
            {canCreateGroup && (
              <Button variant="primary" onClick={onCreateGroup}>
                Criar grupo
              </Button>
            )}
          </>

          <div className={styles.userMenu} ref={menuRef}>
            <button
              className={styles.userMenuTrigger}
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-haspopup="true"
            >
              {user.avatar_url && (
                <img
                  src={user.avatar_url}
                  alt={user.nickname ?? user.email}
                  className={styles.avatar}
                />
              )}
              <span className={styles.nickname}>
                {user.nickname ?? user.email}
              </span>
              <span className={styles.chevron} aria-hidden="true">
                ▾
              </span>
            </button>

            {menuOpen && (
              <div className={styles.dropdown}>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setMenuOpen(false)
                    onLogout()
                  }}
                >
                  Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
