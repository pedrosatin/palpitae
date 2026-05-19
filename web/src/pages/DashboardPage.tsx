import { useEffect, useState } from 'react'
import { config } from '../config'
import Button from '../components/Button'
import CreateGroupModal from '../components/CreateGroupModal'
import GroupCard, { type GroupWithStats } from '../components/GroupCard'
import Header from '../components/Header'
import JoinGroupModal from '../components/JoinGroupModal'
import styles from './DashboardPage.module.css'

interface User {
  id: string
  email: string
  nickname?: string
  avatar_url?: string
  feature_flags?: {
    create_group?: boolean
  }
}

interface DashboardPageProps {
  user: User
  /** Invite code pre-filled from a share link (?convite=...) */
  pendingInvite?: string
  onNavigateToGroup: (groupId: string) => void
  onLogout: () => void
}

export default function DashboardPage({
  user,
  pendingInvite,
  onNavigateToGroup,
  onLogout,
}: DashboardPageProps) {
  const canCreateGroup = user.feature_flags?.create_group ?? false
  const [groups, setGroups] = useState<GroupWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(!!pendingInvite)

  function fetchGroups() {
    setLoading(true)
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
  }

  useEffect(() => {
    fetchGroups()
  }, [])

  function handleGroupCreated() {
    // Refresh the groups list after creation
    fetchGroups()
    setCreateOpen(false)
  }

  function handleGroupJoined(group: { id: string; name: string }) {
    // Refresh then navigate to the joined group
    fetchGroups()
    onNavigateToGroup(group.id)
  }

  if (loading) {
    return (
      <>
        <Header
          user={user}
          onCreateGroup={() => setCreateOpen(true)}
          onJoinGroup={() => setJoinOpen(true)}
          onLogout={onLogout}
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
        onCreateGroup={() => setCreateOpen(true)}
        onJoinGroup={() => setJoinOpen(true)}
        onLogout={onLogout}
      />

      <main className={styles.root}>
        <div className={styles.content}>
          {error && <div className={styles.errorMessage}>{error}</div>}

          {groups.length === 0 ? (
            <div className={styles.emptyState}>
              <h2>Nenhum grupo ainda</h2>
              <p>
                {canCreateGroup
                  ? 'Comece a competir criando ou se juntando a um grupo'
                  : 'Comece a competir entrando em um grupo com convite'}
              </p>
              <div className={styles.ctaButtons}>
                {canCreateGroup && (
                  <Button variant="primary" onClick={() => setCreateOpen(true)}>
                    Criar grupo
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setJoinOpen(true)}>
                  Entrar com convite
                </Button>
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
                    currentUserId={user.id}
                    onClick={() => onNavigateToGroup(group.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <CreateGroupModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleGroupCreated}
      />

      <JoinGroupModal
        isOpen={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={handleGroupJoined}
        initialCode={pendingInvite}
      />
    </>
  )
}
