import Button from './Button'
import styles from './Header.module.css'

interface User {
  nickname?: string
  avatar_url?: string
  email: string
}

interface HeaderProps {
  user: User
  onCreateGroup: () => void
  onJoinGroup: () => void
}

export default function Header({ user, onCreateGroup, onJoinGroup }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <img src="/logo-text.svg" alt="Palpitae" className={styles.logo} />

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onJoinGroup}>
            Entrar em grupo
          </Button>
          <Button variant="primary" onClick={onCreateGroup}>
            Criar grupo
          </Button>

          <div className={styles.userMenu}>
            {user.avatar_url && (
              <img
                src={user.avatar_url}
                alt={user.nickname ?? user.email}
                className={styles.avatar}
              />
            )}
            <span className={styles.nickname}>{user.nickname ?? user.email}</span>
          </div>
        </div>
      </div>
    </header>
  )
}
