import { useEffect, useState } from 'react'
import { config } from '../config'
import Button from '../components/Button'
import GroupCard, { type GroupWithStats } from '../components/GroupCard'
import Header from '../components/Header'
import styles from './DashboardPage.module.css'

interface User {
  id: string
  email: string
  nickname?: string
  avatar_url?: string
}

/**
 * Dashboard page — main application after login.
 *
 * Displays:
 * - User greeting with profile
 * - List of groups the user is a member of
 * - Call-to-action to create or join groups
 * - Quick actions for predictions
 */
export default function DashboardPage({ user }: { user: User }) {
  const [groups, setGroups] = useState<GroupWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${config.apiUrl}/groups`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Falha ao carregar grupos')
        return res.json() as Promise<{ groups: GroupWithStats[] }>
      })
      .then((data) => {
        setGroups(data.groups)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  function handleCreateGroup() {
    // TODO: open create group modal
  }

  function handleJoinGroup() {
    // TODO: open join group modal
  }

  if (loading) {
    return (
      <>
        <Header
          user={user}
          onCreateGroup={handleCreateGroup}
          onJoinGroup={handleJoinGroup}
        />
        <main className={styles.root}>
          <div className={styles.loadingContainer}>
            <p>Carregando...</p>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Header
        user={user}
        onCreateGroup={handleCreateGroup}
        onJoinGroup={handleJoinGroup}
      />
      <main className={styles.root}>
        {/* Main Content */}
        <div className={styles.content}>
          {error && <div className={styles.errorMessage}>{error}</div>}

          {groups.length === 0 ? (
            <div className={styles.emptyState}>
              <h2>Nenhum grupo ainda</h2>
              <p>Comece a competir criando ou se juntando a um grupo</p>
              <div className={styles.ctaButtons}>
                <Button variant="primary">Criar grupo</Button>
                <Button variant="secondary">Entrar com link</Button>
              </div>
            </div>
          ) : (
            <div className={styles.groupsContainer}>
              <h2 className={styles.sectionTitle}>Seus grupos</h2>
              <div className={styles.groupsGrid}>
                {groups.map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    onViewPredictions={() => {}}
                    onViewLeaderboard={() => {}}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
