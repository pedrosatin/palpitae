import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button'
import { trackEvent } from '../../analytics/ga'
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

export default function Header({ user, onCreateGroup, onJoinGroup, onLogout }: HeaderProps) {
  const canCreateGroup = user.feature_flags?.create_group ?? false
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const displayName = user.nickname ?? user.email

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
        <a
          href="/"
          className={styles.logoLink}
          aria-label="Ir para a home"
          onClick={() => trackEvent('click_header_logo')}
        >
          <img src="/logo-text.svg" alt="Palpitae" className={styles.logo} />
        </a>

        <div className={styles.actions}>
          {/* No celular os botões viram ícones; o texto fica só para leitor de tela. */}
          <Button
            variant="secondary"
            className={styles.actionButton}
            onClick={() => {
              trackEvent('click_header_entrar_grupo')
              onJoinGroup()
            }}
          >
            <LogInIcon className={styles.actionIcon} />
            <span className={styles.actionLabel}>Entrar em grupo</span>
          </Button>
          {canCreateGroup && (
            <Button
              variant="primary"
              className={styles.actionButton}
              onClick={() => {
                trackEvent('click_header_criar_grupo')
                onCreateGroup()
              }}
            >
              <PlusIcon className={styles.actionIcon} />
              <span className={styles.actionLabel}>Criar grupo</span>
            </Button>
          )}

          <div className={styles.userMenu} ref={menuRef}>
            <button
              className={styles.userMenuTrigger}
              onClick={() => {
                if (!menuOpen) trackEvent('click_header_user_menu')
                setMenuOpen((o) => !o)
              }}
              aria-expanded={menuOpen}
              aria-haspopup="true"
              aria-label={`Menu de ${displayName}`}
            >
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className={styles.avatar} />
              ) : (
                // Só aparece no celular, onde o nome some e sobra o avatar.
                <span className={styles.avatarFallback} aria-hidden="true">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              )}
              <span className={styles.nickname}>{displayName}</span>
              <span className={styles.chevron} aria-hidden="true">
                ▾
              </span>
            </button>

            {menuOpen && (
              <div className={styles.dropdown}>
                <Link
                  to="/configuracoes"
                  className={styles.dropdownItem}
                  onClick={() => {
                    trackEvent('click_header_configuracoes')
                    setMenuOpen(false)
                  }}
                >
                  Configurações
                </Link>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    trackEvent('click_header_logout')
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

function LogInIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
